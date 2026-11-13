import { assertSameOrigin, clientOf, sessionHeaders } from "@/lib/auth";
import { errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { checkCode, trustDevice } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Second step of signing in on a new device: the code from the email (or a recovery code). */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  if (!(await rateLimit(`verify:ip:${clientIp(req)}`, 12, 900)) || !(await rateLimit("verify:global", 40, 900))) {
    return errorJson(429, "Too many tries. Try again in 15 minutes.");
  }
  const body = (await readJson(req, 1024)) as { challenge?: unknown; code?: unknown };
  const challenge = typeof body?.challenge === "string" ? body.challenge : "";
  const code = typeof body?.code === "string" ? body.code.slice(0, 40) : "";
  const { remember, recovery } = await checkCode(challenge, "login", code);
  // "Remember me" also remembers the device, so it isn't asked for a code again.
  const ua = clientOf(req).ua;
  const device = remember ? await trustDevice(ua) : null;
  const headers = await sessionHeaders(req, remember, device?.id ?? null);
  if (device) headers.append("set-cookie", device.cookie);
  return new Response(JSON.stringify({ ok: true, recovery }), { status: 200, headers });
});

export function GET() {
  return json({ ok: false, error: "Use POST" }, 405);
}
