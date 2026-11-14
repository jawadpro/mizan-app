import { HttpError, errorJson, handle, json } from "@/lib/http";
import { getImportRun, importSummary, lastAlertAt, lastFinishedRun, startImportRun } from "@/lib/import-runs";
import { phoneUrl, shortcutConfig } from "@/lib/paired-devices";
import { rateLimit } from "@/lib/ratelimit";
import { QUEUE_SCRIPT_NAME, scriptableRunUrl, shortcutRunUrl } from "@/lib/shortcut-link";
import { requireWidget } from "@/lib/widget-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const runView = (r: NonNullable<Awaited<ReturnType<typeof getImportRun>>>) => ({
  id: r.id, finishedAt: r.finished_at, sent: r.sent_count, imported: r.imported_count, review: r.review_count,
  duplicates: r.duplicate_count, ignored: r.ignored_count, failed: r.failed_count, summary: importSummary(r),
});

/**
 * For the queued messages widget, with `Authorization: Bearer <device key>`. The queue itself lives on the iPhone
 * (the widget counts the files there); Mizan adds when the last import and the last bank alert happened.
 * GET ?run=<id> returns how that import went.
 */
export const GET = handle(async (req: Request) => {
  await requireWidget(req);
  const run = new URL(req.url).searchParams.get("run");
  if (run !== null) {
    if (!UUID.test(run)) throw new HttpError(404, "That import wasn't found");
    const r = await getImportRun(run);
    if (!r) throw new HttpError(404, "That import wasn't found");
    return json({ ok: true, run: runView(r) });
  }
  const [last, alertAt] = await Promise.all([lastFinishedRun(), lastAlertAt()]);
  return json({
    ok: true,
    lastImport: last ? runView(last) : null,
    lastAlertAt: alertAt,
    shortcutName: shortcutConfig().name,
    appUrl: `${phoneUrl(req)}/app`,
  });
});

/** Starts "Import queued messages" from the widget: returns the link that runs the Mizan Shortcut and comes back. */
export const POST = handle(async (req: Request) => {
  await requireWidget(req);
  if (!(await rateLimit("importrun", 30, 3600))) return errorJson(429, "Too many imports in an hour. Try again later.");
  const id = await startImportRun();
  const runUrl = shortcutRunUrl(shortcutConfig().name, `mizan-import:${id}`, {
    success: scriptableRunUrl(QUEUE_SCRIPT_NAME, { done: id }),
    error: scriptableRunUrl(QUEUE_SCRIPT_NAME, { failed: id }),
  });
  return json({ ok: true, id, runUrl });
});
