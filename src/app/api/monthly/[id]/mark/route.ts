import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { markMonthly, unmarkMonthly } from "@/lib/monthly-repo";
import { isMonth } from "@/lib/monthly";
import { monthlyMarkInput } from "@/lib/validation";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

async function itemId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError(404, "Payment not found");
  return id;
}

/** PUT { month, status: "paid" | "skipped", transactionId?, full?, amount?, note? } ticks an item off or adds a part. */
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  const id = await itemId(ctx);
  const parsed = monthlyMarkInput.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  const r = await markMonthly(id, parsed.data);
  if (r === "no-item") throw new HttpError(404, "Payment not found");
  if (r === "no-transaction") throw new HttpError(400, "That transaction no longer exists");
  return json({ ok: true });
});

/** DELETE { month } puts it back to not paid for that month; { month, transactionId } removes just that part. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  const id = await itemId(ctx);
  const body = (await readJson(req, 256)) as { month?: unknown; transactionId?: unknown } | null;
  if (!isMonth(body?.month)) throw new HttpError(400, "month must be YYYY-MM");
  const txId = body.transactionId;
  if (txId !== undefined && (typeof txId !== "string" || !UUID.test(txId))) throw new HttpError(400, "transactionId must be a transaction id");
  await unmarkMonthly(id, body.month, txId);
  return json({ ok: true });
});
