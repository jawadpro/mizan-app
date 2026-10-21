import { assertSameOrigin, issueSession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  if (!(await rateLimit(`login:ip:${ip}`, 8, 900)) || !(await rateLimit("login:global", 40, 900))) {
    return errorJson(429, "Too many sign-in attempts. Try again in 15 minutes.");
  }
  const body = (await readJson(req, 1024)) as { password?: unknown; remember?: unknown };
  const password = typeof body?.password === "string" ? body.password.slice(0, 256) : "";
  if (!password || !verifyPassword(password, env.adminPasswordHash())) {
    return errorJson(401, "That passphrase is not correct");
  }
  const s = issueSession(body?.remember !== false);
  const age = s.maxAge ? `; Max-Age=${s.maxAge}` : "";
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  headers.append("set-cookie", `${SESSION_COOKIE}=${s.cookie}; Path=/; HttpOnly; SameSite=Lax${age}${secure}`);
  headers.append("set-cookie", `${CSRF_COOKIE}=${s.csrf}; Path=/; SameSite=Lax${age}${secure}`);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});

export function GET() {
  return json({ ok: false, error: "Use POST" }, 405);
}
