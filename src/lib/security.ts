import "server-only";
import crypto from "node:crypto";
import { q } from "./db";
import { missingTable, readCookie, secureFlag } from "./auth";
import { HttpError } from "./http";
import { deviceLabel } from "./device";

export { deviceLabel, maskEmail } from "./device";

/** The cookie that marks a remembered device, so it can skip the email code. */
export const DEVICE_COOKIE = "mizan_device";
const DEVICE_TTL_S = 400 * 24 * 3600;
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const RECOVERY_COUNT = 8;

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("base64url");

// ---------- Email ----------

/** Email codes need a Resend API key in the environment. EMAIL_CODES=off turns them off (a way back in if email breaks). */
export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && (process.env.EMAIL_CODES ?? "").toLowerCase() !== "off";
}

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "Mizan <onboarding@resend.dev>", to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("[mizan] email not sent, status", res.status);
    return res.ok;
  } catch (e) {
    console.error("[mizan] email not sent", (e as Error)?.name);
    return false;
  }
}

function codeEmail(code: string, purpose: "login" | "enable", device: string) {
  const lead = purpose === "login" ? `Someone with your passphrase is signing in to Mizan on ${device}.` : "You're turning on email codes for Mizan.";
  const tail = purpose === "login" ? "If this wasn't you, change your passphrase in Settings: your passphrase is known to someone else." : "If this wasn't you, ignore this email.";
  const text = `${lead}\n\nYour code: ${code}\n\nIt works for ${CODE_TTL_MIN} minutes.\n\n${tail}`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>${lead}</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>
<p>It works for ${CODE_TTL_MIN} minutes.</p><p style="color:#666;font-size:13px">${tail}</p></div>`;
  return { text, html };
}

// ---------- Settings ----------

export type SecuritySettings = { email: string | null; emailCodesOn: boolean; recoveryLeft: number };

export async function securitySettings(): Promise<SecuritySettings> {
  try {
    const { rows } = await q<{ email: string | null; email_codes_on: boolean; n: number }>(
      `SELECT email, email_codes_on, cardinality(recovery_hashes)::int AS n FROM app.security WHERE id = 1`,
    );
    const r = rows[0];
    return { email: r?.email ?? null, emailCodesOn: !!r?.email_codes_on, recoveryLeft: r?.n ?? 0 };
  } catch (e) {
    if (missingTable(e)) return { email: null, emailCodesOn: false, recoveryLeft: 0 };
    throw e;
  }
}

/** Whether signing in on a device that isn't remembered needs an email code right now. */
export async function emailCodesRequired(): Promise<SecuritySettings | null> {
  if (!emailConfigured()) return null;
  const s = await securitySettings();
  return s.emailCodesOn && s.email ? s : null;
}

function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes = Array.from({ length: RECOVERY_COUNT }, () => {
    const b = crypto.randomBytes(10);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => sha(normalizeRecovery(c))) };
}

const normalizeRecovery = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function turnOnEmailCodes(email: string): Promise<string[]> {
  const { codes, hashes } = newRecoveryCodes();
  await q(
    `INSERT INTO app.security AS s (id, email, email_codes_on, recovery_hashes) VALUES (1, $1, true, $2)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, email_codes_on = true, recovery_hashes = EXCLUDED.recovery_hashes, updated_at = now()`,
    [email, hashes],
  );
  return codes;
}

export async function turnOffEmailCodes() {
  await q(`UPDATE app.security SET email_codes_on = false, recovery_hashes = '{}', updated_at = now() WHERE id = 1`);
}

export async function regenerateRecoveryCodes(): Promise<string[]> {
  const { codes, hashes } = newRecoveryCodes();
  await q(`UPDATE app.security SET recovery_hashes = $1, updated_at = now() WHERE id = 1`, [hashes]);
  return codes;
}

/** Uses up a recovery code. True when it was one of the unused ones. */
async function useRecoveryCode(code: string): Promise<boolean> {
  const n = normalizeRecovery(code);
  if (n.length !== 10) return false;
  const { rowCount } = await q(
    `UPDATE app.security SET recovery_hashes = array_remove(recovery_hashes, $1), updated_at = now() WHERE id = 1 AND $1 = ANY(recovery_hashes)`,
    [sha(n)],
  );
  return (rowCount ?? 0) > 0;
}

// ---------- Email codes ----------

/** Creates a code and emails it. Returns the code's id and whether the email went out. */
export async function sendCode(purpose: "login" | "enable", email: string, remember: boolean, ua: string | null): Promise<{ id: string; sent: boolean }> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const id = crypto.randomUUID();
  await q(
    `INSERT INTO app.email_codes (id, purpose, code_hash, email, remember, expires_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
    [id, purpose, sha(`${id}:${code}`), email, remember, CODE_TTL_MIN],
  );
  if (Math.random() < 0.1) q(`DELETE FROM app.email_codes WHERE expires_at < now() - interval '1 day'`).catch(() => {});
  const { text, html } = codeEmail(code, purpose, deviceLabel(ua));
  const sent = await sendEmail(email, purpose === "login" ? `Mizan sign-in code: ${code}` : `Mizan code: ${code}`, text, html);
  return { id, sent };
}

/**
 * Checks a typed code. For sign-in, an unused recovery code works too. Each code allows a few tries and works once.
 * Returns what the code was made for, or throws a message to show.
 */
