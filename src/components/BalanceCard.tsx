"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatPaisa, getDisplayCurrency, paisaToDecimal } from "@/lib/money";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { apiFetch, ApiError } from "./api";
import { useData } from "./useData";
import { ErrorBox, Skeleton } from "./States";
import { useToast } from "./Toast";
import { bankLabel, useBanks } from "./useBanks";
import { digitsLabel } from "@/lib/banks";
import type { BalanceSummary } from "./types";
import CloseButton from "./CloseButton";

/**
 * Current bank balance: set by hand once per account, then moved by every transaction of that account dated after.
 * `bank` follows the dashboard's bank picker: "" is every account added up, an id is that account's own balance,
 * and "none" (cash) has no bank balance.
 */
export default function BalanceCard({ bank = "" }: { bank?: string }) {
  const { banks, multi, balanceName } = useBanks();
  const one = multi && bank && bank !== "none" ? banks.find((x) => x.id === bank) ?? null : null;
  const cash = multi && bank === "none";
  const { data, error, loading, reload } = useData<BalanceSummary & { ok: true }>(cash ? null : one ? `/api/balance?bank=${one.id}` : "/api/balance");
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const b = data?.balance ?? null;
  const all = multi && !one;
  const accountName = (id: string) => {
    const x = banks.find((k) => k.id === id);
    return x ? `${x.name}${x.account_hint ? ` ${digitsLabel(x.account_hint)}` : ""}` : "Account";
  };
  const label = one ? `${accountName(one.id)} balance` : cash ? "Cash" : multi ? "All banks" : balanceName;
  const unset = all ? banks.filter((x) => !data?.accounts?.some((a) => a.bank_id === x.id)) : [];

  const pct = b && b.anchor !== 0 && b.n > 0 ? Math.round((b.delta / Math.abs(b.anchor)) * 1000) / 10 : null;
  // Set-asides come out of all the money together, so the split shows with every account added up.
  const showSplit = !one && !!(data && b && data.setAside > 0 && b.balance > 0);
  const free = data?.freeToSpend ?? 0;
  const whole = (p: number, o: { sign?: boolean } = {}) => formatPaisa(Math.round(p), o).replace(/\.\d\d$/, "");

  if (cash) {
    return (
      <div className="card balance-hero" style={{ marginBottom: 16 }}>
        <div className="balance-card">
          <div className="label"><span>{label}</span></div>
          <div className="big muted">No bank balance</div>
          <div className="small muted">Cash payments don&apos;t move any account&apos;s balance. Pick a bank above, or All banks, to see a balance.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card balance-hero" style={{ marginBottom: 16 }}>
      {error ? <ErrorBox message={error} onRetry={reload} /> : (
        <div className="balance-card">
          <div className="label">
            <span>{label}</span>
            {pct != null && <span className={`delta ${pct >= 0 ? "good" : "bad"}`} title="Change since you last set the balance">{pct > 0 ? "+" : pct < 0 ? "−" : ""}{Math.abs(pct)}%</span>}
          </div>
          {loading && !data ? <Skeleton h={40} w={240} /> : b ? (
            <>
              <div className="big" style={{ color: b.balance < 0 ? "var(--down-ink)" : undefined }}>{formatPaisa(b.balance)}</div>
              {all ? (
                <div className="small muted balance-accounts">
                  {(data?.accounts ?? []).map((a) => (
                    <span key={a.bank_id}>{accountName(a.bank_id)} <span className="mono">{whole(a.balance)}</span></span>
                  ))}
                  {unset.length > 0 && <span>{unset.map((x) => x.name).join(", ")}: not set yet</span>}
                </div>
              ) : (
                <div className="small muted">
                  Set to {whole(b.anchor)} on {formatDatePkt(b.as_of)} {formatTimePkt(b.as_of)}
                  {b.n > 0 ? `, then ${b.n} transaction${b.n === 1 ? "" : "s"} (${whole(b.delta, { sign: true })})` : ""}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="big muted">Not set yet</div>
              <div className="small muted">
                {one ? `Enter what's in this account now, once. After that, every payment tagged with ${one.name} updates it.` : "Enter your current balance once. After that, every incoming and outgoing payment updates it."}
              </div>
            </>
          )}
          {showSplit && (
            <div className="balance-split" aria-hidden>
              <div style={{ flex: Math.max(0, free), background: "var(--text)" }} />
              <div style={{ flex: data!.setAside, background: "var(--accent)" }} />
            </div>
          )}
          <div className="balance-foot">
            {showSplit ? (
              <div className="balance-legs">
                <div>
                  <div className="leg-label"><span className="dot" style={{ background: "var(--text)" }} />Free to spend</div>
                  <div className="leg-value">{whole(free)}</div>
                </div>
                <div>
                  <div className="leg-label"><span className="dot" style={{ background: "var(--accent)" }} />Set aside</div>
                  <Link className="leg-value" href="/app/set-asides" style={{ display: "block" }}>{whole(data!.setAside)}</Link>
                </div>
              </div>
            ) : <span />}
            <button className="btn sm" onClick={() => setEditing(true)} disabled={loading && !data}>{b ? "Adjust balance" : "Set balance"}</button>
          </div>
        </div>
      )}
      {editing && (
        <BalanceModal
          accounts={data?.accounts ?? []}
          bank={one?.id ?? (all ? unset[0]?.id ?? banks[0]?.id ?? null : null)}
          choose={all}
          initial={b && !all ? paisaToDecimal(b.balance) : ""}
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

function BalanceModal({ accounts, bank: firstBank, choose, initial, onClose, onSaved }: {
  accounts: BalanceSummary["accounts"];
  bank: string | null;
  /** Let the owner pick the account (from "All banks"). */
  choose: boolean;
  initial: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { banks, balanceName } = useBanks();
  const [bank, setBank] = useState(firstBank);
  const current = (id: string | null) => {
    const a = accounts.find((x) => x.bank_id === id);
    return a ? paisaToDecimal(a.balance) : "";
  };
  const [amount, setAmount] = useState(choose ? current(firstBank) : initial);
  const named = bank ? banks.find((x) => x.id === bank) : null;
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
      await apiFetch("/api/balance", { method: "PUT", body: JSON.stringify({ amount, bank }) });
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
          <h2 id="bal-title">Current {named && !choose ? `${named.name} balance` : balanceName === "Bank balance" ? "bank balance" : balanceName}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <form onSubmit={submit}>
          {choose && (
            <label className="field" style={{ marginBottom: 12 }}>Account
              <select value={bank ?? ""} onChange={(e) => { setBank(e.target.value); setAmount(current(e.target.value)); }}>
                {banks.map((x) => <option key={x.id} value={x.id}>{bankLabel(x)}</option>)}
              </select>
            </label>
          )}
          <label className="field">Balance right now ({getDisplayCurrency()})
            <input inputMode="decimal" placeholder="e.g. 85,301.17" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </label>
          <p className="small muted" style={{ marginTop: 10 }}>Copy it from your banking app. Payments recorded from now on will move it up or down automatically.</p>
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
