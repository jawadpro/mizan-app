import crypto from "node:crypto";
import { normalizeText } from "./parser";

/**
 * Keyed fingerprint used to reject duplicate deliveries without storing the SMS text.
 *
 * - When the alert carries a bank reference or an explicit time, the text alone is unique,
 *   so a re-sent message is caught even if the Shortcut reports a different receivedAt.
 * - Otherwise receivedAt (to the minute) is included, so two genuinely identical alerts on
 *   different occasions (same amount, same merchant) are not merged.
 */
export function smsFingerprint(key: string, sender: string, text: string, receivedAt: Date, textIsUnique: boolean): string {
  const minute = new Date(Math.floor(receivedAt.getTime() / 60000) * 60000).toISOString();
  const material = [sender.trim().toUpperCase(), normalizeText(text).toLowerCase(), textIsUnique ? "" : minute].join("\n");
  return crypto.createHmac("sha256", key).update(material).digest("hex");
}
