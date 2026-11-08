import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { smsInput } from "@/lib/validation";
import { ingestSms } from "@/lib/sms/ingest";

/** One line per call with what happened, so a failing Shortcut shows up in the logs. Never the token, sender or text. */
function logOutcome(status: number, outcome: string, detail = "") {
  console.info(`[mizan] sms ${status} ${outcome}${detail ? `: ${detail}` : ""}`);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

/**
 * Receives bank alert SMS forwarded by an iPhone Shortcut.
 * Auth: `Authorization: Bearer <SMS_INGEST_TOKEN>`. The token and message text are never logged.
 */
export const POST = handle(async (req: Request) => {
  const ip = clientIp(req);
  if (!(await rateLimit(`sms:ip:${ip}`, 30, 60))) {
    logOutcome(429, "rate-limited");
    return errorJson(429, "Too many requests", {});
  }

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S{1,512})$/.exec(auth);
  if (!m || !safeEqual(m[1], env.smsToken())) {
    // Slow down token guessing: 10 failures per IP per 10 minutes.
    await rateLimit(`sms:fail:${ip}`, 10, 600);
    logOutcome(401, "bad-token", m ? "token does not match" : "no Bearer token");
    return errorJson(401, "Invalid or missing bearer token");
  }
  if (!(await rateLimit("sms:global", 120, 60))) {
    logOutcome(429, "rate-limited", "global");
    return errorJson(429, "Too many requests");
  }

  let body: unknown;
  try {
    body = await readJson(req, MAX_BODY_BYTES);
  } catch (e) {
    logOutcome((e as { status?: number }).status ?? 400, "bad-body", (e as Error).message);
    throw e;
  }
  const parsed = smsInput.safeParse(body);
  if (!parsed.success) {
    // Field names and rule messages only; zod's messages here never echo the submitted values.
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    logOutcome(400, "invalid-payload", issues.join("; "));
    return errorJson(400, "Invalid payload", { issues });
  }
  const receivedAt = new Date(parsed.data.receivedAt);
  const aheadMin = Math.round((receivedAt.getTime() - Date.now()) / 60e3);
  if (aheadMin > 10) {
    logOutcome(400, "future-date", `receivedAt is ${aheadMin} min ahead of the server clock`);
    return errorJson(400, "receivedAt is in the future");
  }

  const out = await ingestSms({ sender: parsed.data.sender, text: parsed.data.text, receivedAt });
  const status = out.status === "imported" ? 201 : out.status === "review" ? 202 : 200;
  logOutcome(status, out.status, out.status === "review" || out.status === "ignored" ? out.reason : "");
  return json({ ok: true, ...out }, status);
});

export function GET() {
  return errorJson(405, "Use POST");
}
