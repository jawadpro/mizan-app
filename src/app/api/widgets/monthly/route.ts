import { HttpError, handle, json } from "@/lib/http";
import { monthlyList } from "@/lib/monthly-repo";
import { isMonth, monthOf } from "@/lib/monthly";
import { phoneUrl } from "@/lib/paired-devices";
import { getPrefs } from "@/lib/repo";
import { todayPkt } from "@/lib/time";
import { requireWidget } from "@/lib/widget-auth";
import { widgetView } from "@/lib/widget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The monthly payments checklist for the home-screen widget. GET ?month=YYYY-MM (default this month), with
 * `Authorization: Bearer <device key>`. Each unpaid payment carries the transaction that looks like it, if any.
 */
export const GET = handle(async (req: Request) => {
  await requireWidget(req);
  const today = todayPkt();
  const m = new URL(req.url).searchParams.get("month");
  if (m !== null && !isMonth(m)) throw new HttpError(400, "month must be YYYY-MM");
  const [list, prefs] = await Promise.all([monthlyList(m ?? monthOf(today), today), getPrefs()]);
  return json(widgetView(list, today, prefs.currency, phoneUrl(req)));
});
