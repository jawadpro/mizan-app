/** Banks the owner gets alerts from (Settings > Bank messages). Pure, so the Settings page can use it too. */
import { z } from "zod";

export type Bank = {
  id?: string;
  name: string;
  /** Sender IDs or contact names, comma-separated; "MCB*" matches any sender starting with MCB. */
  senders: string;
  /** Last 3 or 4 digits of the account, and of any card on it, comma-separated ("1234, 4321"), to tell accounts at one bank apart. Empty for any. */
  account_hint: string;
  auto_import: boolean;
  hold_transfers: boolean;
};

export const MAX_BANKS = 20;
/** An account and up to five cards on it. */
export const MAX_DIGITS = 6;

export const banksInput = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().max(120).transform((s) => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(1, "Give each bank a name").max(60, "Keep bank names under 60 characters")),
        senders: z.string().max(600).transform((s) => s.split(",").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ")).pipe(z.string().max(300, "That sender list is too long")),
        account_hint: z
          .string()
          .max(60)
          .transform((s) => Array.from(new Set(s.split(/[,\s]+/).filter(Boolean))))
          .refine((a) => a.every((x) => /^\d{3,4}$/.test(x)), "Account: the last 3 or 4 digits, with commas between an account and its cards, or leave it empty")
          .refine((a) => a.length <= MAX_DIGITS, `Up to ${MAX_DIGITS} numbers per account`)
          .transform((a) => a.join(", ")),
        auto_import: z.boolean(),
        hold_transfers: z.boolean(),
      }),
    )
    .max(MAX_BANKS, `Up to ${MAX_BANKS} banks`),
});

export function senderMatches(list: string, sender: string): boolean {
  const s = sender.trim().toUpperCase();
  if (!s) return false;
  return list
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)
    .some((w) => (w.endsWith("*") ? w.length > 1 && s.startsWith(w.slice(0, -1)) : s === w));
}

/** The digits saved on a bank: its account's last digits and any card's, e.g. "1234, 4321". */
export function bankDigits(b: Pick<Bank, "account_hint">): string[] {
  return (b.account_hint ?? "").split(/[,\s]+/).filter((x) => /^\d{3,4}$/.test(x));
}

/** "••1234 ••4321", for showing a bank's saved digits. */
export function digitsLabel(hint: string | null | undefined): string {
  return bankDigits({ account_hint: hint ?? "" }).map((d) => `••${d}`).join(" ");
}

/** Whether digits read from an alert are one of the bank's ("8" from "15XXXX8" fits a saved 4248). */
export function digitsMatch(saved: string, read: string): boolean {
  return read.length >= saved.length ? read.endsWith(saved) : saved.endsWith(read);
}

/** Starts every reason an alert waits in Review because its account couldn't be told. */
export const ACCOUNT_UNCLEAR = "Couldn't tell which account";

export type BankPick<B> = {
  bank: B | null;
  /** The banks whose senders match, when one couldn't be chosen between them. */
  choices: B[];
  /** Why the alert must wait for the owner to pick the account. */
  unclear: string | null;
};

/**
 * The bank account an alert came from. Its sender narrows it to the banks that send from it; the account
 * or card digits in the alert (the owner's, best first) choose between them. When the digits don't settle it,
 * nothing is guessed: the alert waits in Review for the owner to pick. A bank with no digits saved takes any
 * account the others don't. Senders trusted through SMS_TRUSTED_SENDERS count as the first bank.
 */
export function chooseBank<B extends Bank>(banks: B[], sender: string, digits: string[] | string | null, extraTrusted: string[] = []): BankPick<B> {
  const read = (Array.isArray(digits) ? digits : digits ? [digits] : []).filter(Boolean);
  const hits = banks.filter((b) => senderMatches(b.senders, sender));
  if (!hits.length) {
    const trusted = banks[0] && extraTrusted.some((t) => t.trim() && t.trim().toUpperCase() === sender.trim().toUpperCase());
    return { bank: trusted ? banks[0] : null, choices: [], unclear: null };
  }
  const withDigits = hits.filter((b) => bankDigits(b).length);
  const open = hits.filter((b) => !bankDigits(b).length);
  // One bank for this sender and no digits saved on it: every alert is that account's.
  if (!withDigits.length && hits.length === 1) return { bank: hits[0], choices: [], unclear: null };

  for (const d of read) {
    const m = withDigits.filter((b) => bankDigits(b).some((s) => digitsMatch(s, d)));
    if (m.length === 1) return { bank: m[0], choices: [], unclear: null };
  }
  const unclear = (why: string): BankPick<B> => ({ bank: null, choices: hits, unclear: `${ACCOUNT_UNCLEAR}: ${why}` });
  const shown = read.find((d) => d.length >= 3) ?? read[0];
  if (read.length) {
    // A number that fits two banks is never guessed between.
    if (read.some((d) => withDigits.filter((b) => bankDigits(b).some((s) => digitsMatch(s, d))).length > 1)) return unclear(`••${shown} fits more than one of your banks`);
    if (open.length === 1) return { bank: open[0], choices: [], unclear: null };
    return unclear(`••${shown} isn't saved on any of your banks`);
  }
  if (hits.length === 1) return { bank: hits[0], choices: [], unclear: null };
  return unclear("the message shows no account number");
}

/** The bank an alert came from, or null when it couldn't be told (see chooseBank). */
export function pickBank<B extends Bank>(banks: B[], sender: string, digits: string[] | string | null, extraTrusted: string[] = []): B | null {
  return chooseBank(banks, sender, digits, extraTrusted).bank;
}
