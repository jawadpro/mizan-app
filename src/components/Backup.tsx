"use client";
import { useEffect, useState } from "react";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { apiFetch } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";

type Status = { googleConfigured: boolean; driveConnected: boolean; latest: { name: string; createdTime: string } | null };

const DRIVE_RESULT: Record<string, [string, "ok" | "error"]> = {
  connected: ["Google Drive is connected. Backups will be saved there every night.", "ok"],
  declined: ["Google Drive wasn't connected.", "error"],
  expired: ["That sign-in link expired. Please try connecting again.", "error"],
  failed: ["Google didn't give Mizan access. Please try connecting again.", "error"],
};

export default function Backup() {
  const { data, error, loading, reload } = useData<Status>("/api/backup");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("drive");
    if (r && DRIVE_RESULT[r]) {
      toast(...DRIVE_RESULT[r]);
      window.history.replaceState(null, "", "/app/backup");
    }
  }, [toast]);

  async function backupNow() {
    setBusy(true);
    try {
      const r = await apiFetch<{ transactions: number }>("/api/backup", { method: "POST" });
      toast(`Saved ${r.transactions} transactions to Google Drive`, "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      reload();
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Google Drive? Nightly backups stop; files already in Drive stay there.")) return;
    setBusy(true);
    try {
      await apiFetch("/api/backup/google", { method: "DELETE" });
      toast("Google Drive disconnected", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      reload();
    }
  }

  const last = data?.latest;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Backups</h1>
          <p className="muted">Every night at about 3 am, all your transactions are saved to your Google Drive as a spreadsheet file (CSV). The last 30 days are kept there; nothing extra is stored in Mizan.</p>
        </div>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <div className="card"><Loading rows={3} /></div> : data && (
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <strong>Google Drive</strong>
                <div className="small muted">
                  {!data.googleConfigured && "Google Drive isn't set up on the server yet."}
                  {data.googleConfigured && !data.driveConnected && "Not connected. Mizan will only be able to see the backup files it creates, not the rest of your Drive."}
                  {data.driveConnected && "Connected. Backups go to the “Mizan backups” folder."}
                </div>
              </div>
              <div className="toolbar">
                {data.googleConfigured && !data.driveConnected && <a className="btn primary sm" href="/api/backup/google/start">Connect Google Drive</a>}
                {data.driveConnected && (
                  <>
                    <button className="btn sm" disabled={busy} onClick={backupNow}>{busy ? "Backing up…" : "Back up now"}</button>
                    <button className="btn sm" disabled={busy} onClick={disconnect}>Disconnect</button>
                  </>
                )}
              </div>
            </div>
            {data.driveConnected && (
              <p className="small" style={{ marginTop: 10 }}>
                {last ? <>Latest backup in Drive: {formatDatePkt(last.createdTime)}, {formatTimePkt(last.createdTime)}</> : "No backup in Drive yet. Tap Back up now to make the first one."}
              </p>
            )}
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <strong>Download a copy</strong>
                <div className="small muted">Saves the same file to this device right now.</div>
              </div>
              <div className="toolbar">
                <a className="btn sm" href="/api/transactions/export">Download</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
