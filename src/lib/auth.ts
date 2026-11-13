import "server-only";
import crypto from "node:crypto";
import { cookies, headers as nextHeaders } from "next/headers";
import { env } from "./env";
import { loadConfig } from "./config";
import { hmac, safeEqual } from "./crypto";
import { q } from "./db";

export const SESSION_COOKIE = "mizan_session";
export const CSRF_COOKIE = "mizan_csrf";
/** "Remember me" keeps the device signed in for 180 days; otherwise the cookie ends with the browser session (max 12 h). */
const REMEMBER_TTL_S = 180 * 24 * 3600;
const SHORT_TTL_S = 12 * 3600;

/**
 * iat is when it was issued (epoch ms) and rem whether "Remember me" was on; sessions from before both existed lack them.
 * v 2 means the sign-in was saved in app.sessions when it was made, so a missing row means it was signed out.
 */
type Session = { sid: string; exp: number; iat?: number; rem?: boolean; v?: number };

/** A verified session, with what app.sessions knows about it. */
export type LiveSession = Session & { confirmedAt: number | null };

export function issueSession(remember: boolean): { sid: string; exp: number; cookie: string; csrf: string; maxAge: number | null } {
  const ttl = remember ? REMEMBER_TTL_S : SHORT_TTL_S;
  const now = Date.now();
  const payload: Session = { sid: crypto.randomBytes(18).toString("base64url"), exp: Math.floor(now / 1000) + ttl, iat: now, rem: remember, v: 2 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = hmac(env.sessionSecret(), `session:${body}`);
  return { sid: payload.sid, exp: payload.exp, cookie: `${body}.${sig}`, csrf: csrfFor(payload.sid), maxAge: remember ? ttl : null };
}

export const secureFlag = () => (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false" ? "; Secure" : "");

/** User agent and address of a request, as kept on its sign-in. */
export function clientOf(req: Request): { ua: string | null; ip: string | null } {
  const fwd = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || null;
  return { ua: req.headers.get("user-agent")?.slice(0, 400) ?? null, ip: ip ? ip.slice(0, 64) : null };
}

/**
 * Starts a session: saves it in app.sessions (so it shows under signed-in devices and can be signed out)
 * and returns the Set-Cookie headers.
 */
export async function sessionHeaders(req: Request, remember: boolean): Promise<Headers> {
  const s = issueSession(remember);
  const { ua, ip } = clientOf(req);
  try {
    await q(
      `INSERT INTO app.sessions (sid, user_agent, ip, remembered, expires_at, confirmed_at)
       VALUES ($1, $2, $3, $4, to_timestamp($5), now())`,
      [s.sid, ua, ip, remember, s.exp],
    );
  } catch (e) {
    // Before the migration has run there is nowhere to save it; the session still works as before.
    if (!missingTable(e)) throw e;
  }
  const age = s.maxAge ? `; Max-Age=${s.maxAge}` : "";
  // The local Docker demo runs on plain http, where some browsers drop Secure cookies.
  const secure = secureFlag();
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  headers.append("set-cookie", `${SESSION_COOKIE}=${s.cookie}; Path=/; HttpOnly; SameSite=Lax${age}${secure}`);
  headers.append("set-cookie", `${CSRF_COOKIE}=${s.csrf}; Path=/; SameSite=Lax${age}${secure}`);
  return headers;
}

export function missingTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "42P01" || code === "3F000";
}

/**
 * Checks a signed session against app.sessions. A session signed out from Settings is refused. One from before
 * sessions were saved there (no v) is added the first time it is seen, so nobody is signed out by the update.
 */
async function live(s: Session, ua: string | null, ip: string | null): Promise<LiveSession | null> {
  try {
    const { rows } = await q<{ revoked: boolean; confirmed_ms: number | null; stale: boolean }>(
      `SELECT revoked_at IS NOT NULL AS revoked, (extract(epoch FROM confirmed_at) * 1000)::float8 AS confirmed_ms,
              last_seen_at < now() - interval '5 minutes' AS stale
       FROM app.sessions WHERE sid = $1`,
      [s.sid],
    );
    const row = rows[0];
    if (!row) {
      if (s.v === 2) return null;
      await q(
        `INSERT INTO app.sessions (sid, user_agent, ip, remembered, created_at, expires_at)
         VALUES ($1, $2, $3, $4, to_timestamp($5::float8 / 1000), to_timestamp($6)) ON CONFLICT (sid) DO NOTHING`,
        [s.sid, ua, ip, wasRemembered(s), s.iat ?? Date.now(), s.exp],
      );
      return { ...s, confirmedAt: null };
    }
    if (row.revoked) return null;
    if (row.stale) {
      q(`UPDATE app.sessions SET last_seen_at = now(), user_agent = coalesce($2, user_agent), ip = coalesce($3, ip) WHERE sid = $1`, [s.sid, ua, ip]).catch(() => {});
    }
    return { ...s, confirmedAt: row.confirmed_ms };
  } catch (e) {
    if (missingTable(e)) return { ...s, confirmedAt: null };
    throw e;
  }
}

/** Whether a session was made with "Remember me", for sessions that predate the rem flag. */
export function wasRemembered(s: Session): boolean {
  return typeof s.rem === "boolean" ? s.rem : s.exp - Date.now() / 1000 > SHORT_TTL_S;
}

function csrfFor(sid: string): string {
  return hmac(env.sessionSecret(), `csrf:${sid}`);
}

export function parseSession(raw: string | undefined): Session | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(sig, hmac(env.sessionSecret(), `session:${body}`))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session;
    if (typeof s.sid !== "string" || typeof s.exp !== "number") return null;
    if (s.exp < Date.now() / 1000) return null;
    // Signed out by a passphrase change: anything issued before the cut-off (or with no issue time) is refused.
    const cutoff = env.sessionsValidAfter();
    if (cutoff && !(typeof s.iat === "number" && s.iat >= cutoff)) return null;
    return s;
  } catch {
    return null;
  }
}

