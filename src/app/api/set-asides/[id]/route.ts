import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { deleteSetAside, setAsideContributions, startSetAsideFresh, updateSetAside } from "@/lib/repo";
import { setAsideInput } from "@/lib/validation";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

async function idOf(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError(404, "Set-aside not found");
  return id;
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  return json({ ok: true, items: await setAsideContributions(await idOf(ctx)) });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  const id = await idOf(ctx);
  const parsed = setAsideInput.safeParse(await readJson(req, 2048));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  if (!(await updateSetAside(id, parsed.data))) throw new HttpError(404, "Set-aside not found");
  return json({ ok: true });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  if (!(await deleteSetAside(await idOf(ctx)))) throw new HttpError(404, "Set-aside not found");
  return json({ ok: true });
});

/** POST { action: "start-fresh" } clears an overpayment so the set-aside goes back to zero. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  const id = await idOf(ctx);
  const body = (await readJson(req, 256)) as { action?: unknown } | null;
  if (body?.action !== "start-fresh") throw new HttpError(400, "Unknown action");
  if (!(await startSetAsideFresh(id))) throw new HttpError(404, "Set-aside not found");
  return json({ ok: true });
});
