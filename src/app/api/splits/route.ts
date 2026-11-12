import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { formatPaisa } from "@/lib/money";
import { addShares, listSplits, ownerName, splitPeople, splitsForBill } from "@/lib/splits-repo";
import { searchParamsObject, splitInput } from "@/lib/validation";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET lists open and recently settled shares; GET ?bill=<transaction id> the shares on one payment. */
export const GET = handle(async (req: Request) => {
  requireSession(req);
  const bill = searchParamsObject(req.url).bill;
  const owner = await ownerName();
  if (bill !== undefined) {
    if (!UUID.test(bill)) throw new HttpError(404, "Transaction not found");
    const d = await splitsForBill(bill);
    if (!d) throw new HttpError(404, "Transaction not found");
    return json({ ok: true, owner, people: await splitPeople(), ...d });
  }
  return json({ ok: true, owner, ...(await listSplits()) });
});

/** POST { transactionId, shares: [{ person, amount, note }] } splits a payment. */
export const POST = handle(async (req: Request) => {
  requireSession(req);
  const parsed = splitInput.safeParse(await readJson(req, 8192));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors, issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) });
  const r = await addShares(parsed.data.transactionId, parsed.data.shares);
  if ("error" in r) {
    if (r.error === "no-bill") throw new HttpError(404, "Transaction not found");
    if (r.error === "not-expense") throw new HttpError(400, "Only money you paid out can be split");
    throw new HttpError(400, `The shares come to more than the payment. ${formatPaisa(Math.max(0, r.left ?? 0))} is left to split.`);
  }
  return json({ ok: true, ids: r.ids }, 201);
});
