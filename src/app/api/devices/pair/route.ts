import { z } from "zod";
import { errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { phoneUrl, redeemPairingCode } from "@/lib/paired-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z.object({ code: z.string().min(4).max(200), name: z.string().max(100).optional().default("") }).strict();

/**
 * Called by the Mizan Shortcut on the iPhone with the one-time code from Mizan's QR code. Returns this iPhone's own
 * token; the Shortcut keeps it in a file on the phone and sends it with every alert.
 *
 * The "Connect this iPhone" button hands the Shortcut <address>/api/devices/pair?code=XXXXXXXX, and the Shortcut
 * opens it with Get Contents of URL (GET or POST, with or without a JSON body) and saves the reply. The code
 * expires in 10 minutes. Opening the link doesn't use it up: the pairing only counts once the iPhone uses its new
 * token (see redeemPairingCode), so a link preview or a stray GET can't spend it. No cookies are involved, so
 * another site can't use this to act for a signed-in user.
 */
export const GET = handle(async (req: Request) => pair(req, fromQuery(req)));

export const POST = handle(async (req: Request) => {
  const q = fromQuery(req);
  if (q.code) return pair(req, q);
  return pair(req, await readJson(req, 1024));
});

function fromQuery(req: Request) {
  const u = new URL(req.url);
  return { code: u.searchParams.get("code") ?? "", name: u.searchParams.get("name") ?? "" };
}

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
  // `confirm` is where the Shortcut reports, with that header, that it saved the key; Mizan shows the iPhone as
  // connected from then on. Any later alert or test run confirms it too.
  const server = phoneUrl(req);
  return json({
    ok: true, deviceId: out.deviceId, token: out.token,
    endpoint: `${server}/api/sms`, authorization: `Bearer ${out.token}`, confirm: `${server}/api/devices/confirm`,
    message: "This iPhone is connected to Mizan.",
  }, 201, { "cache-control": "no-store" });
}
