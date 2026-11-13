import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { HttpError, handle, json } from "@/lib/http";
import { getImportRun, importSummary } from "@/lib/import-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** How an import run is going, for the app to show once the Shortcut is done. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const id = z.string().uuid().safeParse((await ctx.params).id);
  const run = id.success ? await getImportRun(id.data) : null;
  if (!run) throw new HttpError(404, "Import not found");
  return json({ ok: true, run, summary: importSummary(run) });
});
