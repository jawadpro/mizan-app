/**
 * Reads one alert with the owner's settings: which bank sent it, what it says, and whether it can be
 * imported or must wait in Review. Pure, so Settings can show the same reading for a pasted message.
 */
import { chooseBank, type Bank } from "../banks";
import { parseSms, type ParseResult } from "./parser";
import type { SmsWords } from "./keywords";

export type AlertSettings<B extends Bank = Bank> = {
  banks: B[];
  words?: SmsWords;
  ownNames?: string[];
  /** Extra senders from the SMS_TRUSTED_SENDERS environment setting; they count as the first bank. */
  extraTrusted?: string[];
  /** The app's currency from Settings: alerts in another currency wait in Review. */
  currency?: string | null;
};

export function readAlert<B extends Bank>(input: { sender: string; text: string; receivedAt: Date }, s: AlertSettings<B>): { result: ParseResult; bank: B | null; choices: B[] } {
  const base = { ...input, words: s.words, ownNames: s.ownNames, currency: s.currency };
  // A first read only to find the account digits, which pick between accounts at one bank.
  const first = parseSms({ ...base, knownSender: true });
  if (first.status === "ignored") return { result: first, bank: null, choices: [] };
  const { bank, choices, unclear } = chooseBank(s.banks, input.sender, first.fields.accountDigits, s.extraTrusted);
  const known = !!bank || choices.length > 0;
  const hold = bank ? bank.hold_transfers : choices.length ? choices.some((b) => b.hold_transfers) : true;
  const result = parseSms({ ...base, knownSender: known, holdTransfers: hold });
  if (result.status === "ignored") return { result, bank, choices };
  // The account couldn't be told: it waits in Review, where the owner picks it.
  if (unclear) {
    const reason = result.status === "review" ? `${unclear}. Also: ${result.reason}` : unclear;
    return { result: { status: "review", reason, fields: result.fields }, bank: null, choices };
  }
  if (bank && bank.active === false) {
    const paused = `${bank.name} is paused`;
    return { result: { status: "review", reason: result.status === "review" ? `${paused}. Also: ${result.reason}` : paused, fields: result.fields }, bank, choices };
  }
  if (result.status === "parsed" && bank && !bank.auto_import) {
    return { result: { status: "review", reason: `Automatic import is off for ${bank.name}`, fields: result.fields }, bank, choices };
  }
  return { result, bank, choices };
}
