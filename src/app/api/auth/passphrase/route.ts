import { requireSession, sessionHeaders, wasRemembered } from "@/lib/auth";
import { changePassphrase, MIN_PASSPHRASE } from "@/lib/config";
import { verifyPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 256;

/** Changes the passphrase. Needs the current one; signs out every other device and keeps this one signed in. */
export const POST = handle(async (req: Request) => {
  const session = requireSession(req);
  const ip = clientIp(req);
  if (!(await rateLimit(`passphrase:ip:${ip}`, 5, 900)) || !(await rateLimit("passphrase:global", 20, 900))) {
    return errorJson(429, "Too many attempts. Try again in 15 minutes.");
  }
  const body = (await readJson(req, 2048)) as { current?: unknown; next?: unknown };
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.next === "string" ? body.next : "";
  if (!current || current.length > MAX || !verifyPassword(current, env.adminPasswordHash())) {
    return errorJson(400, "Your current passphrase is not correct", { fields: { current: ["Your current passphrase is not correct"] } });
  }
  if (next.trim().length < MIN_PASSPHRASE) {
    return errorJson(400, `Use at least ${MIN_PASSPHRASE} characters`, { fields: { next: [`Use at least ${MIN_PASSPHRASE} characters`] } });
  }
  if (next.length > MAX) return errorJson(400, `Use at most ${MAX} characters`, { fields: { next: [`Use at most ${MAX} characters`] } });
  if (next === current) {
    return errorJson(400, "Choose a passphrase different from the current one", { fields: { next: ["Choose a passphrase different from the current one"] } });
  }
  await changePassphrase(next);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: sessionHeaders(wasRemembered(session)) });
});

export function GET() {
  return json({ ok: false, error: "Use POST" }, 405);
}
