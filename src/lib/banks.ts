/** Banks the owner gets alerts from (Settings > Bank messages). Pure, so the Settings page can use it too. */
import { z } from "zod";

export type Bank = {
  id?: string;
  name: string;
  /** Sender IDs or contact names, comma-separated; "MCB*" matches any sender starting with MCB. */
  senders: string;
  /** Last 3 or 4 digits of the account, to tell two accounts at one bank apart. Empty for any. */
  account_hint: string;
  auto_import: boolean;
  hold_transfers: boolean;
};

export const MAX_BANKS = 20;

export const banksInput = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().max(120).transform((s) => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(1, "Give each bank a name").max(60, "Keep bank names under 60 characters")),
        senders: z.string().max(600).transform((s) => s.split(",").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ")).pipe(z.string().max(300, "That sender list is too long")),
        account_hint: z.string().max(8).transform((s) => s.trim()).refine((s) => s === "" || /^\d{3,4}$/.test(s), "Account: the last 3 or 4 digits, or leave it empty"),
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

/**
 * The bank an alert came from: a bank whose senders include it, preferring the one whose account
 * digits appear in the alert. Senders trusted through SMS_TRUSTED_SENDERS count as the first bank.
 */
export function pickBank<B extends Bank>(banks: B[], sender: string, accountHint: string | null, extraTrusted: string[] = []): B | null {
  const hits = banks.filter((b) => senderMatches(b.senders, sender));
  if (hits.length > 1 && accountHint) {
    const exact = hits.find((b) => b.account_hint === accountHint);
    if (exact) return exact;
    const open = hits.find((b) => !b.account_hint);
    if (open) return open;
  }
  if (hits[0]) return hits[0];
  if (banks[0] && extraTrusted.some((t) => t.trim() && t.trim().toUpperCase() === sender.trim().toUpperCase())) return banks[0];
  return null;
}
