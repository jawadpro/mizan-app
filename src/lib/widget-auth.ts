import "server-only";
import { HttpError } from "./http";
import { clientIp, rateLimit } from "./ratelimit";
import { DEVICE_KINDS, authenticateDevice, looksLikeDeviceToken } from "./paired-devices";

/**
 * The widget endpoints take `Authorization: Bearer <device key>`: the key a widget got from pairing, or the Mizan
 * Shortcut's key on the same iPhone. No cookies, so no CSRF to worry about. Returns the device's id.
 */
export async function requireWidget(req: Request): Promise<string> {
  const ip = clientIp(req);
  if (!(await rateLimit(`widget:ip:${ip}`, 60, 60))) throw new HttpError(429, "Too many requests. Try again in a minute.");
  const m = /^Bearer\s+(\S{1,512})$/.exec(req.headers.get("authorization") ?? "");
  const id = m && looksLikeDeviceToken(m[1]) ? await authenticateDevice(m[1], DEVICE_KINDS) : null;
  if (!id) {
    await rateLimit(`sms:fail:${ip}`, 10, 600);
    throw new HttpError(401, "This widget isn't connected to Mizan any more. In Mizan, open Monthly payments › Widget and connect it again.");
  }
  return id;
}
