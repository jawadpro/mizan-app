import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";
import { hmac, safeEqual } from "./crypto";

export const SESSION_COOKIE = "mizan_session";
export const CSRF_COOKIE = "mizan_csrf";
/** "Remember me" keeps the device signed in for 180 days; otherwise the cookie ends with the browser session (max 12 h). */
const REMEMBER_TTL_S = 180 * 24 * 3600;
const SHORT_TTL_S = 12 * 3600;

type Session = { sid: string; exp: number };

export function issueSession(remember: boolean): { cookie: string; csrf: string; maxAge: number | null } {
  const ttl = remember ? REMEMBER_TTL_S : SHORT_TTL_S;
  const payload: Session = { sid: crypto.randomBytes(18).toString("base64url"), exp: Math.floor(Date.now() / 1000) + ttl };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = hmac(env.sessionSecret(), `session:${body}`);
  return { cookie: `${body}.${sig}`, csrf: csrfFor(payload.sid), maxAge: remember ? ttl : null };
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
    return s;
  } catch {
    return null;
  }
}

/** For server components / layouts. */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return parseSession(jar.get(SESSION_COOKIE)?.value);
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
export function requireSession(req: Request): Session {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const raw = readCookie(cookieHeader, SESSION_COOKIE);
  const session = parseSession(raw);
  if (!session) throw new AuthError(401, "Sign in required");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    assertSameOrigin(req);
    const token = req.headers.get("x-csrf-token") ?? "";
    if (!token || !safeEqual(token, csrfFor(session.sid))) throw new AuthError(403, "Invalid CSRF token");
  }
  return session;
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
