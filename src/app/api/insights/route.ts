import { requireSession } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { buildInsights } from "@/lib/insights";
import { setDisplayCurrency } from "@/lib/money";
import { getBalance, getPrefs, listSetAsides, spendingCheckData } from "@/lib/repo";
import { todayPkt } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession(req);
  const today = todayPkt();
  const [data, balance, funds, prefs] = await Promise.all([spendingCheckData(today), getBalance(), listSetAsides(), getPrefs()]);
  const setAside = funds.reduce((a, f) => a + Math.max(0, f.remaining), 0);
  const overspentFunds = funds
    .filter((f) => f.purpose === "saving" && !f.ended_on && f.remaining < 0)
    .map((f) => ({ id: f.id, name: f.name, over: -f.remaining }));
  setDisplayCurrency(prefs.currency);
  const insights = buildInsights({ today, ...data, freeToSpend: balance ? balance.balance - setAside : null, overspentFunds, warnAt: prefs.limitWarnPercent / 100 });
  return json({ ok: true, enabled: prefs.spendingCheck, ...insights });
});
