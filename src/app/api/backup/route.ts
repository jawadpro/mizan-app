import { requireSession } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { latestBackup, runBackup } from "@/lib/backup";
import { connected, googleConfigured } from "@/lib/gdrive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle(async (req: Request) => {
  requireSession(req);
  const configured = googleConfigured();
  const isConnected = configured && (await connected());
  const latest = isConnected ? await latestBackup().catch(() => null) : null;
  return json({ ok: true, googleConfigured: configured, driveConnected: isConnected, latest });
});

/** "Back up now": same as the nightly job. */
export const POST = handle(async (req: Request) => {
  requireSession(req);
  const r = await runBackup();
  return json(r, r.ok ? 200 : 502);
});
