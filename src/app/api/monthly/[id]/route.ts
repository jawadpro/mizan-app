import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { deleteMonthlyItem, monthlyMatches, stopMonthlyItem, updateMonthlyItem } from "@/lib/monthly-repo";
import { isMonth } from "@/lib/monthly";
import { monthlyItemInput, searchParamsObject } from "@/lib/validation";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

async function itemId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError(404, "Payment not found");
  return id;
}

/** GET ?month=YYYY-MM[&q=] lists transactions that could be this month's payment, best guesses first. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const id = await itemId(ctx);
  const sp = searchParamsObject(req.url);
  if (!isMonth(sp.month)) throw new HttpError(400, "month must be YYYY-MM");
  const search = sp.q?.trim().slice(0, 100) || undefined;
  const items = await monthlyMatches(id, sp.month, search);
  if (!items) throw new HttpError(404, "Payment not found");
  return json({ ok: true, items });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const id = await itemId(ctx);
  const parsed = monthlyItemInput.safeParse(await readJson(req, 2048));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  if (!(await updateMonthlyItem(id, parsed.data))) throw new HttpError(404, "Payment not found");
  return json({ ok: true });
});

/** POST { action: "stop", lastMonth } takes it off the list after that month; { action: "resume" } puts it back. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const id = await itemId(ctx);
  const body = (await readJson(req, 256)) as { action?: unknown; lastMonth?: unknown } | null;
  let ok: boolean;
  if (body?.action === "stop" && isMonth(body.lastMonth)) ok = await stopMonthlyItem(id, body.lastMonth);
  else if (body?.action === "resume") ok = await stopMonthlyItem(id, null);
  else throw new HttpError(400, "Unknown action");
  if (!ok) throw new HttpError(404, "Payment not found");
  return json({ ok: true });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  if (!(await deleteMonthlyItem(await itemId(ctx)))) throw new HttpError(404, "Payment not found");
  return json({ ok: true });
});
