import "server-only";
import crypto from "node:crypto";
import { q, tx } from "./db";
import { env } from "./env";
import { formatCode, normalizeCode, randomCode } from "./pairing-code";

// iPhone pairing: Mizan shows a short single-use code; the universal Mizan Shortcut opens
// <address>/api/devices/pair?code=… and gets back this address and a token for that iPhone alone, which it keeps
// on the phone. The older Shortcut (URL and SMS token pasted by hand) keeps working alongside.

export const PAIRING_TTL_MIN = 10;
export const MAX_DEVICES = 5;
const TOKEN_RE = /^mzd_[A-Za-z0-9_-]{43}$/;

/** The shared iCloud Shortcut. It holds no address or token: pairing hands it this Mizan's address. */
const DEFAULT_SHORTCUT_URL = "https://www.icloud.com/shortcuts/d7ae4227390b4671b52dc6f44556d671";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest();
const codeDigest = (code: string) => crypto.createHmac("sha256", env.sessionSecret()).update(`pair:${code}`).digest();

/** The Shortcut people add, and the name the run-shortcut link opens. MIZAN_SHORTCUT_URL / _NAME override them. */
export function shortcutConfig() {
  const url = process.env.MIZAN_SHORTCUT_URL?.trim() || DEFAULT_SHORTCUT_URL;
  return {
    url: /^https:\/\/www\.icloud\.com\/shortcuts\/[A-Za-z0-9]+$/.test(url) ? url : null,
    name: (process.env.MIZAN_SHORTCUT_NAME?.trim() || "Mizan").slice(0, 60),
  };
}

/** This Mizan's own address, as the iPhone should use it: APP_URL if set, otherwise the address the request came in on. */
export function phoneUrl(req: Request): string {
  const fromEnv = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto.split(",")[0].trim()}://${host}`;
}

/** A fresh single-use code. Any unused code made before stops working. */
export async function createPairingCode(opts: { name?: string; replaces?: string } = {}) {
  const code = randomCode();
  const { rows } = await tx(async (run) => {
    await run(`DELETE FROM app.pairing_codes WHERE used_at IS NULL OR created_at < now() - interval '1 day'`);
    return run<{ expires_at: Date }>(
      `INSERT INTO app.pairing_codes (code_digest, device_name, replaces_id, expires_at)
       VALUES ($1, $2, (SELECT id FROM app.paired_devices WHERE id = $3::uuid AND revoked_at IS NULL),
               now() + make_interval(mins => $4))
       RETURNING expires_at`,
      [codeDigest(code), opts.name?.trim().slice(0, 60) || null, opts.replaces ?? null, PAIRING_TTL_MIN],
    );
  });
  return { code, display: formatCode(code), expiresAt: rows[0].expires_at };
}

export type PairResult = { ok: true; deviceId: string; token: string } | { ok: false; reason: "invalid" | "limit" };

/** Turns a valid, unused, unexpired code into a new device and returns its token, once. Only a digest is kept. */
export async function redeemPairingCode(rawCode: string, rawName: string): Promise<PairResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "invalid" };
  const token = `mzd_${crypto.randomBytes(32).toString("base64url")}`;
  return tx(async (run) => {
    const used = await run<{ device_name: string | null; replaces_id: string | null }>(
      `UPDATE app.pairing_codes SET used_at = now()
       WHERE code_digest = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING device_name, replaces_id`,
      [codeDigest(code)],
    );
    const pc = used.rows[0];
    if (!pc) return { ok: false, reason: "invalid" } as const;
    let keptName: string | null = null;
    if (pc.replaces_id) {
      // Reconnecting replaces the old token and keeps the name the iPhone had.
      const old = await run<{ name: string }>(
        `UPDATE app.paired_devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING name`, [pc.replaces_id]);
      keptName = old.rows[0]?.name ?? null;
    }
    const active = await run<{ n: number }>(`SELECT count(*)::int AS n FROM app.paired_devices WHERE revoked_at IS NULL`);
    if (active.rows[0].n >= MAX_DEVICES) return { ok: false, reason: "limit" } as const;
    const name = (pc.device_name || keptName || rawName.replace(/[\u0000-\u001f]/g, "").trim() || "iPhone").slice(0, 60);
    const dev = await run<{ id: string }>(
      `INSERT INTO app.paired_devices (name, token_digest, token_hint) VALUES ($1, $2, $3) RETURNING id`,
      [name, sha256(token), token.slice(-4)],
    );
    await run(`UPDATE app.pairing_codes SET device_id = $1 WHERE code_digest = $2`, [dev.rows[0].id, codeDigest(code)]);
    return { ok: true, deviceId: dev.rows[0].id, token } as const;
  });
}

export const looksLikeDeviceToken = (t: string) => TOKEN_RE.test(t);

/** The paired iPhone a device token belongs to, or null (wrong or removed). */
export async function authenticateDevice(token: string): Promise<string | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await q<{ id: string }>(
    `UPDATE app.paired_devices SET last_seen_at = now() WHERE token_digest = $1 AND revoked_at IS NULL RETURNING id`,
    [sha256(token)],
  );
  return rows[0]?.id ?? null;
}

const COUNTER: Record<string, string> = {
  imported: "imported_count", review: "review_count", duplicate: "duplicate_count", ignored: "ignored_count", failed: "failed_count",
};

/** Counts one delivery for the device. Stores no message content. */
export async function recordIngest(deviceId: string, outcome: string) {
  const col = COUNTER[outcome];
  if (!col) return;
  // col comes from the fixed table above, never from input.
  await q(`UPDATE app.paired_devices SET ${col} = ${col} + 1${outcome === "failed" ? "" : ", last_sms_at = now()"} WHERE id = $1`, [deviceId]);
}

export async function recordTest(deviceId: string) {
  await q(`UPDATE app.paired_devices SET last_test_at = now() WHERE id = $1`, [deviceId]);
}

export type DeviceRow = {
  id: string; name: string; kind: "shortcut"; token_hint: string; paired_at: string;
  last_seen_at: string | null; last_sms_at: string | null; last_test_at: string | null; revoked_at: string | null;
  imported_count: number; review_count: number; duplicate_count: number; ignored_count: number; failed_count: number;
};

export async function listDevices(): Promise<DeviceRow[]> {
  const { rows } = await q<DeviceRow>(
    `SELECT id, name, kind, token_hint, paired_at, last_seen_at, last_sms_at, last_test_at, revoked_at,
            imported_count, review_count, duplicate_count, ignored_count, failed_count
     FROM app.paired_devices WHERE revoked_at IS NULL OR revoked_at > now() - interval '30 days'
     ORDER BY revoked_at IS NOT NULL, paired_at DESC`,
  );
  return rows;
}

/** What happened to the latest pairing code, for the setup screen to follow along. */
export async function latestPairing() {
  const { rows } = await q<{ expires_at: string; used_at: string | null; device_id: string | null }>(
    `SELECT expires_at, used_at, device_id FROM app.pairing_codes ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function renameDevice(id: string, name: string): Promise<boolean> {
  const { rowCount } = await q(`UPDATE app.paired_devices SET name = $2 WHERE id = $1 AND revoked_at IS NULL`, [id, name]);
  return rowCount === 1;
}

/** Removes a device: its token stops working at once. */
export async function revokeDevice(id: string): Promise<boolean> {
  const { rowCount } = await q(`UPDATE app.paired_devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  return rowCount === 1;
}
