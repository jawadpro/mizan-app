/**
 * Reads one alert with the owner's settings: which bank sent it, what it says, and whether it can be
 * imported or must wait in Review. Pure, so Settings can show the same reading for a pasted message.
 */
import { pickBank, type Bank } from "../banks";
import { parseSms, type ParseResult } from "./parser";
import type { SmsWords } from "./keywords";

export type AlertSettings<B extends Bank = Bank> = {
  banks: B[];
  words?: SmsWords;
  ownNames?: string[];
  /** Extra senders from the SMS_TRUSTED_SENDERS environment setting; they count as the first bank. */
  extraTrusted?: string[];
};

export function readAlert<B extends Bank>(input: { sender: string; text: string; receivedAt: Date }, s: AlertSettings<B>): { result: ParseResult; bank: B | null } {
  const base = { ...input, words: s.words, ownNames: s.ownNames };
  // A first read only to find the account digits, which pick between two accounts at one bank.
  const first = parseSms({ ...base, knownSender: true });
  if (first.status === "ignored") return { result: first, bank: null };
  const bank = pickBank(s.banks, input.sender, first.fields.accountHint, s.extraTrusted);
  const result = parseSms({ ...base, knownSender: !!bank, holdTransfers: bank?.hold_transfers ?? true });
  if (result.status === "parsed" && bank && !bank.auto_import) {
    return { result: { status: "review", reason: `Automatic import is off for ${bank.name}`, fields: result.fields }, bank };
  }
  return { result, bank };
}
