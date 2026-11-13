import { requireSession } from "@/lib/auth";
import { errorJson, handle, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { shortcutConfig } from "@/lib/paired-devices";
import { startImportRun } from "@/lib/import-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts "Import queued messages": returns the link that opens the Mizan Shortcut in import mode. */
export const POST = handle(async (req: Request) => {
  await requireSession(req);
  if (!(await rateLimit("importrun", 30, 3600))) return errorJson(429, "Too many imports in an hour. Try again later.");
  const id = await startImportRun();
  const input = `mizan-import:${id}`;
  const runUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutConfig().name)}&input=text&text=${encodeURIComponent(input)}`;
  return json({ ok: true, id, input, runUrl });
});
