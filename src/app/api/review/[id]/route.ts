import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { confirmReview, dismissReview } from "@/lib/repo";
import { readCharges } from "@/lib/charges";
import { transactionInput } from "@/lib/validation";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError(404, "Not found");
  const body = (await readJson(req, 4096)) as { action?: string; transaction?: unknown; charges?: unknown };
  if (body?.action === "dismiss") {
    if (!(await dismissReview(id))) throw new HttpError(404, "Review item not found or already resolved");
    return json({ ok: true, status: "dismissed" });
  }
  if (body?.action !== "confirm") throw new HttpError(400, "action must be confirm or dismiss");
  const parsed = transactionInput.safeParse(body.transaction);
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  // Optional bank charge or tax on a transfer, recorded as its own "Bank charges" expense.
  const chargesPaisa = readCharges(body);
  const out = await confirmReview(id, parsed.data, chargesPaisa);
  if (!out) throw new HttpError(404, "Review item not found or already resolved");
  if ("duplicate" in out) throw new HttpError(409, "A transaction with this bank reference already exists");
  return json({ ok: true, status: "confirmed", item: out.transaction });
});
