import { requireSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { markConfirmed } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entering the passphrase again before a sensitive action. It then works for a few minutes on this device. */
export const POST = handle(async (req: Request) => {
  const session = await requireSession(req);
  if (!(await rateLimit(`confirm:ip:${clientIp(req)}`, 8, 900)) || !(await rateLimit("confirm:global", 30, 900))) {
    return errorJson(429, "Too many attempts. Try again in 15 minutes.");
  }
  const body = (await readJson(req, 1024)) as { password?: unknown };
  const password = typeof body?.password === "string" ? body.password.slice(0, 256) : "";
  if (!password || !verifyPassword(password, env.adminPasswordHash())) {
    return errorJson(400, "That passphrase is not correct", { fields: { password: ["That passphrase is not correct"] } });
  }
  await markConfirmed(session.sid);
  return json({ ok: true });
});
