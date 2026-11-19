import "server-only";
import crypto from "node:crypto";
import { q, tx } from "./db";
import { env } from "./env";
import { formatCode, randomCode } from "./pairing-code";
import type { WhatsAppSettings } from "./whatsapp-config";

// Linked WhatsApp numbers, linking codes, the short chat memory and changes waiting for a YES.

export const LINK_TTL_MIN = 15;
export const MAX_NUMBERS = 5;
/** How far back the assistant remembers a chat, and how many messages of it. */
const MEMORY_HOURS = 6;
const MEMORY_TURNS = 12;
/** A proposed change has to be confirmed within this long. */
export const PENDING_MIN = 15;

const codeDigest = (code: string) => crypto.createHmac("sha256", env.sessionSecret()).update(`whatsapp-link:${code}`).digest();

export type LinkedNumber = { id: string; phone: string; name: string; linked_at: string; last_message_at: string | null; message_count: number };

export async function listNumbers(): Promise<LinkedNumber[]> {
  const { rows } = await q<LinkedNumber>(
    `SELECT id, phone, name, linked_at, last_message_at, message_count FROM app.whatsapp_numbers WHERE revoked_at IS NULL ORDER BY linked_at`,
  );
  return rows;
}

export async function numberByPhone(phone: string): Promise<LinkedNumber | null> {
  const { rows } = await q<LinkedNumber>(
    `SELECT id, phone, name, linked_at, last_message_at, message_count FROM app.whatsapp_numbers WHERE phone = $1 AND revoked_at IS NULL`,
    [phone],
  );
  return rows[0] ?? null;
}

