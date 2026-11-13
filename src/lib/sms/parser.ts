/**
 * MCB Pakistan SMS alert parser.
 *
 * Checked against real MCB alerts from 6222 (card payments, incoming transfers, fees,
 * remittances) and 8222 (outgoing transfers); see tests/sms-parser.test.ts. The rules are
 * deliberately strict: anything that does not match cleanly goes to the review inbox
 * instead of being guessed.
 *
 * The SMS body is untrusted data. It is only ever matched with fixed regular expressions;
 * nothing in it is executed, interpreted as an instruction, or rendered as HTML.
 */
import type { Kind } from "../categories";
import { OWN_ACCOUNTS } from "../categories";
import { parseAmountToPaisa } from "../money";
import { DEFAULT_SMS_WORDS, wordsRegex, type SmsWords } from "./keywords";
import { accountDigits } from "./accounts";

export const PARSER_VERSION = "mcb-v1";
export const MAX_SMS_CHARS = 1000;

export type ParsedFields = {
  kind: Kind | null;
  amountPaisa: number | null;
  occurredAt: Date | null;
  dateSource: "message" | "received";
  counterparty: string | null;
  category: string | null;
  /** The owner's account number, last 3 or 4 digits, as stored with the transaction. */
  accountHint: string | null;
  /** Every number that may be the owner's, best first (see accounts.ts), used to pick between accounts at one bank. */
  accountDigits: string[];
  bankRef: string | null;
  hasExplicitTime: boolean;
  /** The counterparty is one of the user's own names, so this moves money between their own accounts. */
  ownAccount: boolean;
  /** A bank charge or tax the alert names next to the amount ("PKR 10,000.00 and Tax/Charges 5.00"), saved as its own expense. */
  chargesPaisa: number | null;
};

export type ParseResult =
  | { status: "ignored"; reason: string }
  | { status: "parsed"; rule: string; fields: ParsedFields & { kind: Kind; amountPaisa: number; occurredAt: Date; category: string } }
  | { status: "review"; reason: string; fields: ParsedFields };

// MCB alerts arrive from "MCB", 6222 (card payments) or 8222 (transfers); a saved contact may also name them, e.g. "MCB Transfers".
const DEFAULT_TRUSTED_SENDERS = ["MCB", "MCBBANK", "MCB BANK", "MCB-BANK", "6222", "8222"];
const DEBIT_LABEL_RE = /(?<![A-Za-z])debit\s*:/i;
const CREDIT_LABEL_RE = /(?<![A-Za-z])credit\s*:/i;
const MCB_CONTACT_RE = /^MCB\b[\w .\-]{0,40}$/;

export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SMS_CHARS);
}

export function isTrustedSender(sender: string, extra: string[] = []): boolean {
  const s = sender.trim().toUpperCase();
  if (MCB_CONTACT_RE.test(s)) return true;
  return [...DEFAULT_TRUSTED_SENDERS, ...extra.map((x) => x.trim().toUpperCase()).filter(Boolean)].includes(s);
}

