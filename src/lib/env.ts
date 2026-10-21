import "server-only";

export class ConfigError extends Error {}

function need(name: string, minLen = 1): string {
  const v = process.env[name];
  if (!v || v.length < minLen) throw new ConfigError(`${name} is not configured`);
  return v;
}

export const env = {
  databaseUrl: () => process.env.DATABASE_URL || process.env.POSTGRES_URL || need("DATABASE_URL"),
  sessionSecret: () => need("SESSION_SECRET", 32),
  adminPasswordHash: () => need("ADMIN_PASSWORD_HASH", 20),
  smsToken: () => need("SMS_INGEST_TOKEN", 32),
  smsAutoImport: () => (process.env.SMS_AUTO_IMPORT ?? "true").toLowerCase() !== "false",
};
