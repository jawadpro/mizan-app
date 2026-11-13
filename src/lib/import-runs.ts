import "server-only";
import { q } from "./db";

// "Import queued messages": the app starts a run and opens the Mizan Shortcut with `mizan-import:<id>`. The
// Shortcut sends each queued alert to /api/sms with "importRun": <id>, then sends { importRun, finished: true }.
// Mizan counts what happened to each alert so the app can say how many were imported. No message content is kept.

/** A run accepts alerts for this long after it was started. */
const RUN_HOURS = 6;

export type ImportRun = {
  id: string; created_at: string; started_at: string | null; finished_at: string | null;
  sent_count: number; imported_count: number; review_count: number; duplicate_count: number; ignored_count: number; failed_count: number;
};

const COLS = "id, created_at, started_at, finished_at, sent_count, imported_count, review_count, duplicate_count, ignored_count, failed_count";

export async function startImportRun(): Promise<string> {
  q(`DELETE FROM app.import_runs WHERE created_at < now() - interval '30 days'`).catch(() => {});
  const { rows } = await q<{ id: string }>(`INSERT INTO app.import_runs DEFAULT VALUES RETURNING id`);
  return rows[0].id;
}

export async function getImportRun(id: string): Promise<ImportRun | null> {
  const { rows } = await q<ImportRun>(`SELECT ${COLS} FROM app.import_runs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

const COUNTER: Record<string, string> = {
  imported: "imported_count", review: "review_count", duplicate: "duplicate_count", ignored: "ignored_count", failed: "failed_count",
};

/** Counts one queued alert for an open run. Returns false if the run is unknown, finished or too old. */
export async function countImport(id: string, outcome: string, deviceId: string | null): Promise<boolean> {
  const col = COUNTER[outcome];
  if (!col) return false;
  // col comes from the fixed table above, never from input.
  const { rowCount } = await q(
    `UPDATE app.import_runs SET ${col} = ${col} + 1, sent_count = sent_count + 1,
            started_at = coalesce(started_at, now()), device_id = coalesce(device_id, $2)
     WHERE id = $1 AND finished_at IS NULL AND created_at > now() - make_interval(hours => $3)`,
    [id, deviceId, RUN_HOURS],
  );
  return rowCount === 1;
}

/** The Shortcut has sent everything it had. Returns the run as it ended, or null if it was unknown or too old. */
export async function finishImportRun(id: string, deviceId: string | null): Promise<ImportRun | null> {
  const { rows } = await q<ImportRun>(
    `UPDATE app.import_runs SET finished_at = coalesce(finished_at, now()), started_at = coalesce(started_at, now()),
            device_id = coalesce(device_id, $2)
     WHERE id = $1 AND created_at > now() - make_interval(hours => $3)
     RETURNING ${COLS}`,
    [id, deviceId, RUN_HOURS],
  );
  return rows[0] ?? null;
}

/** One line for the Shortcut's notification and the app. */
export function importSummary(r: Pick<ImportRun, "sent_count" | "imported_count" | "review_count" | "duplicate_count" | "ignored_count" | "failed_count">): string {
  if (r.sent_count === 0) return "No queued messages to import.";
  const parts = [`${r.imported_count} imported`];
  if (r.review_count) parts.push(`${r.review_count} to review`);
  if (r.duplicate_count) parts.push(`${r.duplicate_count} already in Mizan`);
  if (r.ignored_count) parts.push(`${r.ignored_count} ignored (OTP, promos)`);
  if (r.failed_count) parts.push(`${r.failed_count} failed`);
  return `${r.sent_count} queued ${r.sent_count === 1 ? "message" : "messages"}: ${parts.join(", ")}.`;
}