export async function getNumber(id: string): Promise<LinkedNumber | null> {
  const { rows } = await q<LinkedNumber>(
    `SELECT id, phone, name, linked_at, last_message_at, message_count FROM app.whatsapp_numbers WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

export async function unlinkNumber(id: string): Promise<boolean> {
  const { rowCount } = await q(`UPDATE app.whatsapp_numbers SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  if (rowCount) await q(`DELETE FROM app.whatsapp_turns WHERE number_id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/** A fresh single-use code to send to the bot. Any unused code made before stops working. */
export async function createLinkCode(name?: string) {
  const code = randomCode();
  const { rows } = await tx(async (run) => {
    await run(`DELETE FROM app.whatsapp_link_codes WHERE used_at IS NULL OR created_at < now() - interval '1 day'`);
    return run<{ expires_at: string }>(
      `INSERT INTO app.whatsapp_link_codes (code_digest, name, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3)) RETURNING expires_at`,
      [codeDigest(code), name?.trim().slice(0, 60) || null, LINK_TTL_MIN],
    );
  });
  return { code, display: formatCode(code), expiresAt: rows[0].expires_at };
}

export type LinkResult = { ok: true; number: LinkedNumber } | { ok: false; reason: "invalid" | "limit" };

/** Links the number a valid code came from. The same number linked again just stays linked. */
export async function redeemLinkCode(code: string, phone: string, profileName: string | null): Promise<LinkResult> {
  return tx(async (run) => {
    const { rows: c } = await run<{ name: string | null }>(
      `UPDATE app.whatsapp_link_codes SET used_at = now() WHERE code_digest = $1 AND used_at IS NULL AND expires_at > now() RETURNING name`,
      [codeDigest(code)],
    );
    if (!c.length) return { ok: false as const, reason: "invalid" as const };
    const { rows: existing } = await run<LinkedNumber>(
      `SELECT id, phone, name, linked_at, last_message_at, message_count FROM app.whatsapp_numbers WHERE phone = $1 AND revoked_at IS NULL`,
      [phone],
    );
    if (existing[0]) return { ok: true as const, number: existing[0] };
    const { rows: [{ n }] } = await run<{ n: number }>(`SELECT count(*)::int AS n FROM app.whatsapp_numbers WHERE revoked_at IS NULL`);
    if (n >= MAX_NUMBERS) return { ok: false as const, reason: "limit" as const };
    const name = (c[0].name || profileName || "WhatsApp").replace(/\s+/g, " ").trim().slice(0, 60) || "WhatsApp";
    const { rows } = await run<LinkedNumber>(
      `INSERT INTO app.whatsapp_numbers (phone, name) VALUES ($1, $2)
       RETURNING id, phone, name, linked_at, last_message_at, message_count`,
      [phone, name],
    );
    await run(`UPDATE app.whatsapp_link_codes SET number_id = $2 WHERE code_digest = $1`, [codeDigest(code), rows[0].id]);
    return { ok: true as const, number: rows[0] };
  });
}

/** Whether this message id is new. Meta sends a webhook again when it isn't answered quickly, so each id is handled once. */
export async function firstDelivery(messageId: string): Promise<boolean> {
  const { rowCount } = await q(`INSERT INTO app.whatsapp_inbox (message_id) VALUES ($1) ON CONFLICT DO NOTHING`, [messageId]);
  if (Math.random() < 0.05) q(`DELETE FROM app.whatsapp_inbox WHERE received_at < now() - interval '7 days'`).catch(() => {});
  return (rowCount ?? 0) > 0;
}

export async function touchNumber(id: string) {
  await q(`UPDATE app.whatsapp_numbers SET last_message_at = now(), message_count = message_count + 1 WHERE id = $1`, [id]);
}

export type Turn = { role: "user" | "assistant"; body: string };

export async function recentTurns(numberId: string): Promise<Turn[]> {
  const { rows } = await q<Turn>(
    `SELECT role, body FROM (
       SELECT role, body, created_at, id FROM app.whatsapp_turns
       WHERE number_id = $1 AND created_at > now() - make_interval(hours => $2)
       ORDER BY created_at DESC, id DESC LIMIT $3
     ) t ORDER BY created_at, id`,
    [numberId, MEMORY_HOURS, MEMORY_TURNS],
  );
  return rows;
}

export async function addTurns(numberId: string, turns: Turn[]) {
  for (const t of turns) {
    await q(`INSERT INTO app.whatsapp_turns (number_id, role, body) VALUES ($1, $2, $3)`, [numberId, t.role, t.body.slice(0, 4000)]);
  }
  if (Math.random() < 0.05) q(`DELETE FROM app.whatsapp_turns WHERE created_at < now() - interval '1 day'`).catch(() => {});
}

export async function clearTurns(numberId: string) {
  await q(`DELETE FROM app.whatsapp_turns WHERE number_id = $1`, [numberId]);
}

export async function setPending(numberId: string, action: unknown, summary: string) {
  await q(
    `INSERT INTO app.whatsapp_pending (number_id, action, summary, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))
     ON CONFLICT (number_id) DO UPDATE SET action = EXCLUDED.action, summary = EXCLUDED.summary, expires_at = EXCLUDED.expires_at`,
    [numberId, JSON.stringify(action), summary.slice(0, 1000), PENDING_MIN],
  );
}

/** The change waiting for a YES, taken off the list (so it can only be confirmed once). */
export async function takePending(numberId: string): Promise<{ action: unknown; summary: string } | null> {
  const { rows } = await q<{ action: unknown; summary: string; live: boolean }>(
    `DELETE FROM app.whatsapp_pending WHERE number_id = $1 RETURNING action, summary, expires_at > now() AS live`,
    [numberId],
  );
  return rows[0]?.live ? { action: rows[0].action, summary: rows[0].summary } : null;
}

export async function hasPending(numberId: string): Promise<boolean> {
  const { rows } = await q(`SELECT 1 FROM app.whatsapp_pending WHERE number_id = $1 AND expires_at > now()`, [numberId]);
  return rows.length > 0;
}

// ---- Sending through the WhatsApp Cloud API ----

// WHATSAPP_API_BASE points at a stand-in server for local testing only.
const GRAPH = () => `${process.env.WHATSAPP_API_BASE?.trim().replace(/\/$/, "") || "https://graph.facebook.com"}/${process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0"}`;

export class WhatsAppSendError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function graphCall(s: WhatsAppSettings, path: "messages" | "media", body: BodyInit, json: boolean): Promise<unknown> {
  if (!s.phoneNumberId || !s.accessToken) throw new WhatsAppSendError(0, "WhatsApp isn't set up yet");
  const res = await fetch(`${GRAPH()}/${encodeURIComponent(s.phoneNumberId)}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.accessToken}`, ...(json ? { "content-type": "application/json" } : {}) },
    body,
    signal: AbortSignal.timeout(path === "media" ? 30_000 : 15_000),
  });
  if (!res.ok) {
    let msg = `WhatsApp answered ${res.status}`;
    try {
      const e = (await res.json()) as { error?: { message?: string } };
      if (e.error?.message) msg = e.error.message.slice(0, 300);
    } catch {
      // keep the status line
    }
    throw new WhatsAppSendError(res.status, msg);
  }
  return res.json().catch(() => null);
}

const graphPost = (s: WhatsAppSettings, body: unknown) => graphCall(s, "messages", JSON.stringify(body), true);

/** Uploads a PNG to WhatsApp and returns its media id, which a message can then point at. */
export async function uploadImage(s: WhatsAppSettings, png: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "image/png");
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), filename);
  const r = (await graphCall(s, "media", form, false)) as { id?: string } | null;
  if (!r?.id) throw new WhatsAppSendError(0, "WhatsApp didn't return a media id");
  return r.id;
}

export async function sendImage(s: WhatsAppSettings, to: string, mediaId: string, caption: string) {
  await graphPost(s, { messaging_product: "whatsapp", recipient_type: "individual", to, type: "image", image: { id: mediaId, caption: caption.slice(0, 1024) } });
}

export async function sendText(s: WhatsAppSettings, to: string, text: string) {
  await graphPost(s, { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: false } });
}

/** Marks the message read and shows "typing…" while the answer is worked out. Best effort. */
export async function showTyping(s: WhatsAppSettings, messageId: string) {
  await graphPost(s, { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }).catch(() => {});
}
