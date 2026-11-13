"use client";
import { useState } from "react";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { apiFetch, CancelledError } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";

type Device = { id: string; label: string; ip: string | null; created_at: string; last_seen_at: string; remembered: boolean; current: boolean };
type State = { devices: Device[] };

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return "active now";
  if (min < 60) return `active ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `active ${h} h ago`;
  return `last active ${formatDatePkt(iso)}`;
}

/** Settings → Sign-in: every device that is signed in, with sign out. */
export default function Security() {
  const { data, error, loading, reload } = useData<State & { ok: true }>("/api/security");
  const [local, setLocal] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const s = local ?? data;

  async function act(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    try {
      setLocal(await apiFetch<State>("/api/security", { method: "POST", body: JSON.stringify(body) }));
      toast(done, "ok");
    } catch (e) {
      if (!(e instanceof CancelledError)) toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !s) return <Loading rows={3} />;
  if (!s) return null;
  const others = s.devices.filter((d) => !d.current);

  return (
    <div className="set-row column">
      <div className="set-text">
        <div className="set-title">Signed-in devices</div>
        <div className="set-hint">Every phone and computer signed in to Mizan. Signing one out ends its session at once; it needs your passphrase to get back in.</div>
      </div>
      <div className="dev-list">
        {s.devices.map((d) => (
          <div key={d.id} className="dev">
            <div className="dev-text">
              <div className="dev-name">
                {d.label}
                {d.current && <span className="dev-tag on">This device</span>}
              </div>
              <div className="dev-meta">
                {d.current ? "active now" : ago(d.last_seen_at)} · signed in {formatDatePkt(d.created_at)} {formatTimePkt(d.created_at)}{d.ip ? ` · ${d.ip}` : ""}
              </div>
            </div>
            {!d.current && (
              <button className="btn sm danger" disabled={!!busy} onClick={() => act(d.id, { action: "sign-out", id: d.id }, `${d.label} signed out`)}>
                {busy === d.id ? "Signing out…" : "Sign out"}
              </button>
            )}
          </div>
        ))}
        {others.length > 1 && (
          <div><button className="btn sm danger" disabled={!!busy} onClick={() => act("others", { action: "sign-out-others" }, "Every other device is signed out")}>Sign out all other devices</button></div>
        )}
      </div>
    </div>
  );
}
