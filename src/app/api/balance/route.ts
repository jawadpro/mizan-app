import { requireConfirmed, requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { getBalances, listSetAsides, setBalance } from "@/lib/repo";
import { balanceInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `balance` is every account together, or one account's with ?bank=<id>. `accounts` lists each account's own.
 * With every account, every set-aside comes out of the total. With one account, only the set-asides linked to it
 * come out of its balance: shared ones come out of all the money together.
 */
async function summary(bank: string | null) {
  const [{ total, accounts }, funds] = await Promise.all([getBalances(), listSetAsides()]);
  const setAside = funds.filter((f) => !bank || f.bank_id === bank).reduce((a, f) => a + Math.max(0, f.remaining), 0);
  const balance = bank ? accounts.find((a) => a.bank_id === bank) ?? null : total;
  return { balance, accounts, setAside, freeToSpend: balance ? balance.balance - setAside : null };
}

function bankParam(req: Request) {
  const b = new URL(req.url).searchParams.get("bank");
  return b && UUID.test(b) ? b : null;
}

export const GET = handle(async (req: Request) => {
  await requireSession(req);
  return json({ ok: true, ...(await summary(bankParam(req))) });
});

/** Adjusting the balance asks for the passphrase first. */
export const PUT = handle(async (req: Request) => {
  await requireConfirmed(req);
  const parsed = balanceInput.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  await setBalance(parsed.data.amount, parsed.data.bank ?? null);
  return json({ ok: true, ...(await summary(parsed.data.bank ?? null)) });
});
