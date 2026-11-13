import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { renameDevice, revokeDevice } from "@/lib/paired-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const id = z.string().uuid();

/** Rename a paired iPhone. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const deviceId = id.safeParse((await ctx.params).id);
  const body = z.object({ name: z.string().trim().min(1, "Give it a name").max(60) }).safeParse(await readJson(req, 512));
  if (!deviceId.success || !body.success) throw new HttpError(400, body.error?.issues[0]?.message ?? "Invalid request");
  if (!(await renameDevice(deviceId.data, body.data.name))) throw new HttpError(404, "Device not found");
  return json({ ok: true });
});

/** Remove an iPhone: its token stops working immediately. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const deviceId = id.safeParse((await ctx.params).id);
  if (!deviceId.success || !(await revokeDevice(deviceId.data))) throw new HttpError(404, "Device not found");
  return json({ ok: true });
});
