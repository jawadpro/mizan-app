import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { smsInput } from "@/lib/validation";
import { ingestSms } from "@/lib/sms/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

/**
 * Receives MCB alert SMS forwarded by an iPhone Shortcut.
 * Auth: `Authorization: Bearer <SMS_INGEST_TOKEN>`. The token and message text are never logged.
 */
export const POST = handle(async (req: Request) => {
  const ip = clientIp(req);
  if (!(await rateLimit(`sms:ip:${ip}`, 30, 60))) return errorJson(429, "Too many requests", {});

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S{1,512})$/.exec(auth);
  if (!m || !safeEqual(m[1], env.smsToken())) {
    // Slow down token guessing: 10 failures per IP per 10 minutes.
    await rateLimit(`sms:fail:${ip}`, 10, 600);
    return errorJson(401, "Invalid or missing bearer token");
  }
  if (!(await rateLimit("sms:global", 120, 60))) return errorJson(429, "Too many requests");

  const body = await readJson(req, MAX_BODY_BYTES);
  const parsed = smsInput.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "Invalid payload", { issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) });
  }
  const receivedAt = new Date(parsed.data.receivedAt);
  if (receivedAt.getTime() > Date.now() + 10 * 60e3) return errorJson(400, "receivedAt is in the future");

  const out = await ingestSms({ sender: parsed.data.sender, text: parsed.data.text, receivedAt });
  const status = out.status === "imported" ? 201 : out.status === "review" ? 202 : 200;
  return json({ ok: true, ...out }, status);
});

export function GET() {
  return errorJson(405, "Use POST");
}
