import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { formatPaisa } from "@/lib/money";
import { deleteShare, getShare, linkPayment, settleShare, shareMatches, unlinkPayment, updateShare } from "@/lib/splits-repo";
import { searchParamsObject, shareInput, splitAction } from "@/lib/validation";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

async function shareId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError(404, "Share not found");
  return id;
}

/** GET returns the share; GET ?matches=1[&q=] incoming money that could be its repayment, best guesses first. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const id = await shareId(ctx);
  const sp = searchParamsObject(req.url);
  if (sp.matches) {
    const items = await shareMatches(id, sp.q?.trim().slice(0, 100) || undefined);
    if (!items) throw new HttpError(404, "Share not found");
    return json({ ok: true, items });
  }
  const share = await getShare(id);
  if (!share) throw new HttpError(404, "Share not found");
  return json({ ok: true, share });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const id = await shareId(ctx);
  const parsed = shareInput.safeParse(await readJson(req, 2048));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  const r = await updateShare(id, parsed.data);
  if (r === "missing") throw new HttpError(404, "Share not found");
  if (r !== "ok") throw new HttpError(400, `That's more than is left of the payment. This share can be up to ${formatPaisa(Math.max(0, r.left))}.`, { fields: { amount: ["More than is left of the payment"] } });
  return json({ ok: true });
});

/** POST { action: "link" | "unlink", transactionId } | { action: "settle", note } | { action: "reopen" }. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const id = await shareId(ctx);
  const parsed = splitAction.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, "Unknown action");
  const a = parsed.data;
  if (a.action === "link") {
    const r = await linkPayment(id, a.transactionId);
    if (r === "missing") throw new HttpError(404, "Share not found");
    if (r === "no-transaction") throw new HttpError(404, "Transaction not found");
    if (r === "not-incoming") throw new HttpError(400, "Only money you received can pay back a share");
    if (r === "taken") throw new HttpError(409, "That payment is already linked to another share");
  } else if (a.action === "unlink") {
    if (!(await unlinkPayment(id, a.transactionId))) throw new HttpError(404, "That payment isn't linked to this share");
  } else if (!(await settleShare(id, a.action === "settle", a.action === "settle" ? a.note ?? null : null))) {
    throw new HttpError(404, "Share not found");
  }
  return json({ ok: true, share: await getShare(id) });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  if (!(await deleteShare(await shareId(ctx)))) throw new HttpError(404, "Share not found");
  return json({ ok: true });
});
