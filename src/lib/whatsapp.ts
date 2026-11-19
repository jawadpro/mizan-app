// WhatsApp assistant: the pure parts (webhook signature, reading Meta's payload, linking codes, YES/NO replies,
// matching a name to someone a bill was split with before). No database or network here, so tests can use it.
import crypto from "node:crypto";
import { normalizeCode } from "./pairing-code";

/** Meta signs each webhook body with the app secret: X-Hub-Signature-256: sha256=<hex HMAC>. */
export function verifyMetaSignature(rawBody: string | Buffer, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(m[1], "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export type InboundMessage = {
  /** Meta's message id ("wamid…"), used to skip a delivery Meta sends again. */
  id: string;
  /** The sender's number, digits only, international format. */
  from: string;
  /** The name on the sender's WhatsApp profile, when Meta includes it. */
  profileName: string | null;
  /** The text, or null for a photo, voice note or anything else that isn't text. */
  text: string | null;
  type: string;
  /** The business number the message was sent to. */
  phoneNumberId: string | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The messages in a WhatsApp Cloud API webhook. Delivery and read receipts ("statuses") are left out. */
export function parseWebhook(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const root = obj(body);
  if (!root || root.object !== "whatsapp_business_account") return out;
  for (const entry of arr(root.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const value = obj(obj(change)?.value);
      if (!value) continue;
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        const wa = str(obj(c)?.wa_id);
        const name = str(obj(obj(c)?.profile)?.name);
        if (wa && name) names.set(wa, name);
      }
      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const id = str(m?.id);
        const from = str(m?.from)?.replace(/\D/g, "") ?? "";
        if (!m || !id || !/^[0-9]{6,20}$/.test(from)) continue;
        const type = str(m.type) ?? "unknown";
        let text: string | null = null;
        if (type === "text") text = str(obj(m.text)?.body);
        // A tapped quick-reply button arrives as its own type, with the button's text.
        else if (type === "button") text = str(obj(m.button)?.text);
        else if (type === "interactive") {
          const i = obj(m.interactive);
          text = str(obj(i?.button_reply)?.title) ?? str(obj(i?.list_reply)?.title);
        }
        out.push({ id: id.slice(0, 200), from, profileName: names.get(from) ?? null, text: text?.slice(0, 2000) ?? null, type, phoneNumberId });
      }
    }
  }
  return out;
}

/**
 * The linking code in a message like "link ABCD-2345", "Link abcd 2345" or just "ABCD-2345", or null.
 * Only a whole message that is a code (with or without the word "link") counts, so normal chat never links by accident.
 */
export function linkCodeIn(text: string): string | null {
  const t = text.trim().replace(/^mizan\s+/i, "").replace(/^link\s*:?\s*/i, "");
  if (t.length > 12) return null;
  return normalizeCode(t);
}

const YES = /^(y|ya|yes|yep|yeah|yup|ok|okay|sure|confirm|confirmed|do it|go|go ahead|save|save it|haan|han|ji|jee|ji haan|theek hai|thik hai|done|👍|✅)$/i;
const NO = /^(n|no|nope|nah|cancel|stop|don'?t|dont|nahi|nahin|na|leave it|❌|👎)$/i;

/** Whether a reply confirms ("yes", "ok", "haan", 👍) or cancels ("no", "cancel", "nahi") a proposed change. */
export function confirmReply(text: string): "yes" | "no" | null {
  const t = text.trim().toLowerCase().replace(/[.!\s]+$/g, "").replace(/\s+/g, " ");
  if (YES.test(t)) return "yes";
  if (NO.test(t)) return "no";
  return null;
}

const tidy = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());

export type PersonMatch =
  | { kind: "known"; name: string }
  | { kind: "new"; name: string }
  | { kind: "ambiguous"; name: string; options: string[] };

/**
 * Matches a name typed in chat ("ali") to someone a bill has been split with before ("Ali Raza"), so the same person
 * isn't saved under two names. An exact match wins; otherwise a single person whose first name (or whole name) starts
 * with what was typed. Two or more such people means asking which one. Nobody means a new person, saved as typed.
 */
export function matchPerson(typed: string, known: string[]): PersonMatch {
  const t = tidy(typed);
  const lower = t.toLowerCase();
  const exact = known.find((k) => tidy(k).toLowerCase() === lower);
  if (exact) return { kind: "known", name: exact };
  if (lower.length >= 2) {
    const words = lower.split(" ");
    const hits = known.filter((k) => {
      const kw = tidy(k).toLowerCase().split(" ");
      // "ali" → "Ali Raza"; "ali r" → "Ali Raza"; "raza" alone is too loose to guess from.
      return words.every((w, i) => kw[i]?.startsWith(w));
    });
    const unique = [...new Map(hits.map((h) => [tidy(h).toLowerCase(), h])).values()];
    if (unique.length === 1) return { kind: "known", name: unique[0] };
    if (unique.length > 1) return { kind: "ambiguous", name: t, options: unique.slice(0, 6) };
  }
  const name = t === lower || t === t.toUpperCase() ? titleCase(t) : t;
  return { kind: "new", name: name.slice(0, 60) };
}

/** WhatsApp shows at most 4096 characters in one message; longer replies are cut at a line break. */
export function fitWhatsApp(text: string, max = 4000): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf("\n", max - 2);
  return `${t.slice(0, cut > max / 2 ? cut : max - 2).trimEnd()}\n…`;
}

/** "923001234567" → "+92 300 1234567" for showing in Settings (a rough grouping, good enough to recognise it). */
export function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.startsWith("92") && d.length === 12) return `+92 ${d.slice(2, 5)} ${d.slice(5)}`;
  return `+${d}`;
}

/** Masks a key for display: only the last four characters. */
export function hint(secret: string | null | undefined): string | null {
  return secret ? `••••${secret.slice(-4)}` : null;
}
