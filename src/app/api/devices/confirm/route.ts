import { errorJson, handle, json } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { authenticateDevice, looksLikeDeviceToken } from "@/lib/paired-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called by the Mizan Shortcut right after it saved the reply from pairing, with
 * `Authorization: Bearer <this iPhone's token>`. Proves the key reached the phone, so Mizan shows it as connected.
 * Takes no body; GET works too.
 */
async function confirm(req: Request) {
  const ip = clientIp(req);
  if (!(await rateLimit(`confirm:ip:${ip}`, 20, 600))) return errorJson(429, "Too many requests");
  const m = /^Bearer\s+(\S{1,512})$/.exec(req.headers.get("authorization") ?? "");
  const deviceId = m && looksLikeDeviceToken(m[1]) ? await authenticateDevice(m[1]) : null;
  if (!deviceId) {
    await rateLimit(`sms:fail:${ip}`, 10, 600);
    return errorJson(401, "This iPhone isn't connected to Mizan. Scan the QR code in Mizan › Connect iPhone again.");
  }
  return json({ ok: true, message: "This iPhone is connected to Mizan." }, 200, { "cache-control": "no-store" });
}

export const POST = handle(confirm);
export const GET = handle(confirm);
