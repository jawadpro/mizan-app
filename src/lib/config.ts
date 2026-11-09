import "server-only";
import crypto from "node:crypto";
import webpush from "web-push";
import { q } from "./db";
import { env, setStoredConfig, type StoredConfig } from "./env";

// The settings the setup page saves (passphrase, signing secret, SMS token, notification keys).
// Read once per instance and kept for a short while; before setup is finished it is read every time.

const COLS =
  "session_secret, password_hash, sms_token, vapid_public, vapid_private, vapid_subject, setup_done_at, " +
  "(extract(epoch from sessions_valid_after) * 1000)::float8 AS sessions_valid_after_ms";
const TTL_MS = 30_000;
let loadedAt = 0;
let complete = false;

export type DbState = "missing" | "unreachable" | "not-migrated" | "ok";

async function read(): Promise<{ db: DbState; row: Partial<StoredConfig> }> {
  if (!env.hasDatabase()) return { db: "missing", row: {} };
  try {
    const { rows } = await q<StoredConfig>(`SELECT ${COLS} FROM app.config WHERE id = 1`);
    return { db: "ok", row: rows[0] ?? {} };
  } catch (e) {
    // 42P01 = table missing, 3F000 = schema missing: the migrations haven't run on this database.
    const code = (e as { code?: string })?.code;
    return { db: code === "42P01" || code === "3F000" ? "not-migrated" : "unreachable", row: {} };
  }
}

/** Loads saved settings into env. Never throws: without a database the environment alone decides. */
export async function loadConfig(force = false): Promise<DbState> {
  if (!force && complete && Date.now() - loadedAt < TTL_MS) return "ok";
  const { db, row } = await read();
  // Keep what was loaded before if the database blips, so signed-in sessions don't drop.
  if (db === "ok" || !complete) setStoredConfig(row);
  loadedAt = Date.now();
  complete = db === "ok" && env.setupDone();
  return db;
}

export type SetupState = { db: DbState; hasPassword: boolean; done: boolean };

export async function setupState(): Promise<SetupState> {
  // An install configured by environment (like the original one) never sees the setup page.
  if (process.env.ADMIN_PASSWORD_HASH) {
    await loadConfig();
    return { db: "ok", hasPassword: true, done: true };
  }
  const db = await loadConfig(true);
  return { db, hasPassword: env.hasPassword(), done: env.setupDone() };
}

export const MIN_PASSPHRASE = 12;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

const secret = () => crypto.randomBytes(32).toString("base64url");

/**
 * First run: saves the passphrase and creates the secrets the environment doesn't provide.
 * Returns false when a passphrase already exists, so a second visitor can't take over the install.
 */
export async function claimInstall(password: string, origin: string): Promise<boolean> {
  const keys = env.vapid() ? null : webpush.generateVAPIDKeys();
  const { rowCount } = await q(
    `INSERT INTO app.config AS c (id, session_secret, password_hash, sms_token, vapid_public, vapid_private, vapid_subject)
     VALUES (1, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET session_secret = coalesce(c.session_secret, EXCLUDED.session_secret),
       password_hash = EXCLUDED.password_hash, sms_token = coalesce(c.sms_token, EXCLUDED.sms_token),
       vapid_public = coalesce(c.vapid_public, EXCLUDED.vapid_public), vapid_private = coalesce(c.vapid_private, EXCLUDED.vapid_private),
       vapid_subject = coalesce(c.vapid_subject, EXCLUDED.vapid_subject), updated_at = now()
     WHERE c.password_hash IS NULL`,
    [
      env.fromEnv("SESSION_SECRET") ? null : secret(),
      hashPassword(password),
      env.fromEnv("SMS_INGEST_TOKEN") ? null : secret(),
      keys?.publicKey ?? null,
      keys?.privateKey ?? null,
      keys ? origin : null,
    ],
  );
  await loadConfig(true);
  return rowCount === 1;
}

export async function finishSetup() {
  await q(`INSERT INTO app.config AS c (id, setup_done_at) VALUES (1, now())
           ON CONFLICT (id) DO UPDATE SET setup_done_at = coalesce(c.setup_done_at, now()), updated_at = now()`);
  await loadConfig(true);
}

/** The SMS token, when the app created it (one set in the environment is never shown). */
export function savedSmsToken(): string | null {
  if (env.fromEnv("SMS_INGEST_TOKEN")) return null;
  try {
    return env.smsToken();
  } catch {
    return null;
  }
}

/** A new SMS token; the old one stops working. Only for a token the app created. */
export async function regenerateSmsToken(): Promise<string> {
  const token = secret();
  await q(`UPDATE app.config SET sms_token = $1, updated_at = now() WHERE id = 1`, [token]);
  await loadConfig(true);
  return token;
}

/**
 * Saves a new passphrase. It wins over ADMIN_PASSWORD_HASH from then on, and every session issued
 * before now is signed out. Returns the cut-off (epoch ms) so the caller can issue a fresh session after it.
 */
export async function changePassphrase(password: string): Promise<number> {
  const cutoff = Date.now();
  await q(
    `INSERT INTO app.config AS c (id, password_hash, sessions_valid_after) VALUES (1, $1, to_timestamp($2::float8 / 1000))
     ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
       sessions_valid_after = EXCLUDED.sessions_valid_after, updated_at = now()`,
    [hashPassword(password), cutoff],
  );
  await loadConfig(true);
  return cutoff;
}
