import { z } from "zod";
import { requireConfirmed, requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { listDevices, signOutDevice, signOutOthers } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function state(sid: string) {
  return { devices: await listDevices(sid) };
}

/** Signed-in devices. */
export const GET = handle(async (req: Request) => {
  const session = await requireSession(req);
  return json({ ok: true, ...(await state(session.sid)) });
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sign-out"), id: z.string().regex(/^[0-9a-f]{20}$/) }),
  z.object({ action: z.literal("sign-out-others") }),
]);

/** Signing devices out asks for the passphrase first (see requireConfirmed). */
export const POST = handle(async (req: Request) => {
  const session = await requireConfirmed(req);
  const parsed = input.safeParse(await readJson(req, 512));
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const body = parsed.data;
  if (body.action === "sign-out") {
    if (!(await signOutDevice(body.id, session.sid))) throw new HttpError(404, "That device is already signed out");
  } else {
    await signOutOthers(session.sid);
  }
  return json({ ok: true, ...(await state(session.sid)) });
});
