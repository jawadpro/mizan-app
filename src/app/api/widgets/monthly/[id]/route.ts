import { z } from "zod";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { markMonthly, monthlyMatches, unmarkMonthly } from "@/lib/monthly-repo";
import { isMonth, monthOf } from "@/lib/monthly";
import { getPrefs } from "@/lib/repo";
import { todayPkt } from "@/lib/time";
import { requireWidget } from "@/lib/widget-auth";
import { widgetTx } from "@/lib/widget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

async function itemId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError(404, "Payment not found");
  return id;
}

/** GET ?month=YYYY-MM&q=… : that month's spending to link this payment to, best guesses first. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireWidget(req);
  const id = await itemId(ctx);
  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? monthOf(todayPkt());
  if (!isMonth(month)) throw new HttpError(400, "month must be YYYY-MM");
  const search = sp.get("q")?.trim().slice(0, 60) || undefined;
  const [list, prefs] = await Promise.all([monthlyMatches(id, month, search), getPrefs()]);
  if (!list) throw new HttpError(404, "Payment not found");
  return json({ ok: true, items: list.slice(0, 15).map((t) => ({ ...widgetTx(t, prefs.currency), score: t.score })) });
});

const action = z.object({
  month: z.string().refine(isMonth, "month must be YYYY-MM"),
  /** paid: ticked off, with a transaction linked if given (otherwise fully paid). skipped: not due this month. undo: back to not paid. */
  action: z.enum(["paid", "skipped", "undo"]),
  transactionId: z.string().regex(UUID).optional(),
}).strict();

/** POST { month, action, transactionId? } marks a payment from the widget. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireWidget(req);
  const id = await itemId(ctx);
  const parsed = action.safeParse(await readJson(req, 512));
  if (!parsed.success) throw new HttpError(400, "Send month, action and an optional transactionId");
  const { month, action: act, transactionId } = parsed.data;
  if (act === "undo") {
    await unmarkMonthly(id, month);
    return json({ ok: true, message: "Marked as not paid." });
  }
  const r = await markMonthly(id, act === "skipped"
    ? { month, status: "skipped" }
    : { month, status: "paid", transactionId: transactionId ?? null, full: !transactionId });
  if (r === "no-item") throw new HttpError(404, "Payment not found");
  if (r === "no-transaction") throw new HttpError(400, "That transaction no longer exists");
  return json({ ok: true, message: act === "skipped" ? "Skipped this month." : transactionId ? "Marked paid and linked." : "Marked paid." });
});
