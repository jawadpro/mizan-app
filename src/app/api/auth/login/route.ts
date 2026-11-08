import { assertSameOrigin, sessionHeaders } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { loadConfig } from "@/lib/config";
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
  // Read the saved passphrase fresh: one changed in Settings must win at once, and if the database
  // can't be read, refuse rather than fall back to an older passphrase from the environment.
  if (env.hasDatabase() && (await loadConfig(true)) !== "ok") {
    return errorJson(503, "Mizan can't reach its database right now. Try again in a minute.");
  }
  if (!password || !verifyPassword(password, env.adminPasswordHash())) {
    return errorJson(401, "That passphrase is not correct");
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: sessionHeaders(body?.remember !== false) });
});

export function GET() {
  return json({ ok: false, error: "Use POST" }, 405);
}
