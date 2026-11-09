import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { deleteTransaction, updateTransaction } from "@/lib/repo";
import { transactionInput } from "@/lib/validation";
import { readChargeEdits } from "@/lib/charges";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError(404, "Not found");
  const body = await readJson(req, 4096);
  const parsed = transactionInput.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  // The fee or tax on a transfer is set here: it is kept as its own "Bank charges" or "Tax deducted" expense linked to it.
  const item = await updateTransaction(id, parsed.data, readChargeEdits(body));
  if (!item) throw new HttpError(404, "Transaction not found");
  return json({ ok: true, item });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  requireSession(req);
  const { id } = await ctx.params;
  if (!UUID.test(id) || !(await deleteTransaction(id))) throw new HttpError(404, "Transaction not found");
  return json({ ok: true });
});
