import { z } from "zod";
import { requireConfirmed, requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { BIN_DAYS, listBin, purgeBin, restoreTransaction } from "@/lib/bin";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession(req);
  return json({ ok: true, days: BIN_DAYS, items: await listBin() });
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("restore"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("empty") }),
]);

/** restore puts one back; delete and empty remove for good, and ask for the passphrase first. */
export const POST = handle(async (req: Request) => {
  await requireSession(req);
  const parsed = input.safeParse(await readJson(req, 512));
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const body = parsed.data;
  if (body.action === "restore") {
    if (!(await restoreTransaction(body.id))) throw new HttpError(404, "That transaction isn't in the recycle bin");
  } else {
    await requireConfirmed(req);
    await purgeBin(body.action === "delete" ? body.id : undefined);
  }
  return json({ ok: true, days: BIN_DAYS, items: await listBin() });
});
