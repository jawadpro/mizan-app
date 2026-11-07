import "server-only";
import { env } from "../env";
import { tx } from "../db";
import { parseSms, redactSms, PARSER_VERSION } from "./parser";
import { smsFingerprint } from "./fingerprint";
import { notifyReviewWaiting } from "../push";
import { listSmsTemplates } from "../repo";
import { matchTemplates } from "./templates";
import type { ParseResult } from "./parser";
import { OWN_ACCOUNTS } from "../categories";

type Readable = Exclude<ParseResult, { status: "ignored" }>;
type Input = { sender: string; text: string; receivedAt: Date };

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();

/**
 * Reads the alert with the owner's message types from Settings (MCB's included) before the
 * built-in MCB rules. The built-in rules stay as the safety net for alerts no message type fits.
 */
async function readWithTemplates(input: Input, ownNames: string[], fallback: Readable): Promise<{ result: Readable; note: string | null; rule: string }> {
  const hit = matchTemplates(await listSmsTemplates(), input);
  if (!hit) return { result: fallback, note: null, rule: PARSER_VERSION };
  const r = hit.reading;
  // A date far from arrival means the alert isn't what the message type expects; let the built-in rules decide.
  const delta = r.occurredAt.getTime() - input.receivedAt.getTime();
  if (r.dateSource === "message" && (delta > 36 * 3600e3 || delta < -60 * 24 * 3600e3)) return { result: fallback, note: null, rule: PARSER_VERSION };

  const owners = ownNames.map(nameKey).filter((n) => n.length >= 3);
  const ownAccount = !!r.counterparty && r.kind !== "remittance" && owners.includes(nameKey(r.counterparty));
  const fields = { ...r, category: ownAccount ? OWN_ACCOUNTS : r.category, ownAccount };
  const note = `Read with the ${hit.template.bank} message type`;
  const rule = `template:${hit.template.bank}`.slice(0, 60);
  if (hit.template.hold) {
    const reason = r.kind === "expense" ? "Transfer: add any bank charges, then confirm" : `Held for review by the ${hit.template.bank} message type`;
    return { result: { status: "review", reason, fields }, note, rule };
  }
  return { result: { status: "parsed", rule, fields }, note, rule };
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
  const ownNames = (process.env.SMS_OWN_NAMES ?? "").split(",").filter(Boolean);
  const first = parseSms({ ...input, trustedSenders: trusted, ownNames });
  // OTPs and promotions are dropped without storing anything.
  if (first.status === "ignored") return { status: "ignored", reason: first.reason };
  // A message-type problem must never lose an alert: the built-in MCB rules then decide as before.
  const { result, note: readNote, rule } = await readWithTemplates(input, ownNames, first).catch(() => ({ result: first, note: null, rule: PARSER_VERSION }));

  const textIsUnique = !!result.fields.bankRef || result.fields.hasExplicitTime;
  const fingerprint = smsFingerprint(env.sessionSecret(), input.sender, input.text, input.receivedAt, textIsUnique);
  const auto = result.status === "parsed" && env.smsAutoImport();
  const outcome = auto ? "imported" : "review";

  try {
    const res = await tx(async (run) => {
      const imp = await run<{ id: string }>(
        `INSERT INTO app.sms_imports (fingerprint, received_at, outcome, parser_rule)
         VALUES ($1,$2,$3,$4) ON CONFLICT (fingerprint) DO NOTHING RETURNING id`,
        [fingerprint, input.receivedAt, outcome, rule],
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
