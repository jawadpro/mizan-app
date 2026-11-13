"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, REVIEW_CHANGED } from "./api";
import { isIphone } from "./paired-devices";
import { useToast } from "./Toast";

type Run = {
  id: string; finished_at: string | null; sent_count: number; imported_count: number; review_count: number;
  duplicate_count: number; ignored_count: number; failed_count: number;
};
type Status = { run: Run; summary: string };

const KEY = "mizan.importRun";
const GIVE_UP_MS = 15 * 60e3;

/**
 * "Import queued messages", from the phone's More menu: opens the Mizan Shortcut in import mode. It sends each alert
 * it saved while offline, then says it's finished. This follows the run from anywhere in the app (it lives in the
 * Shell) and shows how many were imported when you're back. Only offered on an iPhone, which holds the queue.
 */
export function useImportQueue() {
  const toast = useToast();
  const [phone, setPhone] = useState(false);
  const [pending, setPending] = useState<{ id: string; at: number } | null>(null);
  const [sent, setSent] = useState(0);
  const [busy, setBusy] = useState(false);
  const announced = useRef<string | null>(null);

  useEffect(() => {
    setPhone(isIphone());
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      if (saved?.id && Date.now() - saved.at < GIVE_UP_MS) setPending(saved);
    } catch {}
  }, []);

  const stop = useCallback(() => {
    setPending(null);
    setSent(0);
    try { sessionStorage.removeItem(KEY); } catch {}
  }, []);

  const check = useCallback(async (id: string) => {
    try {
      const s = await apiFetch<Status & { ok: true }>(`/api/devices/import/${id}`);
      setSent(s.run.sent_count);
      if (s.run.finished_at) {
        stop();
        if (announced.current !== id) {
          announced.current = id;
          toast(s.summary, s.run.failed_count ? "error" : "ok");
          window.dispatchEvent(new Event(REVIEW_CHANGED));
        }
      }
    } catch (e) {
      stop();
      toast((e as Error).message, "error");
    }
  }, [toast, stop]);

  // Follow the run while the Shortcut works, and as soon as you come back to Mizan.
  useEffect(() => {
    if (!pending) return;
    check(pending.id);
    const t = setInterval(() => {
      if (Date.now() - pending.at > GIVE_UP_MS) return stop();
      if (document.visibilityState === "visible") check(pending.id);
    }, 2000);
    const onShow = () => document.visibilityState === "visible" && check(pending.id);
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [pending, check, stop]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const r = await apiFetch<{ id: string; runUrl: string }>("/api/devices/import", { method: "POST" });
      const p = { id: r.id, at: Date.now() };
      setPending(p);
      try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch {}
      window.location.href = r.runUrl;
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const label = busy ? "Opening Shortcut…" : pending ? (sent ? `Importing… ${sent} sent` : "Importing…") : "Import queued messages";
  return { available: phone, start, label, running: busy || !!pending };
}
