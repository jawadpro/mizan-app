import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { deleteBankForGood, listBanksWithRecords, restoreBank } from "@/lib/repo";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

async function idOf(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError(404, "Bank not found");
  return id;
}

/** POST { action: "restore" } brings a removed bank back with its history. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  const id = await idOf(ctx);
  const body = (await readJson(req, 256)) as { action?: unknown } | null;
  if (body?.action !== "restore") throw new HttpError(400, "Unknown action");
  if (!(await restoreBank(id))) throw new HttpError(404, "That bank isn't in Removed banks");
  return json({ ok: true, ...(await listBanksWithRecords()) });
});

/** DELETE { confirm: "<bank name>" } deletes a removed bank for good; its transactions stay, without a bank. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  const id = await idOf(ctx);
  const body = (await readJson(req, 512)) as { confirm?: unknown } | null;
  if (!(await deleteBankForGood(id, typeof body?.confirm === "string" ? body.confirm : ""))) throw new HttpError(404, "That bank isn't in Removed banks");
  return json({ ok: true, ...(await listBanksWithRecords()) });
});
