"use client";
import { useEffect, useState } from "react";
import { MAX_BANKS, type Bank } from "@/lib/banks";
import { apiFetch } from "./api";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";
import { useData } from "./useData";
import type { BankItem, RemovedBankItem } from "./useBanks";
import CloseButton from "./CloseButton";
import { formatDatePkt } from "@/lib/time";

type Row = Bank & { key: number; records?: number };
type Saved = { items: BankItem[]; removed?: RemovedBankItem[] };
const blank = (key: number): Row => ({ key, name: "", senders: "", account_hint: "", auto_import: true, hold_transfers: true, active: true });
const toRows = (items: BankItem[]) => items.map((b, i) => ({ ...b, key: i }));
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

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
  const saved = useData<Saved>("/api/banks");
  const [confirmRemove, setConfirmRemove] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<RemovedBankItem | null>(null);
  const removedBanks = saved.data?.removed ?? [];
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
  const left = (saved.data?.items ?? []).filter((b) => !(rows ?? []).some((r) => r.id === b.id));
  const removing = left.length > 0;
  const keptAside = left.filter((b) => (b.records ?? 0) > 0);
  const drop = (key: number) => { setRows((rs) => rs!.filter((x) => x.key !== key)); setDirty(true); };
  /** A bank with history asks first; an empty or unsaved one goes straight away. */
  const askRemove = (r: Row) => ((r.records ?? 0) > 0 ? setConfirmRemove(r) : drop(r.key));

  async function restore(b: RemovedBankItem) {
    try {
      await apiFetch(`/api/banks/${b.id}`, { method: "POST", body: JSON.stringify({ action: "restore" }) });
      setRows(null); // picks up the restored bank from the reload
      setDirty(false);
      saved.reload();
      onSaved?.();
      toast(`${b.name} restored`, "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function save() {
    setBusy(true);
    try {
      const items = rows!.filter((r) => r.name.trim() || r.senders.trim()).map(({ key: _k, ...b }) => b);
      const res = await apiFetch<Saved>("/api/banks", { method: "PUT", body: JSON.stringify({ items: items.map(({ records: _r, ...b }) => b) }) });
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
                <span className="small muted">
                  Bank {i + 1}
                  {r.active === false && <span className="pill" style={{ marginLeft: 8 }}>Paused</span>}
                  {r.id && (r.records ?? 0) > 0 && <span style={{ marginLeft: 8 }}>{plural(r.records!, "record")}</span>}
                </span>
                <span className="bank-actions">
                  {r.id && (
                    <button className="btn ghost sm" onClick={() => update(r.key, { active: r.active === false })} title={r.active === false ? "Read this bank's alerts again" : "Stop importing this bank's alerts for a while; they wait in Review"}>
                      {r.active === false ? "Resume" : "Pause"}
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={() => askRemove(r)}>Remove</button>
                </span>
              </div>
              {r.active === false && <div className="small muted" style={{ marginBottom: 8 }}>Paused: its alerts wait in Review until you resume it. Its transactions and balance stay as they are.</div>}
              <div className="bank-grid">
                <label className="field">Bank name
                  <input value={r.name} maxLength={60} placeholder="e.g. My Bank" onChange={(e) => update(r.key, { name: e.target.value })} />
                </label>
                <label className="field">Senders <span className="hint">Commas between; * means “starts with”</span>
                  <input value={r.senders} maxLength={300} placeholder="e.g. MYBANK*, 1234" onChange={(e) => update(r.key, { senders: e.target.value })} />
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
          {dirty && removing && (
            <div className="alert warn small">
              <span>
                {keptAside.length > 0
                  ? `${keptAside.map((b) => b.name).join(", ")} will move to Removed banks with ${keptAside.length === 1 ? "its" : "their"} transactions kept, and can be restored. `
                  : ""}
                Save to apply.
              </span>
            </div>
          )}
          <div className="toolbar">
            <button className="btn sm" onClick={() => { setRows([...rows, blank(nextKey())]); setDirty(true); }} disabled={rows.length >= MAX_BANKS}>+ Add a bank</button>
            <button className="btn sm primary" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : dirty ? "Save banks" : "Saved"}</button>
          </div>
          {removedBanks.length > 0 && (
            <div className="removed-banks">
              <div className="set-title" style={{ fontSize: "0.9rem" }}>Removed banks</div>
              <div className="small muted">Hidden from the bank pickers and no longer read from alerts. Their transactions keep the bank&apos;s name.</div>
              {removedBanks.map((b) => (
                <div key={b.id} className="removed-bank">
                  <div>
                    <div>{b.name}{b.account_hint ? <span className="muted"> {b.account_hint.split(/[,\s]+/).filter(Boolean).map((d) => `••${d}`).join(" ")}</span> : null}</div>
                    <div className="small muted">{plural(b.records, "record")} · removed {formatDatePkt(b.archived_at)}</div>
                  </div>
                  <span className="bank-actions">
                    <button className="btn sm" onClick={() => restore(b)} disabled={dirty} title={dirty ? "Save or undo your changes above first" : undefined}>Restore</button>
                    <button className="btn ghost sm danger" onClick={() => setDeleting(b)}>Delete for good</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {confirmRemove && (
        <Confirm
          title={`Remove ${confirmRemove.name || "this bank"}?`}
          onClose={() => setConfirmRemove(null)}
          actions={
            <>
              <button className="btn" onClick={() => { update(confirmRemove.key, { active: false }); setConfirmRemove(null); }}>Pause instead</button>
              <button className="btn primary" onClick={() => { drop(confirmRemove.key); setConfirmRemove(null); }}>Remove</button>
            </>
          }
        >
          <p>{confirmRemove.name} has {plural(confirmRemove.records ?? 0, "record")}. Nothing is deleted: its transactions keep their bank, Mizan stops reading its alerts, and it moves to Removed banks, where you can restore it.</p>
          <p className="small muted">Only need a break from it? Pause it instead: alerts wait in Review and you can resume any time.</p>
        </Confirm>
      )}
      {deleting && <DeleteForGood bank={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); saved.reload(); onSaved?.(); toast(`${deleting.name} deleted`, "ok"); }} />}
    </div>
  );
}

function Confirm({ title, children, actions, onClose }: { title: string; children: React.ReactNode; actions: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="confirm-body">{children}</div>
        <div className="modal-foot">{actions}</div>
      </div>
    </div>
  );
}

/** Deleting a bank with history for good: its name must be typed back first. */
function DeleteForGood({ bank, onClose, onDone }: { bank: RemovedBankItem; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = typed.trim().toLowerCase() === bank.name.trim().toLowerCase();
  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/banks/${bank.id}`, { method: "DELETE", body: JSON.stringify({ confirm: typed }) });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Confirm
      title={`Delete ${bank.name} for good?`}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn danger-solid" onClick={go} disabled={!ok || busy}>{busy ? "Deleting…" : "Delete for good"}</button>
        </>
      }
    >
      <p>This can&apos;t be undone. Its saved balance is deleted. Its {plural(bank.records, "record")} {bank.records === 1 ? "stays" : "stay"} in Mizan, moved to &ldquo;No bank&rdquo;.</p>
      <label className="field"><span>Type <b>{bank.name}</b> to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
      </label>
      {err && <div className="alert error" style={{ marginTop: 12 }} role="alert">{err}</div>}
    </Confirm>
  );
}
