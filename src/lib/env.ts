import "server-only";

export class ConfigError extends Error {}

/** What the setup page saved in app.config. Loaded by loadConfig() in config.ts before a request uses it. */
export type StoredConfig = {
  session_secret: string | null;
  password_hash: string | null;
  sms_token: string | null;
  vapid_public: string | null;
  vapid_private: string | null;
  vapid_subject: string | null;
  setup_done_at: string | null;
  /** Epoch ms; sessions issued before it are signed out (set when the passphrase changes in Settings). */
  sessions_valid_after_ms: number | null;
};

let stored: Partial<StoredConfig> = {};

export function setStoredConfig(c: Partial<StoredConfig>) {
  stored = c;
}

/** An environment variable wins over the saved value, so an install configured by environment keeps working unchanged. */
function pick(name: string, saved: string | null | undefined, minLen: number): string | null {
  const v = process.env[name];
  if (v && v.length >= minLen) return v;
  if (saved && saved.length >= minLen) return saved;
  return null;
}

function need(name: string, saved: string | null | undefined, minLen = 1): string {
  const v = pick(name, saved, minLen);
  if (!v) throw new ConfigError(`${name} is not configured`);
  return v;
}

export const env = {
  hasDatabase: () => !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
  databaseUrl: () => process.env.DATABASE_URL || process.env.POSTGRES_URL || need("DATABASE_URL", null),
  sessionSecret: () => need("SESSION_SECRET", stored.session_secret, 32),
  // A passphrase changed in Settings is saved in app.config and wins over ADMIN_PASSWORD_HASH,
  // so the environment value only applies until the first change.
  adminPasswordHash: () => (stored.password_hash && stored.password_hash.length >= 20 ? stored.password_hash : need("ADMIN_PASSWORD_HASH", null, 20)),
  sessionsValidAfter: () => stored.sessions_valid_after_ms ?? 0,
  smsToken: () => need("SMS_INGEST_TOKEN", stored.sms_token, 32),
  smsAutoImport: () => (process.env.SMS_AUTO_IMPORT ?? "true").toLowerCase() !== "false",
  vapid: () => {
    const pub = pick("VAPID_PUBLIC_KEY", stored.vapid_public, 1);
    const priv = pick("VAPID_PRIVATE_KEY", stored.vapid_private, 1);
    const subject = pick("VAPID_SUBJECT", stored.vapid_subject, 1);
    return pub && priv && subject ? { pub, priv, subject } : null;
  },
  /** Whether a value comes from the environment (so the app can't show or change it). */
  fromEnv: (name: "SESSION_SECRET" | "ADMIN_PASSWORD_HASH" | "SMS_INGEST_TOKEN") => !!process.env[name],
  /** An install configured by environment (like the original one) counts as set up. */
  setupDone: () => !!process.env.ADMIN_PASSWORD_HASH || !!stored.setup_done_at,
  hasPassword: () => !!pick("ADMIN_PASSWORD_HASH", stored.password_hash, 20),
};
