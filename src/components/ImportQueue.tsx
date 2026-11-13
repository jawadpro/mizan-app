"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, REVIEW_CHANGED } from "./api";
import { isIphone } from "./paired-devices";
import { useToast } from "./Toast";
import "@/app/setup.css";

type Run = {
  id: string; finished_at: string | null; sent_count: number; imported_count: number; review_count: number;
  duplicate_count: number; ignored_count: number; failed_count: number;
};
type Status = { run: Run; summary: string };

const KEY = "mizan.importRun";
const GIVE_UP_MS = 15 * 60e3;

/**
 * "Import queued messages": opens the Mizan Shortcut in import mode. It sends each alert it saved while offline,
 * then says it's finished; this page follows along and shows how many were imported.
 */
export default function ImportQueue({ shortcutName = "Mizan", onImported }: { shortcutName?: string; onImported?: () => void }) {
  const toast = useToast();
  const [phone, setPhone] = useState(false);
  const [pending, setPending] = useState<{ id: string; at: number } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const announced = useRef<string | null>(null);

  useEffect(() => {
    setPhone(isIphone());
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      if (saved?.id && Date.now() - saved.at < GIVE_UP_MS) setPending(saved);
    } catch {}
  }, []);

  const check = useCallback(async (id: string) => {
    try {
      const s = await apiFetch<Status & { ok: true }>(`/api/devices/import/${id}`);
      setStatus(s);
      if (s.run.finished_at) {
        setPending(null);
        try { sessionStorage.removeItem(KEY); } catch {}
        if (announced.current !== id) {
          announced.current = id;
          toast(s.summary, s.run.failed_count ? "error" : "ok");
          onImported?.();
          window.dispatchEvent(new Event(REVIEW_CHANGED));
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [toast, onImported]);

  // Follow the run while the Shortcut works, and as soon as you come back to Mizan.
  useEffect(() => {
    if (!pending) return;
    check(pending.id);
    const t = setInterval(() => {
      if (Date.now() - pending.at > GIVE_UP_MS) return setPending(null);
      if (document.visibilityState === "visible") check(pending.id);
    }, 2000);
    const onShow = () => document.visibilityState === "visible" && check(pending.id);
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [pending, check]);

  async function start() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await apiFetch<{ id: string; runUrl: string }>("/api/devices/import", { method: "POST" });
      const p = { id: r.id, at: Date.now() };
      setPending(p);
      try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch {}
      window.location.href = r.runUrl;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const run = status?.run;
  // Only the iPhone that holds the queue can use this, so it only shows there (or while an import is running).
  if (!phone && !pending && !run) return null;
  return (
    <div className="card iq">
      <div className="iq-row">
        <div className="iq-text">
          <b>Queued messages</b>
          <div className="small muted">Alerts that arrived with no internet wait in the {shortcutName} Shortcut. Send them to Mizan; it skips any it already has.</div>
        </div>
        <button className="btn" onClick={start} disabled={busy || !phone}>
          {busy ? "Opening Shortcut…" : "Import queued messages"}
        </button>
      </div>
      {pending && !run?.finished_at && (
        <div className="iph-waiting small" role="status" style={{ marginTop: 8 }}>
          <span className="iph-pulse" aria-hidden /> {run?.sent_count ? `${run.sent_count} sent so far…` : "Waiting for the Shortcut…"}
        </div>
      )}
      {run?.finished_at && (
        <div className={`alert ${run.failed_count ? "error" : "ok"}`} role="status" style={{ marginTop: 8 }}>
          <span>{status!.summary}</span>
        </div>
      )}
      {error && <div className="alert error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
