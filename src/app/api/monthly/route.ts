import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { createMonthlyItem, monthlyList } from "@/lib/monthly-repo";
import { isMonth, monthOf } from "@/lib/monthly";
import { todayPkt } from "@/lib/time";
import { monthlyItemInput, searchParamsObject } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET ?month=YYYY-MM (default this month) returns that month's checklist. */
export const GET = handle(async (req: Request) => {
  requireSession(req);
  const today = todayPkt();
  const m = searchParamsObject(req.url).month;
  if (m !== undefined && !isMonth(m)) throw new HttpError(400, "month must be YYYY-MM");
  return json({ ok: true, today, ...(await monthlyList(m ?? monthOf(today), today)) });
});

export const POST = handle(async (req: Request) => {
  requireSession(req);
  const parsed = monthlyItemInput.safeParse(await readJson(req, 2048));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  return json({ ok: true, id: await createMonthlyItem(parsed.data) }, 201);
});
