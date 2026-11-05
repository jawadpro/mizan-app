import { requireSession } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { buildInsights } from "@/lib/insights";
import { getBalance, listSetAsides, spendingCheckData } from "@/lib/repo";
import { todayPkt } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  requireSession(req);
  const today = todayPkt();
  const [data, balance, funds] = await Promise.all([spendingCheckData(today), getBalance(), listSetAsides()]);
  const setAside = funds.reduce((a, f) => a + Math.max(0, f.remaining), 0);
  const overspentFunds = funds
    .filter((f) => f.purpose === "saving" && !f.ended_on && f.remaining < 0)
    .map((f) => ({ id: f.id, name: f.name, over: -f.remaining }));
  const insights = buildInsights({ today, ...data, freeToSpend: balance ? balance.balance - setAside : null, overspentFunds });
  return json({ ok: true, ...insights });
});
