import "server-only";
import crypto from "node:crypto";
import { q, tx } from "./db";
import { env } from "./env";
import { formatCode, normalizeCode, randomCode } from "./pairing-code";

// iPhone pairing: Mizan shows a QR code with a short single-use code; the universal Mizan Shortcut opens
// <address>/api/devices/pair?code=… and gets back this address and a token for that iPhone alone, which it keeps
// on the phone. A device counts as connected only once the iPhone has used its token (last_seen_at is set), so
// Mizan never says "connected" before the phone has actually saved its key. Shortcuts set up by hand with the SMS
// token keep working; the app just no longer shows that way.

export const PAIRING_TTL_MIN = 10;
export const MAX_DEVICES = 5;
const TOKEN_RE = /^mzd_[A-Za-z0-9_-]{43}$/;

/**
 * The shared iCloud Shortcut. It holds no address or token: pairing hands it this Mizan's address.
 * To publish a new version of the Shortcut, change this one line (or set MIZAN_SHORTCUT_URL on the server).
 */
export const DEFAULT_SHORTCUT_URL = "https://www.icloud.com/shortcuts/d7ae4227390b4671b52dc6f44556d671";

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

/**
 * Turns a valid, unexpired code into a new device and returns its token. Only a digest is kept.
 *
 * The device is "pending" until the iPhone first uses its token (see authenticateDevice). Until then the same code
 * may be used again within its 10 minutes, and the newer use replaces the pending device. That way a link preview,
 * a browser or a Shortcut run that fails before saving its key can't use up the code: whatever opens the link
 * last, and then proves it kept the key, is the device that stays.
 */
export async function redeemPairingCode(rawCode: string, rawName: string): Promise<PairResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "invalid" };
  const token = `mzd_${crypto.randomBytes(32).toString("base64url")}`;
  return tx(async (run) => {
    const used = await run<{ device_name: string | null; replaces_id: string | null; prior_id: string | null }>(
      `UPDATE app.pairing_codes pc SET used_at = now()
       WHERE code_digest = $1 AND expires_at > now()
         AND (used_at IS NULL OR device_id IN (SELECT id FROM app.paired_devices WHERE last_seen_at IS NULL AND revoked_at IS NULL))
       RETURNING device_name, replaces_id, device_id AS prior_id`,
      [codeDigest(code)],
    );
    const pc = used.rows[0];
    if (!pc) return { ok: false, reason: "invalid" } as const;
    let priorName: string | null = null;
    if (pc.prior_id) {
      // An earlier use of this code that never confirmed: drop it, this one takes its place.
      const prior = await run<{ name: string }>(`DELETE FROM app.paired_devices WHERE id = $1 AND last_seen_at IS NULL RETURNING name`, [pc.prior_id]);
      priorName = prior.rows[0]?.name ?? null;
    }
    let keptName: string | null = null;
    if (pc.replaces_id) {
      // Reconnecting keeps the name the iPhone had. The old token keeps working until the new one is confirmed.
      const old = await run<{ name: string }>(`SELECT name FROM app.paired_devices WHERE id = $1 AND revoked_at IS NULL`, [pc.replaces_id]);
      keptName = old.rows[0]?.name ?? null;
    }
    const active = await run<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.paired_devices WHERE revoked_at IS NULL AND id IS DISTINCT FROM $1::uuid`, [pc.replaces_id]);
    if (active.rows[0].n >= MAX_DEVICES) return { ok: false, reason: "limit" } as const;
    const name = (pc.device_name || keptName || priorName || rawName.replace(/[\u0000-\u001f]/g, "").trim() || "iPhone").slice(0, 60);
    const dev = await run<{ id: string }>(
      `INSERT INTO app.paired_devices (name, token_digest, token_hint) VALUES ($1, $2, $3) RETURNING id`,
      [name, sha256(token), token.slice(-4)],
    );
    await run(`UPDATE app.pairing_codes SET device_id = $1 WHERE code_digest = $2`, [dev.rows[0].id, codeDigest(code)]);
    return { ok: true, deviceId: dev.rows[0].id, token } as const;
  });
}

export const looksLikeDeviceToken = (t: string) => TOKEN_RE.test(t);

/**
 * The paired iPhone a device token belongs to, or null (wrong or removed). The first time a token is used, the
 * pairing is confirmed: the iPhone has saved its key. Only then does a Reconnect stop the old token.
 */
export async function authenticateDevice(token: string): Promise<string | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await q<{ id: string; first: boolean }>(
    `UPDATE app.paired_devices p SET last_seen_at = now()
     FROM (SELECT id, last_seen_at IS NULL AS first FROM app.paired_devices WHERE token_digest = $1 AND revoked_at IS NULL) o
     WHERE p.id = o.id
     RETURNING p.id, o.first`,
    [sha256(token)],
  );
  const dev = rows[0];
  if (!dev) return null;
  if (dev.first) {
    await q(
      `UPDATE app.paired_devices SET revoked_at = now()
       WHERE revoked_at IS NULL AND id <> $1 AND id IN (SELECT replaces_id FROM app.pairing_codes WHERE device_id = $1)`,
      [dev.id],
    );
  }
  return dev.id;
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
