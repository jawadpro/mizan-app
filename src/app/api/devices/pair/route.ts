import { z } from "zod";
import { errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { phoneUrl, redeemPairingCode } from "@/lib/paired-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z.object({ code: z.string().min(4).max(200), name: z.string().max(100).optional().default("") }).strict();

/**
 * Called by the Mizan Shortcut on the iPhone with the short code shown in Mizan. Returns this iPhone's own token
 * exactly once; the Shortcut keeps it in a file on the phone and sends it with every alert.
 */
export const POST = handle(async (req: Request) => pair(req, await readJson(req, 1024)));

/**
 * The same, as a plain link: the "Connect this iPhone" button hands the Shortcut
 * <address>/api/devices/pair?code=XXXXXXXX, and the Shortcut only has to open it with Get Contents of URL and
 * save the reply. The code is single-use and expires in 10 minutes. No cookies are involved, so another site
 * can't use this to act for a signed-in user.
 */
export const GET = handle(async (req: Request) => {
  const u = new URL(req.url);
  return pair(req, { code: u.searchParams.get("code") ?? "", name: u.searchParams.get("name") ?? "" });
});

async function pair(req: Request, body: unknown) {
  const ip = clientIp(req);
  if (!(await rateLimit(`pair:ip:${ip}`, 10, 600)) || !(await rateLimit("pair:global", 120, 60))) {
    return errorJson(429, "Too many pairing attempts. Wait a few minutes, make a new code in Mizan and try again.");
  }
  const parsed = input.safeParse(body);
  if (!parsed.success) return errorJson(400, "Send the pairing code shown in Mizan.");
  const out = await redeemPairingCode(parsed.data.code, parsed.data.name);
  if (!out.ok) {
    return out.reason === "limit"
      ? errorJson(409, "Mizan already has 5 iPhones connected. Remove one in Mizan first.")
      : errorJson(400, "That code didn't work. Codes work once and only for 10 minutes; make a new one in Mizan.");
  }
  // Everything the Shortcut needs to send alerts, ready to use as they are: the URL and the Authorization header.
  return json({
    ok: true, deviceId: out.deviceId, token: out.token,
    endpoint: `${phoneUrl(req)}/api/sms`, authorization: `Bearer ${out.token}`,
    message: "This iPhone is connected to Mizan.",
  }, 201, { "cache-control": "no-store" });
}
