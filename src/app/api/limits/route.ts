import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { deleteLimit, listLimits, setLimit } from "@/lib/repo";
import { limitDelete, limitInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession(req);
  return json({ ok: true, items: await listLimits() });
});

/** PUT { category, amount } sets or changes a category's monthly limit. */
export const PUT = handle(async (req: Request) => {
  await requireSession(req);
  const parsed = limitInput.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  await setLimit(parsed.data.category, parsed.data.amount);
  return json({ ok: true });
});

export const DELETE = handle(async (req: Request) => {
  await requireSession(req);
  const parsed = limitDelete.safeParse(await readJson(req, 512));
  if (!parsed.success) throw new HttpError(400, "Choose a category");
  if (!(await deleteLimit(parsed.data.category))) throw new HttpError(404, "No limit for that category");
  return json({ ok: true });
});
