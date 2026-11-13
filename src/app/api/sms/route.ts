import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { importFinished, smsInput } from "@/lib/validation";
import { ingestSms, previewSms } from "@/lib/sms/ingest";
import { countImport, finishImportRun, importSummary } from "@/lib/import-runs";
import { authenticateDevice, looksLikeDeviceToken, recordIngest, recordTest } from "@/lib/paired-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

/**
 * Who sent this: a paired iPhone's own token (from pairing), or the SMS token (the older Shortcut where the URL and
 * token are pasted by hand, which keeps working). Returns the paired device's id, null for the SMS token, or false.
 */
async function sender(token: string): Promise<string | null | false> {
  if (looksLikeDeviceToken(token)) return (await authenticateDevice(token)) ?? false;
  return safeEqual(token, env.smsToken()) ? null : false;
}

/**
 * Receives bank alert SMS forwarded by an iPhone Shortcut.
 * Auth: `Authorization: Bearer <this iPhone's token from pairing, or SMS_INGEST_TOKEN>`. With `"test": true` the
 * alert is only read, never saved. The token and message text are never logged.
 */
export const POST = handle(async (req: Request) => {
  const ip = clientIp(req);
  if (!(await rateLimit(`sms:ip:${ip}`, 30, 60))) return errorJson(429, "Too many requests", {});

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S{1,512})$/.exec(auth);
  const deviceId = m ? await sender(m[1]) : false;
  if (deviceId === false) {
    // Slow down token guessing: 10 failures per IP per 10 minutes.
    await rateLimit(`sms:fail:${ip}`, 10, 600);
    return errorJson(401, m && looksLikeDeviceToken(m[1])
      ? "This iPhone isn't connected to Mizan any more. Scan the QR code in Mizan › Connect iPhone again."
      : "Invalid or missing bearer token");
  }
  if (!(await rateLimit("sms:global", 120, 60))) return errorJson(429, "Too many requests");

  const body = await readJson(req, MAX_BODY_BYTES);
  const done = importFinished.safeParse(body);
  if (done.success) {
    const run = await finishImportRun(done.data.importRun, deviceId);
    if (!run) return errorJson(404, "That import has expired. Start it again from More › Import queued messages in Mizan.");
    return json({ ok: true, finished: true, message: importSummary(run), ...counts(run) });
  }
  const parsed = smsInput.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "Invalid payload", { issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) });
  }
  const receivedAt = new Date(parsed.data.receivedAt);
  if (receivedAt.getTime() > Date.now() + 10 * 60e3) return errorJson(400, "receivedAt is in the future");

  const input = { sender: parsed.data.sender, text: parsed.data.text, receivedAt };
  if (parsed.data.test) {
    if (deviceId) await recordTest(deviceId);
    return json({ ok: true, test: true, message: "Mizan received a test from this iPhone. Nothing was saved.", reading: await previewSms(input) });
  }
  let out;
  try {
    out = await ingestSms(input);
  } catch (e) {
    if (deviceId) await recordIngest(deviceId, "failed").catch(() => {});
    if (parsed.data.importRun) await countImport(parsed.data.importRun, "failed", deviceId).catch(() => {});
    throw e;
  }
  if (deviceId) await recordIngest(deviceId, out.status).catch(() => {});
  if (parsed.data.importRun) await countImport(parsed.data.importRun, out.status, deviceId).catch(() => {});
  const status = out.status === "imported" ? 201 : out.status === "review" ? 202 : 200;
  return json({ ok: true, ...out }, status);
});

function counts(r: { sent_count: number; imported_count: number; review_count: number; duplicate_count: number; ignored_count: number; failed_count: number }) {
  return { sent: r.sent_count, imported: r.imported_count, review: r.review_count, duplicates: r.duplicate_count, ignored: r.ignored_count, failed: r.failed_count };
}

export function GET() {
  return errorJson(405, "Use POST");
}
