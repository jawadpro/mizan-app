import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { getBalance, listSetAsides, setBalance } from "@/lib/repo";
import { balanceInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

async function summary() {
  const [balance, funds] = await Promise.all([getBalance(), listSetAsides()]);
  const setAside = funds.reduce((a, f) => a + Math.max(0, f.remaining), 0);
  return { balance, setAside, freeToSpend: balance ? balance.balance - setAside : null };
}

export const GET = handle(async (req: Request) => {
  requireSession(req);
  return json({ ok: true, ...(await summary()) });
});

export const PUT = handle(async (req: Request) => {
  requireSession(req);
  const parsed = balanceInput.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  await setBalance(parsed.data.amount);
  return json({ ok: true, ...(await summary()) });
});
