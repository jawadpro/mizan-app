import "server-only";
import { env } from "../env";
import { tx } from "../db";
import { parseSms, redactSms, PARSER_VERSION } from "./parser";
import { smsFingerprint } from "./fingerprint";
import { notifyReviewWaiting } from "../push";
import { getPrefs, listSmsTemplates } from "../repo";
import { matchTemplates } from "./templates";
import { AI_LABEL, readWithAi } from "./ai";
import type { ParseResult } from "./parser";
import type { Kind } from "../categories";

type Readable = Exclude<ParseResult, { status: "ignored" }>;

// MCB results that mean "this isn't an alert the MCB rules know", where templates and AI may help.
// Deliberate holds (transfers awaiting charges, reversals, foreign currency) stay with the owner.
const UNKNOWN_REASONS = new Set([
  "Sender is not a recognised MCB sender",
  "Unfamiliar alert: no debit or credit wording",
  "No transaction amount found (balances are ignored)",
  "More than one candidate amount",
]);

type Reading = { kind: Kind; amountPaisa: number; occurredAt: Date; dateSource: "message" | "received"; hasExplicitTime: boolean; counterparty: string | null; category: string; accountHint?: string | null };

function asParsed(rule: string, r: Reading): Readable {
  return {
    status: "parsed",
    rule,
    fields: { ...r, accountHint: r.accountHint ?? null, bankRef: null, ownAccount: false },
  };
}

/** Tries the owner's message templates, then AI (when turned on), for alerts the MCB rules don't know. */
async function readUnknown(input: { sender: string; text: string; receivedAt: Date }, result: Readable): Promise<{ result: Readable; note: string | null }> {
  if (result.status !== "review" || !UNKNOWN_REASONS.has(result.reason)) return { result, note: null };
  const hit = matchTemplates(await listSmsTemplates(), input);
  if (hit) return { result: asParsed(`template:${hit.template.bank}`.slice(0, 60), hit.reading), note: `Read with the ${hit.template.bank} message template` };
  const prefs = await getPrefs();
  if (!prefs.aiEnabled) return { result, note: null };
  const provider = prefs.aiProvider;
  const ai = await readWithAi({ provider, model: provider === "claude" ? prefs.aiModelClaude : prefs.aiModelOpenai, text: input.text, receivedAt: input.receivedAt });
  const by = `Read by AI (${AI_LABEL[provider]})`;
  if (!ai.ok) return { result: { ...result, reason: `${result.reason}. AI couldn't read it: ${ai.error}` }, note: null };
  if (!ai.reading) return { result: { ...result, reason: `${by}: ${ai.why}` }, note: null };
  if (prefs.aiAutoImport) return { result: asParsed(`ai:${provider}`, ai.reading), note: by };
  return { result: { status: "review", reason: `${by}. Please check it`, fields: { ...result.fields, ...ai.reading } }, note: by };
}

export type IngestOutcome =
  | { status: "imported"; transactionId: string }
  | { status: "review"; reviewId: string; reason: string }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

class Duplicate extends Error {}

export async function ingestSms(input: { sender: string; text: string; receivedAt: Date }): Promise<IngestOutcome> {
  const trusted = (process.env.SMS_TRUSTED_SENDERS ?? "").split(",");
  // The user's own name(s), as banks print them, so transfers between their own accounts are recognised.
  const ownNames = (process.env.SMS_OWN_NAMES ?? "").split(",");
  const first = parseSms({ ...input, trustedSenders: trusted, ownNames });
  // OTPs and promotions are dropped without storing anything.
  if (first.status === "ignored") return { status: "ignored", reason: first.reason };
  // A template or AI problem must never lose an alert: it then goes to review as before.
  const { result, note: readNote } = await readUnknown(input, first).catch(() => ({ result: first, note: null }));

  const textIsUnique = !!result.fields.bankRef || result.fields.hasExplicitTime;
  const fingerprint = smsFingerprint(env.sessionSecret(), input.sender, input.text, input.receivedAt, textIsUnique);
  const auto = result.status === "parsed" && env.smsAutoImport();
  const outcome = auto ? "imported" : "review";

  try {
    const res = await tx(async (run) => {
      const imp = await run<{ id: string }>(
        `INSERT INTO app.sms_imports (fingerprint, received_at, outcome, parser_rule)
         VALUES ($1,$2,$3,$4) ON CONFLICT (fingerprint) DO NOTHING RETURNING id`,
        [fingerprint, input.receivedAt, outcome, result.status === "parsed" ? result.rule : PARSER_VERSION],
      );
      if (!imp.rows[0]) throw new Duplicate();
      const importId = imp.rows[0].id;
      const f = result.fields;

      if (result.status === "parsed" && auto) {
        const ins = await run<{ id: string }>(
          `INSERT INTO app.transactions (kind, amount_paisa, occurred_at, category, counterparty, note, source, account_hint, bank_ref, sms_import_id)
           VALUES ($1,$2,$3,$4,$5,$6,'sms',$7,$8,$9)
           ON CONFLICT (bank_ref) WHERE bank_ref IS NOT NULL DO NOTHING RETURNING id`,
          [
            result.fields.kind, result.fields.amountPaisa, result.fields.occurredAt, result.fields.category, f.counterparty,
            [readNote, f.dateSource === "received" ? "Date taken from when the SMS arrived" : null].filter(Boolean).join(". ") || null,
            f.accountHint, f.bankRef, importId,
          ],
        );
        if (!ins.rows[0]) throw new Duplicate();
        return { status: "imported", transactionId: ins.rows[0].id } as const;
      }

      const reason = result.status === "review" ? result.reason : "Auto-import is turned off (SMS_AUTO_IMPORT=false)";
      // Only review items keep text, and only a redacted copy, deleted once resolved.
      const rev = await run<{ id: string }>(
        `INSERT INTO app.review_items (sms_import_id, reason, redacted_text, sender, received_at, kind, amount_paisa, occurred_at, counterparty, category, account_hint, bank_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [importId, reason, redactSms(input.text), input.sender.slice(0, 64), input.receivedAt, f.kind, f.amountPaisa, f.occurredAt, f.counterparty, f.category, f.accountHint, f.bankRef],
      );
      return { status: "review", reviewId: rev.rows[0].id, reason } as const;
    });
    // Awaited so the serverless function stays alive until it is sent; push failures never throw.
    if (res.status === "review") await notifyReviewWaiting();
    return res;
  } catch (e) {
    if (e instanceof Duplicate) return { status: "duplicate" };
    if ((e as { code?: string }).code === "23505") return { status: "duplicate" };
    throw e;
  }
}
