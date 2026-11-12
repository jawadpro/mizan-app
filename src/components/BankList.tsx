"use client";
import { useEffect, useState } from "react";
import { MAX_BANKS, type Bank } from "@/lib/banks";
import { apiFetch } from "./api";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";
import { useData } from "./useData";
import type { BankItem } from "./useBanks";

type Row = Bank & { key: number };
const blank = (key: number): Row => ({ key, name: "", senders: "", account_hint: "", auto_import: true, hold_transfers: true });
const toRows = (items: BankItem[]) => items.map((b, i) => ({ ...b, key: i }));

function Check({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <label className="bank-check">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** The banks the owner gets alerts from: one row each, matched to alerts by sender. */
export default function BankList({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const saved = useData<{ items: BankItem[] }>("/api/banks");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (saved.data && rows === null) setRows(toRows(saved.data.items));
  }, [saved.data, rows]);

  const nextKey = () => Math.max(0, ...(rows ?? []).map((r) => r.key)) + 1;
  const update = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const removing = (rows ?? []).length < (saved.data?.items.length ?? 0) || (saved.data?.items ?? []).some((b) => !(rows ?? []).some((r) => r.id === b.id));

  async function save() {
    setBusy(true);
    try {
      const items = rows!.filter((r) => r.name.trim() || r.senders.trim()).map(({ key: _k, ...b }) => b);
      const res = await apiFetch<{ items: BankItem[] }>("/api/banks", { method: "PUT", body: JSON.stringify({ items }) });
      setRows(toRows(res.items));
      setDirty(false);
      saved.reload();
      onSaved?.();
      toast("Banks saved", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="set-row column">
      <div className="set-text">
        <div className="set-title">Banks</div>
        <div className="set-hint">One row per bank account you get alerts from. Mizan trusts alerts only from these senders; anything else waits in Review. With two or more accounts at one bank, give each the same senders and its own digits: the last 4 of the account, plus any debit card's, with commas between. Mizan files each alert under the account whose digits it shows, and when it can't tell, the alert waits in Review for you to pick. With two or more banks, the Overview and Transactions pages get a bank filter.</div>
      </div>
      {saved.error ? <ErrorBox message={saved.error} onRetry={saved.reload} /> : !rows ? <Loading rows={2} /> : (
        <div className="bank-list">
          {rows.length === 0 && <div className="small muted">No banks yet. Add the bank your alerts come from.</div>}
          {rows.map((r, i) => (
            <div key={r.key} className="bank">
              <div className="bank-head">
                <span className="small muted">Bank {i + 1}</span>
                <button className="btn ghost sm" onClick={() => { setRows(rows.filter((x) => x.key !== r.key)); setDirty(true); }}>Remove</button>
              </div>
              <div className="bank-grid">
                <label className="field">Bank name
                  <input value={r.name} maxLength={60} placeholder="e.g. MCB" onChange={(e) => update(r.key, { name: e.target.value })} />
                </label>
                <label className="field">Senders <span className="hint">Commas between; * means “starts with”</span>
                  <input value={r.senders} maxLength={300} placeholder="e.g. MCB*, 6222, 8222" onChange={(e) => update(r.key, { senders: e.target.value })} />
                </label>
                <label className="field">Account digits <span className="hint">Last 4, plus cards</span>
                  <input value={r.account_hint} inputMode="numeric" maxLength={40} placeholder="e.g. 1234, 4321" onChange={(e) => update(r.key, { account_hint: e.target.value.replace(/[^\d, ]/g, "") })} />
                </label>
              </div>
              <div className="bank-checks">
                <Check on={r.auto_import} label="Import alerts automatically" onChange={(v) => update(r.key, { auto_import: v })} />
                <Check on={r.hold_transfers} label="Hold outgoing transfers in Review (to add bank charges)" onChange={(v) => update(r.key, { hold_transfers: v })} />
              </div>
            </div>
          ))}
          {dirty && removing && <div className="alert warn small"><span>Transactions from a removed bank stay, but lose their bank tag.</span></div>}
          <div className="toolbar">
            <button className="btn sm" onClick={() => { setRows([...rows, blank(nextKey())]); setDirty(true); }} disabled={rows.length >= MAX_BANKS}>+ Add a bank</button>
            <button className="btn sm primary" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : dirty ? "Save banks" : "Saved"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
