/**
 * Finds the account and card numbers an alert mentions, and works out which of them are the owner's.
 *
 * Banks mask numbers in many ways ("A/C*1234", "A/c XX4248", "8350-1***6011", "Acct. 15XXXX8",
 * "Card **** **** **** 6677", "account ending with 2233", "...3344", "PK**MEZN****2233", "MCB Debit Card 4321").
 * A transfer alert often names two: "sent to ALI A/C *5678 from A/C *1234". The other party's number
 * follows their name, or sits on the far side of the money ("to" for money out, "from" for money in);
 * the owner's follows "your", names a card, or is the subject of the alert. Pure, so Settings can use it.
 */
import type { Kind } from "../categories";

export type AccountMention = {
  /** The visible digits at the end of the number, at most 4 ("6011"; "8" for "15XXXX8"). */
  digits: string;
  side: "own" | "other" | "unsure";
  index: number;
};

// A masked number: optional leading digits, then mask characters (*, #, •, two or more X's, or 2+ dots), then the visible tail.
const MASKED_RE =
  /(?:(?<![A-Za-z0-9])\d[\d-]{0,15}[\s-]?)?(?:(?:[*#•]+|(?<![A-Za-z])[xX]{2,}|(?<=\d)[xX]+)[\s-]*|\.{2,}(?=\d))+(\d{1,6})(?!\d)/g;
// An unmasked number straight after an account word: "Card 4321", "account ending in 8811", "A/C No. 0123456789012".
const KEYWORD_RE =
  /\b(?:a\/c|acct|acc|account|card|iban|wallet)\.?(?:\s*(?:no\.?|number|num|#|:|-))*\s*(?:ending\s*(?:in|with)?\s*:?\s*)?(\d(?:[\d -]{1,22}\d)?)(?![\d*#•xX])/gi;
// An IBAN, masked or not: "PK36MEZN0001234567890123", "PK**MEZN****2233".
const IBAN_RE = /\bPK[\dxX*#]{2}[A-Z]{4}[\dxX*#•\s-]*?(\d{3,4})(?!\d)/g;

const CARD_WORD = /\b(?:card)\b\W*$/i;
const YOUR = /\b(?:your|ur|my)\b/i;
const PREP_RE = /\b(from|to|into|in|towards|by)\b/gi;
// Words that can sit between a preposition and a number without naming another person.
const FILLER =
  /\b(?:your|ur|my|own|the|a|an|bank|banks|a\/c|ac|acct|acc|account|accounts|card|debit|credit|prepaid|virtual|no|number|num|ending|with|iban|wallet|mobile|savings?|current|asaan|digital|islamic|pk|ltd|limited|al|of|al-|habib|metro|alfalah|baf|mcb|hbl|ubl|abl|nbp|js|meezan|faysal|askari|soneri|silk|sindh|summit|allied|national|standard|chartered|scb|dubai|dib|bop|punjab|bankislami|sadapay|nayapay|jazzcash|easypaisa|easy|paisa|upaisa|zindigi|konnect)\b/gi;

function tail(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.slice(-4);
}

/** Every account or card number in the alert, in order, marked as the owner's, the other party's, or unsure. */
export function findAccountMentions(text: string, kind: Kind | null): AccountMention[] {
  const found: { start: number; end: number; digits: string; keywordLed: boolean }[] = [];
  const add = (start: number, end: number, digits: string, keywordLed = false) => {
    if (!digits || found.some((f) => start < f.end && end > f.start)) return;
    found.push({ start, end, digits, keywordLed });
  };
  for (const m of text.matchAll(IBAN_RE)) add(m.index!, m.index! + m[0].length, m[1]);
  for (const m of text.matchAll(MASKED_RE)) add(m.index!, m.index! + m[0].length, tail(m[1]));
  for (const m of text.matchAll(KEYWORD_RE)) {
    const digits = m[1].replace(/\D/g, "");
    // A bare number needs at least 3 digits to be an account, and is never an amount ("card PKR 500" has no digits here).
    if (digits.length < 3) continue;
    const start = m.index! + m[0].length - m[1].length;
    add(start, m.index! + m[0].length, digits.slice(-4), true);
  }
  found.sort((a, b) => a.start - b.start);

  const out: AccountMention[] = [];
  let prevEnd = 0;
  for (const f of found) {
    const before = text.slice(Math.max(prevEnd, f.start - 80), f.start);
    prevEnd = f.end;
    out.push({ digits: f.digits, side: sideOf(before, kind), index: f.start });
  }
  return out;
}

function sideOf(before: string, kind: Kind | null): AccountMention["side"] {
  // Words since the last preposition, with the mask junk of a glued IBAN or account ("PK**MEZN") removed.
  let prep: string | null = null;
  // "ending in 8811" names the number, not a direction.
  before = before.replace(/\bending\s+(?:in|with)\b/gi, "ending");
  let between = before;
  for (const m of before.matchAll(PREP_RE)) {
    prep = m[1].toLowerCase();
    between = before.slice(m.index! + m[0].length);
  }
  if (YOUR.test(between) || (!prep && YOUR.test(before))) return "own";
  const rest = between.replace(/\S*[*#•]\S*/g, " ").replace(FILLER, " ").replace(/[^A-Za-z]+/g, " ").trim();
  // "from ALI RAZA KHAN A/C*9012": a name before the number makes it theirs.
  if (prep && rest.length >= 2) return "other";
  if (CARD_WORD.test(before)) return "own";
  if (!prep) return "own";
  if (prep === "by") return "unsure";
  if (!kind) return "unsure";
  const out = kind === "expense";
  if (prep === "from") return out ? "own" : "other";
  return out ? "other" : "own";
}

/**
 * The digits to pick an account by: the owner's numbers first (for money out, the one it left from;
 * for money in, the one it arrived in), then any whose side is unclear. The other party's are left out.
 */
export function accountDigits(text: string, kind: Kind | null): string[] {
  const ms = findAccountMentions(text, kind);
  const own = ms.filter((m) => m.side === "own");
  const unsure = ms.filter((m) => m.side === "unsure");
  return Array.from(new Set([...own, ...unsure].map((m) => m.digits)));
}
