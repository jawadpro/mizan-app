import "server-only";
import { toCsv } from "./csv";
import { exportTransactions } from "./repo";
import { todayPkt } from "./time";
import { DriveError, latestBackup, uploadBackup } from "./gdrive";

export const KEEP_BACKUPS = 30;

/**
 * Copies every transaction to Google Drive as a CSV (the same format as the Transactions export).
 * The file is built in memory and sent straight to Drive; nothing is stored in Vercel or the database.
 */
export async function runBackup() {
  try {
    const rows = await exportTransactions("app", {});
    const name = `mizan-backup-${todayPkt()}.csv`;
    const data = Buffer.from(toCsv(rows), "utf8");
    await uploadBackup(name, data, KEEP_BACKUPS);
    return { ok: true as const, file: name, transactions: rows.length };
  } catch (e) {
    if (!(e instanceof DriveError)) console.error("[mizan] backup failed", (e as Error)?.name, (e as { code?: string })?.code ?? "");
    return { ok: false as const, error: e instanceof DriveError ? e.message : "The backup could not be made" };
  }
}

export { latestBackup };
