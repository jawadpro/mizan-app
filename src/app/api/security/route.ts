import { z } from "zod";
import { clientOf, requireConfirmed, requireSession } from "@/lib/auth";
import { HttpError, errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import {
  checkCode, emailConfigured, listDevices, maskEmail, regenerateRecoveryCodes, securitySettings, sendCode,
  setSessionDevice, signOutDevice, signOutOthers, trustDevice, turnOffEmailCodes, turnOnEmailCodes,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function state(sid: string) {
  const [s, devices] = await Promise.all([securitySettings(), listDevices(sid)]);
  return {
    emailConfigured: emailConfigured(),
    email: s.email ? maskEmail(s.email) : null,
    emailCodesOn: s.emailCodesOn,
    recoveryLeft: s.recoveryLeft,
    devices,
  };
}

/** Signed-in devices and the email code setting. */
export const GET = handle(async (req: Request) => {
  const session = await requireSession(req);
  return json({ ok: true, ...(await state(session.sid)) });
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start-email"), email: z.string().trim().email("Enter a valid email address").max(254) }),
  z.object({ action: z.literal("confirm-email"), challenge: z.string().max(64), code: z.string().max(20) }),
  z.object({ action: z.literal("turn-off") }),
  z.object({ action: z.literal("new-recovery") }),
  z.object({ action: z.literal("sign-out"), id: z.string().regex(/^[0-9a-f]{20}$/) }),
  z.object({ action: z.literal("sign-out-others") }),
]);

/** Every change here asks for the passphrase first (see requireConfirmed). */
export const POST = handle(async (req: Request) => {
  const session = await requireConfirmed(req);
  const parsed = input.safeParse(await readJson(req, 2048));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request", { fields: parsed.error.flatten().fieldErrors });
  const body = parsed.data;

  switch (body.action) {
    case "start-email": {
      if (!emailConfigured()) throw new HttpError(409, "Email isn't set up on the server yet. Add RESEND_API_KEY to your environment first.");
      if (!(await rateLimit(`email-code:ip:${clientIp(req)}`, 5, 900))) return errorJson(429, "Too many codes sent. Try again in 15 minutes.");
      const { id, sent } = await sendCode("enable", body.email.toLowerCase(), true, clientOf(req).ua);
      if (!sent) throw new HttpError(502, "The email couldn't be sent. Check the address and your Resend setup, then try again.");
      return json({ ok: true, challenge: id, email: maskEmail(body.email) });
    }
    case "confirm-email": {
      const { email } = await checkCode(body.challenge, "enable", body.code);
      const codes = await turnOnEmailCodes(email);
      // This device is remembered at once, so turning codes on doesn't ask it for one next time.
      const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
      if (!session.deviceId) {
        const device = await trustDevice(clientOf(req).ua);
        await setSessionDevice(session.sid, device.id);
        headers.append("set-cookie", device.cookie);
      }
      return new Response(JSON.stringify({ ok: true, recoveryCodes: codes, ...(await state(session.sid)) }), { headers });
    }
    case "turn-off":
      await turnOffEmailCodes();
      break;
    case "new-recovery": {
      const s = await securitySettings();
      if (!s.emailCodesOn) throw new HttpError(409, "Turn on email codes first");
      return json({ ok: true, recoveryCodes: await regenerateRecoveryCodes(), ...(await state(session.sid)) });
    }
    case "sign-out":
      if (!(await signOutDevice(body.id, session.sid))) throw new HttpError(404, "That device is already signed out");
      break;
    case "sign-out-others":
      await signOutOthers(session.sid, session.deviceId);
      break;
  }
  return json({ ok: true, ...(await state(session.sid)) });
});
