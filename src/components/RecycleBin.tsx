"use client";
import Link from "next/link";
import { useState } from "react";
import { formatPaisa } from "@/lib/money";
import { formatDatePkt } from "@/lib/time";
import { apiFetch, CancelledError } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";

type Item = { id: string; kind: string; amount_paisa: number; occurred_at: string; category: string; counterparty: string | null; note: string | null; deleted_at: string };
type Bin = { days: number; items: Item[] };

const DAY = 86400e3;

/** Deleted transactions, kept for 30 days: put one back, or delete it for good (that asks for the passphrase). */
export default function RecycleBin() {
  const { data, error, loading, reload } = useData<Bin & { ok: true }>("/api/bin");
  const [local, setLocal] = useState<Bin | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const toast = useToast();
  const bin = local ?? data;

  async function act(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    try {
      setLocal(await apiFetch<Bin>("/api/bin", { method: "POST", body: JSON.stringify(body) }));
      toast(done, "ok");
    } catch (e) {
      if (!(e instanceof CancelledError)) toast((e as Error).message, "error");
    } finally {
      setBusy(null);
      setConfirmEmpty(false);
    }
  }

  const left = (i: Item) => Math.max(0, Math.ceil(((bin?.days ?? 30) * DAY - (Date.now() - Date.parse(i.deleted_at))) / DAY));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recycle bin</h1>
          <p className="muted">Deleted transactions wait here for {bin?.days ?? 30} days, then they&apos;re gone for good. Restoring one puts it back in your totals and balance.</p>
        </div>
        {bin && bin.items.length > 0 && (
          confirmEmpty ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" onClick={() => setConfirmEmpty(false)} disabled={!!busy}>Keep them</button>
              <button className="btn danger-solid" onClick={() => act("empty", { action: "empty" }, "Recycle bin emptied")} disabled={!!busy}>{busy === "empty" ? "Emptying…" : `Delete all ${bin.items.length} for good`}</button>
            </div>
          ) : (
            <button className="btn danger" onClick={() => setConfirmEmpty(true)} disabled={!!busy}>Empty bin</button>
          )
        )}
      </div>
      <div className="card">
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !bin ? <Loading rows={4} /> : bin && bin.items.length === 0 ? (
          <div className="empty" style={{ padding: 24, textAlign: "center" }}>
            <p className="muted">Nothing here. Transactions you delete show up here for {bin.days} days.</p>
            <Link className="btn sm" href="/app/transactions">Go to transactions</Link>
          </div>
        ) : bin && (
          <div className="bin-list">
            {bin.items.map((i) => (
              <div key={i.id} className="bin-row">
                <div className="bin-main">
                  <div className="bin-title">
                    <span className={`amt ${i.kind}`}>{i.kind === "expense" ? "−" : "+"}{formatPaisa(i.amount_paisa)}</span>
                    {i.counterparty ? ` · ${i.counterparty}` : ""}
                  </div>
                  <div className="small muted">
                    {i.category} · {formatDatePkt(i.occurred_at)} · deleted {formatDatePkt(i.deleted_at)}, {left(i)} day{left(i) === 1 ? "" : "s"} left
                  </div>
                </div>
                <div className="bin-actions">
                  <button className="btn sm danger" disabled={!!busy} onClick={() => act(i.id + ":d", { action: "delete", id: i.id }, "Deleted for good")}>Delete for good</button>
                  <button className="btn sm primary" disabled={!!busy} onClick={() => act(i.id, { action: "restore", id: i.id }, "Restored")}>{busy === i.id ? "Restoring…" : "Restore"}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
