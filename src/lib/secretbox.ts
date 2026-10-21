import "server-only";
import crypto from "node:crypto";
import { env } from "./env";
import { q } from "./db";

// Small encrypted key-value store for credentials the app obtains at runtime (not env vars).

function key(): Buffer {
  return crypto.createHmac("sha256", env.sessionSecret()).update("mizan:secretbox:v1").digest();
}

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function open(sealed: string): string | null {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    // Wrong key (SESSION_SECRET rotated) or tampered value.
    return null;
  }
}

export async function getSecret(name: string): Promise<string | null> {
  const { rows } = await q<{ value_enc: string }>(`SELECT value_enc FROM app.app_secrets WHERE name = $1`, [name]);
  return rows[0] ? open(rows[0].value_enc) : null;
}

export async function setSecret(name: string, value: string) {
  await q(
    `INSERT INTO app.app_secrets (name, value_enc) VALUES ($1,$2)
     ON CONFLICT (name) DO UPDATE SET value_enc = EXCLUDED.value_enc, updated_at = now()`,
    [name, seal(value)],
  );
}

export async function deleteSecret(name: string) {
  await q(`DELETE FROM app.app_secrets WHERE name = $1`, [name]);
}