/** For server components / layouts. */
export async function getSession(): Promise<LiveSession | null> {
  await loadConfig();
  const jar = await cookies();
  const s = parseSession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const h = await nextHeaders();
  const fwd = h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? "";
  return live(s, h.get("user-agent")?.slice(0, 400) ?? null, fwd.split(",")[0].trim().slice(0, 64) || null);
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

/**
 * Verifies the session cookie for an API request. For state-changing methods it also
 * requires a same-origin Origin header and a CSRF token bound to the session.
 */
export async function requireSession(req: Request): Promise<LiveSession> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const raw = readCookie(cookieHeader, SESSION_COOKIE);
  const session = parseSession(raw);
  if (!session) throw new AuthError(401, "Sign in required");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    assertSameOrigin(req);
    const token = req.headers.get("x-csrf-token") ?? "";
    if (!token || !safeEqual(token, csrfFor(session.sid))) throw new AuthError(403, "Invalid CSRF token");
  }
  const { ua, ip } = clientOf(req);
  const l = await live(session, ua, ip);
  if (!l) throw new AuthError(401, "This device was signed out");
  return l;
}

/** How long a passphrase entered for a sensitive action keeps working on that device. */
export const CONFIRM_WINDOW_MS = 5 * 60 * 1000;

/** Thrown when an action needs the passphrase again; the browser asks for it and tries once more. */
export class ConfirmRequired extends Error {
  constructor() {
    super("Enter your passphrase to continue");
  }
}

/** For sensitive actions: a signed-in session that entered the passphrase in the last few minutes. */
export async function requireConfirmed(req: Request): Promise<LiveSession> {
  const s = await requireSession(req);
  if (!s.confirmedAt || Date.now() - s.confirmedAt > CONFIRM_WINDOW_MS) throw new ConfirmRequired();
  return s;
}

/** The session id in a request's cookie, signed or not yet checked against app.sessions. */
export function sessionIdOf(req: Request): string | null {
  return parseSession(readCookie(req.headers.get("cookie") ?? "", SESSION_COOKIE))?.sid ?? null;
}

export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new AuthError(403, "Missing origin");
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    throw new AuthError(403, "Bad origin");
  }
  if (o.host !== host) throw new AuthError(403, "Cross-origin request blocked");
}

export function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
