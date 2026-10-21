"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatPaisa, paisaToDecimal } from "@/lib/money";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { apiFetch, ApiError } from "./api";
import { useData } from "./useData";
import { ErrorBox, Skeleton } from "./States";
import { useToast } from "./Toast";
import type { BalanceSummary } from "./types";

/** Current bank balance: set by hand once, then moved by every transaction dated after that. */
export default function BalanceCard() {
  const { data, error, loading, reload } = useData<BalanceSummary & { ok: true }>("/api/balance");
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const b = data?.balance ?? null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {error ? <ErrorBox message={error} onRetry={reload} /> : (
        <div className="balance-card">
          <div>
            <div className="label muted small">MCB balance</div>
            {loading && !data ? <Skeleton h={36} w={200} /> : b ? (
              <>
                <div className="big" style={{ color: b.balance < 0 ? "var(--expense)" : undefined }}>{formatPaisa(b.balance)}</div>
                <div className="small muted">
                  Set to {formatPaisa(b.anchor)} on {formatDatePkt(b.as_of)} {formatTimePkt(b.as_of)}
                  {b.n > 0 ? `, then ${b.n} transaction${b.n === 1 ? "" : "s"} (${formatPaisa(b.delta, { sign: true })})` : ""}
                </div>
              </>
            ) : (
              <>
                <div className="big muted">Not set yet</div>
                <div className="small muted">Enter your current balance once. After that, every incoming and outgoing payment updates it.</div>
              </>
            )}
          </div>
          {data && data.setAside > 0 && b && (
            <div>
              <div className="label muted small">Set aside</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600 }}><Link href="/app/set-asides" style={{ color: "inherit" }}>{formatPaisa(data.setAside)}</Link></div>
              <div className="small muted">Free to spend: <strong>{formatPaisa(data.freeToSpend ?? 0)}</strong></div>
            </div>
          )}
          <button className="btn" onClick={() => setEditing(true)} disabled={loading && !data}>{b ? "Adjust balance" : "Set balance"}</button>
        </div>
      )}
      {editing && (
        <BalanceModal
          initial={b ? paisaToDecimal(b.balance) : ""}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast("Balance updated", "ok");
            reload();
          }}
        />
      )}
    </div>
  );
}

function BalanceModal({ initial, onClose, onSaved }: { initial: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/balance", { method: "PUT", body: JSON.stringify({ amount }) });
      onSaved();
    } catch (ex) {
      const a = ex as ApiError;
      setErr(a.fields?.amount?.[0] ?? a.message);
      setBusy(false);
    }
  }
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="bal-title" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 id="bal-title">Current MCB balance</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={submit}>
          <label className="field">Balance right now (PKR)
            <input inputMode="decimal" placeholder="e.g. 85,301.17" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </label>
          <p className="small muted" style={{ marginTop: 10 }}>Copy it from the MCB app. Payments recorded from now on will move it up or down automatically.</p>
          {err && <div className="alert error" style={{ marginTop: 12 }} role="alert">{err}</div>}
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || !amount.trim()}>{busy ? "Saving…" : "Save balance"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
