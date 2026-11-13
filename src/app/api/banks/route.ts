import { requireConfirmed, requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { listBanks, listBanksWithRecords, saveBanks } from "@/lib/repo";
import { banksInput } from "@/lib/banks";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession(req);
  return json({ ok: true, ...(await listBanksWithRecords()) });
});

/**
 * PUT { items: [...] } saves the whole list in order; rows keep their id so transactions stay tagged.
 * A bank left out that has transactions is moved to `removed` (restorable) instead of being deleted.
 */
export const PUT = handle(async (req: Request) => {
  await requireSession(req);
  const parsed = banksInput.safeParse(await readJson(req, 32 * 1024));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Please check the banks");
  // Removing a bank asks for the passphrase first.
  const keep = new Set(parsed.data.items.map((b) => b.id).filter(Boolean));
  if ((await listBanks()).some((b) => !keep.has(b.id))) await requireConfirmed(req);
  return json({ ok: true, ...(await saveBanks(parsed.data.items)) });
});
