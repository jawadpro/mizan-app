/**
 * Message templates: the owner pastes one real alert from a bank, and Mizan turns it into a
 * pattern for that bank's alerts of the same kind. The amount (with PKR or Rs) and, if given,
 * the payee become the parts that change; other numbers (dates, times, account and reference
 * numbers) match any value; every other word must match.
 *
 * MCB's own formats are seeded into the same list (see mcb-defaults.ts), so every bank is edited
 * in one place. Pure and dependency-free so the Settings page can check a template live in the browser.
 * The SMS text is only ever matched with regular expressions built from escaped text.
 */
import type { Kind } from "../categories";
import { parseAmountToPaisa } from "../money";
import { AMOUNT_RE, BALANCE_RE, cleanParty, findBankRef, findDate, guessCategory, normalizeText, OTP_RE, UNSURE_RE } from "./parser";

export type SmsTemplate = {
  id?: string;
  bank: string;
  /** Sender IDs or contact names the alerts come from, comma-separated; "MCB*" matches any name starting MCB. Empty matches any sender. */
  sender: string;
  kind: Kind;
  /** Fixed category for every match; null picks one from the payee and wording. */
  category: string | null;
  example: string;
  /** The payee as written in the example, so the same position is read from later alerts. */
  payee: string;
  /** Send every match to the Review inbox instead of importing it (e.g. transfers that may carry a charge). */
  hold?: boolean;
};

export type TemplateReading = {
  kind: Kind;
  amountPaisa: number;
  occurredAt: Date;
  dateSource: "message" | "received";
  hasExplicitTime: boolean;
  counterparty: string | null;
  category: string;
  accountHint: string | null;
  bankRef: string | null;
};

export const MAX_TEMPLATES = 30;
const MONTH_TOKEN = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[.,]?$/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function token(t: string) {
  if (/\d/.test(t)) return String.raw`\S+?`;
  if (MONTH_TOKEN.test(t)) return String.raw`[A-Za-z]{3,9}[.,]?`;
  return esc(t);
}
function literal(seg: string) {
  return seg
    .split(/(\s+)/)
    .filter((x) => x !== "")
    .map((x) => (/^\s+$/.test(x) ? String.raw`\s+` : token(x)))
    .join("");
}

export function compileTemplate(t: Pick<SmsTemplate, "example" | "payee">): { ok: true; pattern: RegExp } | { ok: false; error: string } {
  const text = normalizeText(t.example ?? "");
  if (text.length < 15) return { ok: false, error: "Paste a full example message." };
  const spans: { start: number; end: number; group: string }[] = [];

  const payee = normalizeText(t.payee ?? "");
  if (payee) {
    const at = text.toLowerCase().indexOf(payee.toLowerCase());
    if (at < 0) return { ok: false, error: `“${payee}” isn't in the example. Copy it exactly as the message writes it.` };
    spans.push({ start: at, end: at + payee.length, group: "(?<payee>.+?)" });
  }

  const balances = Array.from(text.matchAll(BALANCE_RE)).map((m) => [m.index!, m.index! + m[0].length]);
  const amount = Array.from(text.matchAll(AMOUNT_RE)).find((m) => {
    const s = m.index!, e = s + m[0].length;
    const inBalance = balances.some(([a, b]) => s >= a && e <= b);
    const inPayee = spans.some((p) => s < p.end && e > p.start);
    return !inBalance && !inPayee;
  });
  if (!amount) return { ok: false, error: "No amount found. The example needs the amount written with PKR or Rs, e.g. PKR 2,450.00." };
  spans.push({ start: amount.index!, end: amount.index! + amount[0].length, group: String.raw`(?:PKR|Rs\.?|Rupees)\s*:?\s*(?<amount>[\d,]+(?:\.\d{1,2})?)` });

  spans.sort((a, b) => a.start - b.start);
  let src = "";
  let at = 0;
  for (const s of spans) {
    src += literal(text.slice(at, s.start)) + s.group;
    at = s.end;
  }
  src += literal(text.slice(at));
  try {
    return { ok: true, pattern: new RegExp(String.raw`^\s*${src}\s*$`, "i") };
  } catch {
    return { ok: false, error: "This example can't be turned into a pattern. Try a different message." };
  }
}

/** Sender list, comma-separated; an entry ending in * matches any sender that starts with it ("MCB*"). Empty matches any. */
export function senderMatches(want: string, sender: string) {
  const s = sender.trim().toUpperCase();
  const list = want.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (!list.length) return true;
  return list.some((w) => (w.endsWith("*") ? w.length > 1 && s.startsWith(w.slice(0, -1)) : s === w));
}

/** Reads one alert with one template, or null when the alert doesn't follow it. */
export function readWithTemplate(t: SmsTemplate, input: { sender: string; text: string; receivedAt: Date }): TemplateReading | null {
  if (!senderMatches(t.sender, input.sender)) return null;
  const c = compileTemplate(t);
  if (!c.ok) return null;
  const text = normalizeText(input.text);
  if (OTP_RE.test(text) || UNSURE_RE.test(text)) return null;
  const m = c.pattern.exec(text);
  if (!m?.groups?.amount) return null;
  const amountPaisa = parseAmountToPaisa(m.groups.amount);
  if (!amountPaisa) return null;

  const rawPayee = m.groups.payee?.trim();
  const counterparty = rawPayee ? cleanParty(rawPayee) ?? (rawPayee.length <= 60 ? rawPayee : null) : null;
  const d = findDate(text);
  const occurredAt = d ? new Date(Date.UTC(d.y, d.m, d.d, d.hh ?? 12, d.mm ?? 0) - 5 * 3600e3) : input.receivedAt;
  const guessed = guessCategory(`${counterparty ?? ""} ${text}`);
  const fits = guessed && (t.kind === "income" ? ["Salary", "Refund", "Profit"].includes(guessed) : guessed !== "Salary");
  const category = t.kind === "remittance" ? "Remittance" : t.category || (fits ? guessed : null) || "Uncategorized";
  const acct = /[*xX#]{2,}\s*(\d{3,4})\b/.exec(text);
  return {
    kind: t.kind,
    amountPaisa,
    occurredAt,
    dateSource: d ? "message" : "received",
    hasExplicitTime: !!d && d.hh !== null,
    counterparty,
    category,
    accountHint: acct?.[1] ?? null,
    bankRef: findBankRef(text),
  };
}

/** The first template that reads the alert. */
export function matchTemplates(templates: SmsTemplate[], input: { sender: string; text: string; receivedAt: Date }) {
  for (const t of templates) {
    const reading = readWithTemplate(t, input);
    if (reading) return { template: t, reading };
  }
  return null;
}
