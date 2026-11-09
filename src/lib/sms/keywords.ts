/**
 * The words that tell MCB alerts apart. Each list is plain phrases, edited in Settings > Bank messages;
 * a phrase matches as whole words, case-insensitive, with any spacing. Pure, so the Settings page can use it.
 */
import { z } from "zod";

export const WORD_KINDS = ["expense", "income", "remittance", "transfer"] as const;
export type WordKind = (typeof WORD_KINDS)[number];
export type SmsWords = Record<WordKind, string[]>;

export const WORD_LABEL: Record<WordKind, { title: string; hint: string }> = {
  expense: { title: "Expense words", hint: "Money going out, e.g. charged, debited, paid." },
  income: { title: "Income words", hint: "Money coming in, e.g. received, credited." },
  remittance: { title: "Remittance words", hint: "Incoming money that is a remittance from abroad. Needs an income word too." },
  transfer: { title: "Transfer words", hint: "Outgoing transfers. These wait in Review so you can add any bank charge." },
};

export const DEFAULT_SMS_WORDS: SmsWords = {
  expense: ["debited", "debit from", "withdrawn", "withdrawal", "purchase", "purchased", "paid", "payment of", "spent", "sent", "transferred to", "transfer of", "transferred of", "charged", "deducted"],
  income: ["credited", "received", "deposited", "deposit of"],
  remittance: ["home remittance", "remittance", "inward transfer", "inward remittance", "western union", "moneygram", "remitly", "wise transfer", "xpress money", "ria money"],
  transfer: ["sent to", "transferred to", "transfer of", "transferred of", "via ibft", "via mobile ibft", "via raast", "fund transfer", "funds transfer", "interbank"],
};

export const MAX_WORDS = 40;
const phrase = z.string().transform((s) => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(2, "Words need at least 2 letters").max(40, "Keep each phrase under 40 characters"));
const list = z.array(phrase).max(MAX_WORDS, `Up to ${MAX_WORDS} words per list`).transform((a) => Array.from(new Set(a.map((w) => w.toLowerCase()))));
export const smsWordsInput = z.object({ expense: list, income: list, remittance: list, transfer: list }).strict();

/** Stored lists, leniently: a missing or bad list falls back to its defaults. */
export function normalizeWords(raw: unknown): SmsWords {
  const out: SmsWords = { ...DEFAULT_SMS_WORDS };
  if (!raw || typeof raw !== "object") return out;
  for (const k of WORD_KINDS) {
    const one = list.safeParse((raw as Record<string, unknown>)[k]);
    if (one.success) out[k] = one.data;
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** A regex matching any phrase in the list as whole words; an empty list matches nothing. */
export function wordsRegex(words: string[]): RegExp {
  const parts = words.map((w) => w.trim()).filter(Boolean).map((w) => w.split(/\s+/).map(esc).join(String.raw`\s+`));
  if (!parts.length) return /(?!)/;
  return new RegExp(String.raw`(?<![A-Za-z0-9])(?:${parts.join("|")})(?![A-Za-z0-9])`, "i");
}