const CUR = String.raw`(?:PKR|Rs\.?|Rupees)`;
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d+)(?:\.(\d{1,2}))?`;

/**
 * How each currency the app can be set to is written in alerts. Alerts in the chosen currency are read; any other
 * currency named beside an amount sends the alert to Review. "$" counts as home for USD, CAD and AUD.
 */
const CURRENCY_WORDS: Record<string, string[]> = {
  PKR: ["PKR", String.raw`Rs\.?`, "Rupees"],
  INR: ["INR", String.raw`Rs\.?`, "Rupees", "₹"],
  BDT: ["BDT", String.raw`Tk\.?`, "Taka", "৳"],
  USD: ["USD", String.raw`US\$`, String.raw`\$`],
  EUR: ["EUR", "€"],
  GBP: ["GBP", "£"],
  AED: ["AED", String.raw`Dhs?\.?`],
  SAR: ["SAR", "SR"],
  QAR: ["QAR", "QR"],
  CAD: ["CAD", String.raw`C\$`, String.raw`\$`],
  AUD: ["AUD", String.raw`A\$`, String.raw`\$`],
  MYR: ["MYR", "RM"],
  TRY: ["TRY", "TL", "₺"],
};

type CurrencyPatterns = { amount: RegExp; balance: RegExp; charges: RegExp; foreign: RegExp | null; monthFirst: boolean };
const patternCache = new Map<string, CurrencyPatterns>();

function balanceRe(cur: string) {
  return new RegExp(
    String.raw`\b(?:avl\.?|avail\.?|available|current|closing|ledger|new|remaining|total)?\s*(?:a\/c\s*)?bal(?:ance)?\.?\s*(?:is|:|=|of)?\s*${cur}?\s*:?\s*-?${NUM}\s*(?:cr|dr)?`,
    "gi",
  );
}
function chargesRe(cur: string) {
  return new RegExp(
    String.raw`\s*(?:\band|\bplus|\bincl(?:uding|\.)?|\+|&)\s+(?:(?:bank|service|transaction)\s+)?(?:tax(?:es)?|charges?|fees?|fed|wht)(?:\s*(?:\/|&|and)\s*(?:tax(?:es)?|charges?|fees?|fed|wht))?\s*(?:of\s+)?:?\s*${cur}?\s*:?\s*${NUM}`,
    "i",
  );
}

/** The patterns for alerts in one currency (PKR when none or an unknown one is given). */
function patterns(currency?: string | null): CurrencyPatterns {
  const code = currency && CURRENCY_WORDS[currency.toUpperCase()] ? currency.toUpperCase() : "PKR";
  const hit = patternCache.get(code);
  if (hit) return hit;
  const home = CURRENCY_WORDS[code];
  // PKR keeps the exact pattern it has always had; other currencies' words must not sit inside a word.
  const cur = code === "PKR" ? CUR : String.raw`(?<![A-Za-z])(?:${home.join("|")})`;
  const others = Array.from(new Set(Object.entries(CURRENCY_WORDS).filter(([c]) => c !== code).flatMap(([, w]) => w))).filter((w) => !home.includes(w));
  // Longer words first, so "US$" is tried before "$".
  others.sort((a, b) => b.length - a.length);
  const p: CurrencyPatterns = {
    amount: new RegExp(String.raw`${cur}\s*:?\s*${NUM}`, "gi"),
    balance: balanceRe(cur),
    charges: chargesRe(cur),
    foreign: new RegExp(String.raw`(?<![A-Za-z])(?:${others.join("|")})\s*:?\s*\d`, "i"),
    // American banks write month/day/year; everyone else in the list writes day/month/year.
    monthFirst: code === "USD",
  };
  patternCache.set(code, p);
  return p;
}

/** Whether alerts in this currency write numeric dates month first (USD). */
export const monthFirstFor = (currency?: string | null) => patterns(currency).monthFirst;

export const OTP_RE = /\b(otp|one[\s-]?time\s+(?:password|pin|code)|verification\s+code|do\s+not\s+share|never\s+share)\b/i;
const PROMO_RE = /\b(offer|discount|cashback\s+offer|win|lucky\s+draw|apply\s+now|click\s+here|t&cs?\s+apply)\b/i;
// Available/ledger balance clauses. Removed before looking for the transaction amount.
export const BALANCE_RE = balanceRe(CUR);
// A charge or tax printed beside the amount (Bank Alfalah: "PKR 10,000.00 and Tax/Charges 5.00 Debited"). Read, then removed
// so it is neither a second amount nor a reason to call the whole payment a bank charge. "plus tax" with no figure stays.
export const CHARGES_RE = chargesRe(CUR);

/** The bank charge or tax named beside the amount, in paisa, or null. */
export function findCharges(text: string, currency?: string | null): number | null {
  const m = patterns(currency).charges.exec(normalizeText(text));
  if (!m) return null;
  const v = parseAmountToPaisa(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  return v && v > 0 ? v : null;
}

export const AMOUNT_RE = new RegExp(String.raw`${CUR}\s*:?\s*${NUM}`, "gi");

// Direction words (expense, income, remittance, transfer) are editable in Settings; see keywords.ts.
export const UNSURE_RE = /\b(revers(?:ed|al)|refund(?:ed)?|declined|failed|unsuccessful|pending|on\s+hold|blocked|insufficient|cancel(?:led|ed)?|due\s+(?:date|amount)|minimum\s+payment|will\s+be)\b/i;

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** An amount is not a name ("credited by PKR 4,097.89"). */
const CURRENCY_START_RE = /^(?:(?:pkr|rs\.?|rupees|inr|bdt|taka|usd|eur|gbp|aed|sar|qar|cad|aud|myr|try)(?![a-z])|(?:us\$|c\$|a\$|\$|₹|৳|€|£|₺|tk\.?|dhs?\.?|sr|qr|rm|tl)\s*:?\s*\d)/i;
/** Words that disqualify a captured counterparty (it refers to the user's own account). */
const SELF_REF_RE = /^(your|ur|the|a\/c|ac|acc|account|card|mcb|wallet|you)\b/i;

const CATEGORY_RULES: Array<[RegExp, string]> = [
  // Withholding tax can be claimed against income tax, so it is kept apart from fees. Tax cut "on cash withdrawal"
  // names the withdrawal, so it is matched before withdrawals; a withdrawal alert that mentions tax stays a withdrawal.
  [/\b(withholding|wht|w\.h\.t|income\s+tax|advance\s+tax|tax)\b.*\b(on|for)\s+(atm\s+)?cash\s+withdrawal\b/i, "Tax deducted"],
  [/\b(atm|cash\s+withdrawal)\b/i, "Cash withdrawal"],
  // Income tax paid to FBR, usually through a PSID (payment slip ID) from IRIS.
  [/\b(fbr|psid|federal\s+board\s+of\s+revenue)\b/i, "Tax payment"],
  [/\b(withholding|wht|w\.h\.t|income\s+tax|advance\s+tax|tax\s+u\/s)\b/i, "Tax deducted"],
  [/\b(fee|charges?|fed|excise|annual\s+fee|sms\s+alert\s+charges?)\b/i, "Bank charges"],
  [/\b(salary|payroll)\b/i, "Salary"],
  [/\b(k-?electric|ke\s+bill|lesco|iesco|mepco|fesco|gepco|pesco|hesco|sepco|ssgc|sngpl|ptcl|stormfiber|nayatel|wateen|jazz|zong|telenor|ufone|warid|kwsc|wasa)\b/i, "Utilities"],
  [/\b(food\s*panda|kfc|nando'?s|mcdonald'?s|cheezious|domino'?s|pizza|restaurant|cafe|bakery|savour|hardee'?s)\b/i, "Food & dining"],
  [/\b(careem|uber|bykea|indrive|yango|pso|shell|total\s*parco|attock|fuel|petrol|motorway|m-tag)\b/i, "Transport"],
  [/\b(imtiaz|carrefour|naheed|metro\s+cash|chase\s+up|al-?fatah|greenvalley|grocer(?:y|s)?|mart)\b/i, "Groceries"],
  [/\b(daraz|khaadi|sapphire|gul\s*ahmed|outfitters|amazon|aliexpress|temu)\b/i, "Shopping"],
  [/\b(pharmacy|hospital|clinic|dvago|servaid|medical|lab(?:oratory)?)\b/i, "Health"],
  [/\b(netflix|spotify|youtube|cinema|cinepax|nueplex|steam|playstation)\b/i, "Entertainment"],
  [/\b(school|university|college|tuition|academy)\b/i, "Education"],
  [/\b(ibft|raast|funds?\s+transfer|fund\s+transfer|transferred\s+to|interbank)\b/i, "Transfers"],
];

/**
 * The date (and time, if printed) in an alert. A numeric date is read day/month/year unless monthFirst is set
 * (American banks); either way a part over 12 settles which one is the day.
 */
export function findDate(text: string, monthFirst = false): { y: number; m: number; d: number; hh: number | null; mm: number | null } | null {
  let m =
    /\b(\d{1,2})[-\s/]([A-Za-z]{3,4})[-\s/,]*(\d{2,4})\b/.exec(text) ??
    null;
  let y: number, mo: number, d: number;
  let named: RegExpExecArray | null = null;
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    d = +m[1];
    mo = MONTHS[m[2].toLowerCase()];
    y = +m[3];
  } else if ((named = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(text)) && MONTHS[named[1].slice(0, 3).toLowerCase()] !== undefined && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i.test(named[1])) {
    // "Nov 13, 2026", "November 13 2026".
    mo = MONTHS[named[1].slice(0, 3).toLowerCase()];
    d = +named[2];
    y = +named[3];
  } else if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text))) {
    y = +m[1];
    mo = +m[2] - 1;
    d = +m[3];
  } else if ((m = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/.exec(text))) {
    // Pakistani and Gulf banks write day/month/year, American banks month/day/year.
    const a = +m[1];
    const b = +m[2];
    const swap = a > 12 ? false : b > 12 ? true : monthFirst;
    d = swap ? b : a;
    mo = (swap ? a : b) - 1;
    y = +m[3];
  } else {
    return null;
  }
  if (y < 100) y += 2000;
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const check = new Date(Date.UTC(y, mo, d));
  if (check.getUTCMonth() !== mo) return null;

  const t = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\b/i.exec(text);
  let hh: number | null = null;
  let mm: number | null = null;
  if (t) {
    hh = +t[1];
    mm = +t[2];
    if (t[4]) {
      const pm = t[4].toUpperCase() === "PM";
      if (hh < 1 || hh > 12) hh = null;
      else hh = (hh % 12) + (pm ? 12 : 0);
    }
    if (hh === null || hh > 23 || mm > 59) {
      hh = null;
      mm = null;
    }
  }
  return { y, m: mo, d, hh, mm };
}

const MASKED_ACCOUNT_PREFIX = /^\s*(?:[*xX#]{2,}\s*\d{2,6}|\d{2,6}\s*[*xX#]{2,})\s*[-:]?\s*/;
const BARE_REF_RE = /(?<![A-Za-z0-9*#/])(?=[A-Z0-9]*[A-Z])((?:[A-Z]*\d){4}[A-Z0-9]{2,20})(?![A-Za-z0-9])/;

const ACRONYMS = new Set(["ATM", "BR", "KFC", "PSO", "IBFT", "PTCL", "KE", "SSGC", "SNGPL", "LESCO", "IESCO", "PK", "LTD", "PVT", "POS", "UK", "UAE", "USA"]);

export function cleanParty(raw: string | undefined): string | null {
  if (!raw) return null;
  // A masked account number glued to the name ("XX8373-MUHAMMAD ALI", "**8373 - ALI") is not part of it.
  let s = raw.replace(MASKED_ACCOUNT_PREFIX, "").replace(/[*#]+/g, " ").replace(/\s+/g, " ").trim().replace(/[.,;:\-]+$/, "").trim();
  const bare = s.replace(BANK_SUFFIX_RE, "");
  if (bare.length >= 2 && /[A-Za-z]/.test(bare)) s = bare;
  if (s.length < 2 || s.length > 60) return null;
  if (SELF_REF_RE.test(s)) return null;
  if (CURRENCY_START_RE.test(s)) return null;
  if (!/[A-Za-z]/.test(s)) return null;
  if (/\d{5,}/.test(s)) return null;
  // Alerts often SHOUT names; title-case them but keep well-known acronyms.
  if (s === s.toUpperCase()) {
    s = s
      .split(" ")
      .map((w) => (ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
      .join(" ");
  }
  return s;
}

const STOP = String.raw`(?=\s+(?:on|dated|ref|reference|via|using|with|through|from|to|at|for|in|a\/c|txn|trx|tid|rrn|stan|avl|available|bal|balance|is|has|was)\b|\s*[.,;|(]|\s*$)`;

// MCB transfer alerts append the recipient's bank or wallet to their name ("SARA AHMED UBL").
const BANK_SUFFIX_RE = new RegExp(
  String.raw`\s+(?:${[
    "Bank Alfalah", "Alfalah", "BAF", "Bank Al Habib", "Al Habib", "Allied Bank", "ABL", "Askari Bank", "Askari", "BankIslami", "Bank Islami",
    "Bank of Punjab", "BOP", "Dubai Islamic Bank", "Dubai Islamic", "DIB", "Faysal Bank", "Faysal", "Habib Metro", "HabibMetro", "HBL",
    "JS Bank", "MCB", "MCB Islamic", "Meezan Bank", "Meezan", "National Bank", "NBP", "Soneri Bank", "Soneri", "Standard Chartered", "SCB",
    "Silk Bank", "Sindh Bank", "Summit Bank", "UBL", "Al Baraka", "Albaraka", "SadaPay", "NayaPay", "JazzCash", "Easypaisa", "Easy Paisa",
    "Telenor Microfinance", "U Bank", "UPaisa", "Khushhali", "Mobilink", "Zindigi", "Konnect",
  ].map((b) => b.replace(/ /g, "\\s+")).join("|")})$`,
  "i",
);

// Trailing helpline numbers and unlabelled reference codes are not part of a name ("… at 762316/FOOD PANDA FT26236BP37B Helpline:111-654-321").
const HELPLINE_RE = /\s*\b(?:helpline|call|uan)\s*:?\s*[\d\- ]{7,}.*$/i;
const TRAILING_REF_RE = new RegExp(String.raw`\s+${BARE_REF_RE.source}`, "g");

function findCounterparty(text: string, kind: Kind | null): string | null {
  // A merchant or terminal number may come before the name ("at 762316/FOOD PANDA"); it is dropped.
  const party = String.raw`(?:\d{3,12}\s*\/\s*)?((?:[*#xX]{2,}\d{2,6}\s*[-:]\s*)?[A-Za-z][A-Za-z0-9&'./\- ]{1,59}?)`;
  const at = String.raw`\bat\s+${party}${STOP}`;
  const patterns: string[] =
    kind === "expense"
      ? [at, String.raw`\b(?:to|towards)\s+${party}${STOP}`]
      : // Some banks name who paid with "at" instead of "from" (JS Bank: "credited by PKR … at 762316/FOOD PANDA").
        [String.raw`\b(?:from|by|sender)\s*:?\s+${party}${STOP}`, at];
  const body = text.replace(HELPLINE_RE, "").replace(TRAILING_REF_RE, "");
  for (const src of patterns) {
    // Every place the word appears is tried: "credited by PKR …" is skipped, a later "by NAME" is not.
    for (const m of body.matchAll(new RegExp(src, "gi"))) {
      const c = cleanParty(m[1]);
      if (c) return c;
    }
  }
  return null;
}

/** Category from well-known merchant and bill names, or null. */
export function guessCategory(text: string): string | null {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat;
  return null;
}

function emptyFields(): ParsedFields {
  return { kind: null, amountPaisa: null, occurredAt: null, dateSource: "received", counterparty: null, category: null, accountHint: null, accountDigits: [], bankRef: null, hasExplicitTime: false, ownAccount: false, chargesPaisa: null };
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();

export type ParseInput = {
  sender: string;
  text: string;
  receivedAt: Date;
  trustedSenders?: string[];
  ownNames?: string[];
  words?: SmsWords;
  /** Whether the sender is one of the owner's banks, when that was decided from Settings. Without it the built-in MCB senders apply. */
  knownSender?: boolean;
  /** Outgoing transfers wait in Review so a charge can be added (the default). */
  holdTransfers?: boolean;
  /** The app's currency (Settings). Amounts in it are read; other currencies go to Review. PKR when not given. */
  currency?: string | null;
};

export function parseSms(input: ParseInput): ParseResult {
  const text = normalizeText(input.text);
  const words = input.words ?? DEFAULT_SMS_WORDS;
  const DEBIT_RE = wordsRegex(words.expense);
  const CREDIT_RE = wordsRegex(words.income);
  const REMITTANCE_RE = wordsRegex(words.remittance);
  const OUT_TRANSFER_RE = wordsRegex(words.transfer);
  const fields = emptyFields();
  const cur = patterns(input.currency);

  if (OTP_RE.test(text)) return { status: "ignored", reason: "One-time password or security message" };

  fields.chargesPaisa = findCharges(text, input.currency);
  // Remove phrases where credit/debit name a card type rather than a direction, and a charge printed beside the amount.
  const directional = text.replace(/\b(credit|debit)\s+card\b/gi, "card").replace(cur.charges, " ");

  const withoutBalance = directional.replace(cur.balance, " [balance] ");
  const amounts = Array.from(withoutBalance.matchAll(cur.amount))
    .map((m) => parseAmountToPaisa(m[2] ? `${m[1]}.${m[2]}` : m[1]))
    .filter((v): v is number => v !== null);
  const distinct = Array.from(new Set(amounts));

  // Some banks label the direction instead of using a verb: "Debit: PKR 1500.000 Account No. …", "Credit: PKR …".
  const isDebit = DEBIT_RE.test(directional) || DEBIT_LABEL_RE.test(directional);
  const isCredit = CREDIT_RE.test(directional) || CREDIT_LABEL_RE.test(directional);
  const isRemit = REMITTANCE_RE.test(directional);

  if (!isDebit && !isCredit && distinct.length === 0) {
    if (PROMO_RE.test(text)) return { status: "ignored", reason: "Promotional message" };
  }

  if (distinct.length === 1) fields.amountPaisa = distinct[0];
  if (isDebit && !isCredit) fields.kind = "expense";
  else if (isCredit && !isDebit) fields.kind = isRemit ? "remittance" : "income";

  const date = findDate(text, cur.monthFirst);
  if (date) {
    const hh = date.hh ?? 12;
    const mm = date.mm ?? 0;
    fields.occurredAt = new Date(Date.UTC(date.y, date.m, date.d, hh, mm) - 5 * 3600e3);
    fields.dateSource = "message";
    fields.hasExplicitTime = date.hh !== null;
  }

  // The owner's account or card digits, never the other party's ("sent to ALI A/C *5678 from A/C *1234" is 1234).
  fields.accountDigits = accountDigits(text, fields.kind);
  const first = fields.accountDigits[0];
  fields.accountHint = first && first.length >= 3 ? first : null;
  const ref = /\b(?:ref(?:erence)?|txn|trx|tid|rrn|stan|tx\s*id|trans(?:action)?\s*id)\s*(?:id|no\.?|#)?\s*[:#.]?\s*([A-Z0-9]{6,24})\b/i.exec(text);
  if (ref && /\d/.test(ref[1])) fields.bankRef = ref[1].toUpperCase();
  // Some banks print the reference with no label ("… at 12:21 FT26243CK86C"): an upper-case code of letters and 4+ digits.
  else fields.bankRef = BARE_REF_RE.exec(text)?.[1] ?? null;

  fields.counterparty = findCounterparty(withoutBalance, fields.kind);
  const owners = (input.ownNames ?? []).map(nameKey).filter((n) => n.length >= 3);
  fields.ownAccount = !!fields.counterparty && fields.kind !== "remittance" && owners.includes(nameKey(fields.counterparty));
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(`${fields.counterparty ?? ""} ${directional}`)) {
      fields.category = cat;
      break;
    }
  }
  if (fields.kind === "remittance") fields.category = "Remittance";
  if (fields.kind === "income" && fields.category && !["Salary", "Refund", "Profit"].includes(fields.category)) fields.category = null;
  if (fields.kind === "expense" && fields.category === "Salary") fields.category = null;
  if (fields.ownAccount) fields.category = OWN_ACCOUNTS;

  // Decide: import only when every required fact was read unambiguously.
  const review = (reason: string): ParseResult => ({ status: "review", reason, fields });
  if (input.knownSender === false) return review("Sender isn't one of your banks in Settings");
  if (input.knownSender === undefined && !isTrustedSender(input.sender, input.trustedSenders)) return review("Sender is not one of your banks");
  if (cur.foreign?.test(text)) return review("Amount in a currency other than the one set in Settings");
  if (UNSURE_RE.test(directional)) return review("Reversal, refund, pending or failed wording");
  if (distinct.length === 0) return review("No transaction amount found (balances are ignored)");
  if (distinct.length > 1) return review("More than one candidate amount");
  if (isDebit && isCredit) return review("Both debit and credit wording");
  if (!fields.kind) return review("Unfamiliar alert: no debit or credit wording");

  // Outgoing transfers can carry a separate bank charge or tax, so they always wait for the owner.
  if (fields.kind === "expense" && input.holdTransfers !== false && OUT_TRANSFER_RE.test(directional)) return review("Transfer: add any bank charges, then confirm");

  const received = input.receivedAt.getTime();
  if (fields.occurredAt) {
    const delta = fields.occurredAt.getTime() - received;
    // Date-only alerts get noon; allow that plus clock skew. Reject far-future or very old dates.
    if (delta > 36 * 3600e3) return review("Date in the message is in the future");
    if (delta < -60 * 24 * 3600e3) return review("Date in the message is more than 60 days old");
  }

  return {
    status: "parsed",
    rule: PARSER_VERSION,
    fields: {
      ...fields,
      kind: fields.kind,
      amountPaisa: fields.amountPaisa!,
      occurredAt: fields.occurredAt ?? input.receivedAt,
      dateSource: fields.occurredAt ? "message" : "received",
      category: fields.category ?? "Uncategorized",
    },
  };
}

/** Masks long digit runs (account, card, phone, CNIC) and balance figures before storage. */
export function redactSms(text: string, currency?: string | null): string {
  return normalizeText(text)
    .replace(patterns(currency).balance, (m) => m.replace(/\d[\d,]*(?:\.\d+)?/g, "###"))
    .replace(/\d{5,}/g, (m) => "#".repeat(Math.min(m.length, 8)));
}
