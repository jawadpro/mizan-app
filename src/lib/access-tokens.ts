import "server-only";
import crypto from "node:crypto";
import { q } from "./db";
import { missingTable } from "./auth";

// Personal access tokens for AI apps. A token is shown once when it is made; only its SHA-256 digest is stored.
// Tokens are 256 random bits, so a plain digest (no salt, no slow hash) is enough: there is nothing to guess.

export const TOKEN_PREFIX = "mzn_";
export const MAX_TOKENS = 10;
export type Scope = "read" | "write";
export type TokenRow = {
  id: string; name: string; hint: string; scope: Scope; created_at: string; last_used_at: string | null; use_count: number; last_client: string | null;
};
export type VerifiedToken = { id: string; name: string; scope: Scope };

export const digestOf = (token: string) => crypto.createHash("sha256").update(token, "utf8").digest();
export const newToken = () => `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
/** Whether a string has the shape of a Mizan token, checked before any database lookup. */
export const looksLikeToken = (s: string | null | undefined): s is string => !!s && /^mzn_[A-Za-z0-9_-]{43}$/.test(s);

export async function listTokens(): Promise<TokenRow[]> {
  try {
    const { rows } = await q<TokenRow>(
      `SELECT id, name, hint, scope, created_at, last_used_at, use_count, last_client FROM app.access_tokens
       WHERE revoked_at IS NULL ORDER BY created_at DESC`,
    );
    return rows;
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

export async function createToken(name: string, scope: Scope): Promise<{ row: TokenRow; token: string } | { error: "too-many" }> {
  const live = await listTokens();
  if (live.length >= MAX_TOKENS) return { error: "too-many" };
  const token = newToken();
  const { rows } = await q<TokenRow>(
    `INSERT INTO app.access_tokens (name, token_digest, hint, scope) VALUES ($1, $2, $3, $4)
     RETURNING id, name, hint, scope, created_at, last_used_at, use_count, last_client`,
    [name, digestOf(token), token.slice(-4), scope],
  );
  return { row: rows[0], token };
}

export async function revokeToken(id: string): Promise<boolean> {
  const { rowCount } = await q(`UPDATE app.access_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  return (rowCount ?? 0) > 0;
}

/** The live token a request carries, or null. Counts the use and remembers which app it was. */
export async function verifyToken(token: string | null | undefined, client: string | null = null): Promise<VerifiedToken | null> {
  if (!looksLikeToken(token)) return null;
  try {
    const { rows } = await q<VerifiedToken>(
      `UPDATE app.access_tokens SET last_used_at = now(), use_count = use_count + 1, last_client = coalesce($2, last_client)
       WHERE token_digest = $1 AND revoked_at IS NULL RETURNING id, name, scope`,
      [digestOf(token), client?.slice(0, 80) ?? null],
    );
    return rows[0] ?? null;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

/** The token in an Authorization: Bearer header, or else the one in the connector address (/api/mcp/<token>). */
export function tokenOf(req: Request, fromPath?: string | null): string | null {
  const h = req.headers.get("authorization") ?? "";
  // "Bearer mzn_…", or the bare token, as some APIs pass the authorization value through unchanged.
  const m = /^(?:Bearer\s+)?(mzn_\S+)$/i.exec(h.trim());
  if (m) return m[1];
  return fromPath ?? null;
}