export async function checkCode(id: string, purpose: "login" | "enable", typed: string): Promise<{ email: string; remember: boolean; recovery: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "That code has expired. Start again.");
  const { rows } = await q<{ email: string; remember: boolean; code_hash: string }>(
    `UPDATE app.email_codes SET attempts = attempts + 1
     WHERE id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() AND attempts < $3
     RETURNING email, remember, code_hash`,
    [id, purpose, MAX_ATTEMPTS],
  );
  const row = rows[0];
  if (!row) throw new HttpError(400, "That code has expired or was tried too many times. Start again.", { expired: true });
  const digits = typed.replace(/\s/g, "");
  let recovery = false;
  if (/^\d{6}$/.test(digits)) {
    if (sha(`${id}:${digits}`) !== row.code_hash) throw new HttpError(400, "That code isn't right", { fields: { code: ["That code isn't right"] } });
  } else if (purpose === "login" && (await useRecoveryCode(typed))) {
    recovery = true;
  } else {
    throw new HttpError(400, purpose === "login" ? "Enter the 6-digit code from the email, or a recovery code" : "Enter the 6-digit code from the email", { fields: { code: ["That code isn't right"] } });
  }
  await q(`UPDATE app.email_codes SET used_at = now() WHERE id = $1`, [id]);
  return { email: row.email, remember: row.remember, recovery };
}

// ---------- Remembered devices ----------

/** The remembered device a request comes from, if its cookie is valid. */
export async function trustedDeviceOf(req: Request): Promise<string | null> {
  const raw = readCookie(req.headers.get("cookie") ?? "", DEVICE_COOKIE);
  const [id, token] = (raw ?? "").split(".");
  if (!id || !token || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const { rows } = await q<{ id: string }>(
      `UPDATE app.trusted_devices SET last_used_at = now() WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL RETURNING id`,
      [id, sha(token)],
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

/** Remembers this device. Returns its id and the cookie to set. */
export async function trustDevice(ua: string | null): Promise<{ id: string; cookie: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const { rows } = await q<{ id: string }>(`INSERT INTO app.trusted_devices (token_hash, user_agent) VALUES ($1, $2) RETURNING id`, [sha(token), ua]);
  const id = rows[0].id;
  return { id, cookie: `${DEVICE_COOKIE}=${id}.${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_TTL_S}${secureFlag()}` };
}

// ---------- Signed-in devices ----------

export type DeviceRow = {
  /** A short hash of the session id, so the real one never leaves the server. */
  id: string;
  label: string;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  remembered: boolean;
  trusted: boolean;
  current: boolean;
};

const PUBLIC_ID = `left(encode(sha256(convert_to(s.sid, 'UTF8')), 'hex'), 20)`;

export async function listDevices(currentSid: string): Promise<DeviceRow[]> {
  if (Math.random() < 0.1) q(`DELETE FROM app.sessions WHERE expires_at < now() - interval '7 days'`).catch(() => {});
  const { rows } = await q<{ id: string; sid: string; user_agent: string | null; ip: string | null; created_at: string; last_seen_at: string; remembered: boolean; trusted: boolean }>(
    `SELECT ${PUBLIC_ID} AS id, s.sid, s.user_agent, s.ip, s.created_at, s.last_seen_at, s.remembered,
            (d.id IS NOT NULL AND d.revoked_at IS NULL) AS trusted
     FROM app.sessions s LEFT JOIN app.trusted_devices d ON d.id = s.device_id
     WHERE s.revoked_at IS NULL AND s.expires_at > now()
     ORDER BY (s.sid = $1) DESC, s.last_seen_at DESC LIMIT 50`,
    [currentSid],
  );
  return rows.map((r) => ({
    id: r.id, label: deviceLabel(r.user_agent), ip: r.ip, created_at: r.created_at, last_seen_at: r.last_seen_at,
    remembered: r.remembered, trusted: r.trusted, current: r.sid === currentSid,
  }));
}

/** Signs out one device (by its public id), and forgets it so it needs the email code again. Never the current one. */
export async function signOutDevice(id: string, currentSid: string): Promise<boolean> {
  const { rows } = await q<{ device_id: string | null }>(
    `UPDATE app.sessions s SET revoked_at = now() WHERE ${PUBLIC_ID} = $1 AND s.sid <> $2 AND s.revoked_at IS NULL RETURNING s.device_id`,
    [id, currentSid],
  );
  if (!rows[0]) return false;
  if (rows[0].device_id) {
    await q(`UPDATE app.trusted_devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [rows[0].device_id]);
  }
  return true;
}

/** Signs out and forgets every device except the one given (by session, and by remembered device). */
export async function signOutOthers(keepSid: string | null, keepDevice: string | null) {
  try {
    await q(`UPDATE app.sessions SET revoked_at = now() WHERE revoked_at IS NULL AND sid IS DISTINCT FROM $1`, [keepSid]);
    await q(`UPDATE app.trusted_devices SET revoked_at = now() WHERE revoked_at IS NULL AND id IS DISTINCT FROM $1`, [keepDevice]);
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

/** Signs out the session in a request (the Sign out button). */
export async function revokeSession(sid: string) {
  await q(`UPDATE app.sessions SET revoked_at = now() WHERE sid = $1 AND revoked_at IS NULL`, [sid]).catch(() => {});
}

/** Records that the passphrase was just entered on this session, for sensitive actions. */
export async function markConfirmed(sid: string) {
  await q(`UPDATE app.sessions SET confirmed_at = now() WHERE sid = $1`, [sid]);
}

export async function setSessionDevice(sid: string, deviceId: string) {
  await q(`UPDATE app.sessions SET device_id = $2 WHERE sid = $1`, [sid, deviceId]);
}
