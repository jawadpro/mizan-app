"use client";
import { useEffect, useState } from "react";
import { formatPaisa } from "@/lib/money";
import { formatDatePkt, todayPkt } from "@/lib/time";
import { apiFetch, ApiError } from "./api";
import { useData } from "./useData";
import { Empty, ErrorBox, Loading } from "./States";
import TxForm, { draftFrom, type TxDraft } from "./TxForm";
import { useToast } from "./Toast";
import type { SetAside, Tx } from "./types";
import CloseButton from "./CloseButton";

const APPLIES: Record<SetAside["applies_to"], string> = {
  remittance: "every remittance",
  income: "all income",
  incoming: "all money coming in",
};

type Draft = { name: string; percent: string; appliesTo: SetAside["applies_to"]; startsOn: string; endedOn: string | null; purpose: SetAside["purpose"] | null };

const GIVING_NAME = /(allah|charit|sadq|sadaq|zakat|donat|khair|fitr|qurban|masjid|mosque)/i;

function pct(bp: number) {
  return `${(bp / 100).toLocaleString("en", { maximumFractionDigits: 2 })}%`;
}

export default function SetAsides() {
  const { data, error, loading, reload } = useData<{ items: SetAside[] }>("/api/set-asides");
  const [editing, setEditing] = useState<SetAside | "new" | null>(null);
  const [paying, setPaying] = useState<SetAside | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const toast = useToast();
  const items = data?.items ?? [];

  async function remove(f: SetAside) {
    if (!window.confirm(`Delete "${f.name}"? Payments already tagged to it stay in your transactions.`)) return;
    try {
      await apiFetch(`/api/set-asides/${f.id}`, { method: "DELETE" });
      toast("Set-aside deleted", "ok");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function stop(f: SetAside) {
    try {
      await apiFetch(`/api/set-asides/${f.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: f.name, percent: String(f.percent_bp / 100), appliesTo: f.applies_to, startsOn: f.starts_on, endedOn: f.ended_on ? null : todayPkt() }),
      });
      toast(f.ended_on ? "Set-aside resumed" : "Set-aside paused from tomorrow", "ok");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function startFresh(f: SetAside) {
    const over = formatPaisa(-f.remaining);
    const zero = formatPaisa(0).replace(/\.00$/, "");
    const msg = f.purpose === "giving"
      ? `Keep the extra ${over} as a gift? "${f.name}" goes back to ${zero} and your next shares are set aside as normal instead of covering it.`
      : `Forgive the ${over} overspend? "${f.name}" goes back to ${zero} and your next shares are saved as normal instead of covering it.`;
    if (!window.confirm(msg)) return;
    try {
      await apiFetch(`/api/set-asides/${f.id}`, { method: "POST", body: JSON.stringify({ action: "start-fresh" }) });
      toast(`${f.name} starts fresh from ${zero}`, "ok");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function pay(d: TxDraft) {
    await apiFetch("/api/transactions", { method: "POST", body: JSON.stringify(d) });
    setPaying(null);
    toast("Payment recorded", "ok");
    reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Set-asides</h1>
          <p className="muted">Automatically put a share of incoming money aside, for example 10% of remittances for charity or 20% of salary for savings.</p>
        </div>
        <div className="toolbar"><button className="btn primary" onClick={() => setEditing("new")}>+ New set-aside</button></div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? <div className="card"><Loading /></div> : items.length === 0 ? (
        <div className="card">
          <Empty icon="🤲" title="No set-asides yet">
            <p>Create one and Mizan will work out how much to keep aside from every matching payment, including ones imported from SMS.</p>
            <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setEditing("new")}>Create your first set-aside</button>
          </Empty>
        </div>
      ) : (
        <div className="fund-grid">
          {items.map((f) => (
            <div key={f.id} className="card" style={{ opacity: f.ended_on ? 0.8 : 1 }}>
              <div className="card-head" style={{ marginBottom: 6 }}>
                <h2 style={{ fontSize: "1.1rem" }}>{f.name}</h2>
                {f.ended_on ? <span className="pill">Paused</span> : <span className="pill sms">{pct(f.percent_bp)}</span>}
              </div>
              <p className="small muted">
                {pct(f.percent_bp)} of {APPLIES[f.applies_to]} from {formatDatePkt(f.starts_on)}{f.ended_on ? ` to ${formatDatePkt(f.ended_on)}` : ""}
              </p>
              <FundStatus f={f} />
              <div className="toolbar" style={{ marginTop: 14 }}>
                <button className="btn sm primary" onClick={() => setPaying(f)}>Record payment</button>
                {f.remaining < 0 && <button className="btn sm" onClick={() => startFresh(f)}>Start fresh</button>}
                <button className="btn sm" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? "Hide history" : "History"}</button>
                <button className="btn sm" onClick={() => setEditing(f)}>Edit</button>
                <button className="btn sm ghost" onClick={() => stop(f)}>{f.ended_on ? "Resume" : "Pause"}</button>
                <button className="btn sm ghost" onClick={() => remove(f)}>Delete</button>
              </div>
              {open === f.id && <Contributions id={f.id} />}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <SetAsideForm
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast(editing === "new" ? "Set-aside created" : "Set-aside updated", "ok"); reload(); }}
        />
      )}
      {paying && (
        <TxForm
          title={`Pay from ${paying.name}`}
          submitLabel="Record payment"
          initial={{ ...draftFrom({ kind: "expense", category: /charit|sadqa|sadaqah|zakat|donat/i.test(paying.name) ? "Charity" : /sav/i.test(paying.name) ? "Savings" : "Uncategorized" }), setAsideId: paying.id }}
          onSubmit={pay}
          onClose={() => setPaying(null)}
        />
      )}
    </>
  );
}

function FundStatus({ f }: { f: SetAside }) {
  const over = f.remaining < 0 ? -f.remaining : 0;
  const giving = f.purpose === "giving";
  const next = `Your next ${pct(f.percent_bp)}`;
  // Bar: green is what came out of the set-aside, the second colour is anything paid beyond it.
  const covered = f.allocated + f.forgiven;
  const greenPct = over ? (covered / f.used) * 100 : covered ? Math.min(100, (f.used / covered) * 100) : 0;
  return (
    <>
      {over === 0 ? (
        <>
          <div className="fund-amount">{formatPaisa(f.remaining)}</div>
          <div className="small muted">available in this set-aside</div>
        </>
      ) : giving ? (
        <>
          <div className="fund-amount beyond">{formatPaisa(over)}</div>
          <div className="small muted">given beyond what was set aside</div>
        </>
      ) : (
        <>
          <div className="fund-amount over">{formatPaisa(over)} over</div>
          <div className="small muted">spent beyond this set-aside, paid from your main balance</div>
        </>
      )}
      <div className="progress fund-bar" aria-hidden>
        <div style={{ width: `${greenPct}%` }} />
        {over > 0 && <div className={giving ? "beyond" : "over"} style={{ width: `${100 - greenPct}%` }} />}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        {formatPaisa(f.allocated)} set aside from {f.sources} payment{f.sources === 1 ? "" : "s"} · {formatPaisa(f.used)} paid out
        {f.forgiven > 0 && <> · {formatPaisa(f.forgiven)} {giving ? "kept as extra giving" : "forgiven"}</>}
      </div>
      {over > 0 && (
        <p className={`fund-note ${giving ? "beyond" : "over"}`}>
          {giving
            ? <>May Allah accept it. {f.ended_on ? "" : <>{next} will count toward this first. </>}Choose <strong>Start fresh</strong> to keep it as extra giving instead.</>
            : <>{f.ended_on ? "This set-aside is paused, so nothing new will cover it. " : <>{next} will cover this first, then it starts saving again. </>}Choose <strong>Start fresh</strong> to forgive it.</>}
        </p>
      )}
    </>
  );
}

function Contributions({ id }: { id: string }) {
  const { data, error, loading } = useData<{ items: (Tx & { share: number })[] }>(`/api/set-asides/${id}`);
  if (error) return <div style={{ marginTop: 12 }}><ErrorBox message={error} /></div>;
  if (loading && !data) return <div style={{ marginTop: 12 }}><Loading rows={2} /></div>;
  const rows = data?.items ?? [];
  if (!rows.length) return <p className="small muted" style={{ marginTop: 12 }}>No matching payments yet.</p>;
  return (
    <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
      {rows.slice(0, 20).map((t) => (
        <div key={t.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>{formatDatePkt(t.occurred_at)} · {t.counterparty ?? t.category} <span className="muted">({formatPaisa(t.amount_paisa)})</span></span>
          <strong className="num">+{formatPaisa(t.share)}</strong>
        </div>
      ))}
    </div>
  );
}

function SetAsideForm({ initial, onClose, onSaved }: { initial: SetAside | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(() => initial
    ? { name: initial.name, percent: String(initial.percent_bp / 100), appliesTo: initial.applies_to, startsOn: initial.starts_on, endedOn: initial.ended_on, purpose: initial.purpose }
    : { name: "", percent: "10", appliesTo: "remittance", startsOn: todayPkt(), endedOn: null, purpose: null });
  const purpose = d.purpose ?? (GIVING_NAME.test(d.name) ? "giving" : "saving");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setFields({});
    try {
      await apiFetch(initial ? `/api/set-asides/${initial.id}` : "/api/set-asides", { method: initial ? "PATCH" : "POST", body: JSON.stringify({ ...d, purpose }) });
      onSaved();
    } catch (ex) {
      const a = ex as ApiError;
      setErr(a.message);
      setFields(a.fields ?? {});
      setBusy(false);
    }
  }
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sa-title">
        <div className="modal-head">
          <h2 id="sa-title">{initial ? "Edit set-aside" : "New set-aside"}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <label className="field full">Name
              <input maxLength={60} placeholder="e.g. Charity, Savings, Hajj fund" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus required />
              {fields.name && <span className="err">{fields.name[0]}</span>}
            </label>
            <label className="field">Percentage
              <input inputMode="decimal" placeholder="10" value={d.percent} onChange={(e) => setD({ ...d, percent: e.target.value })} required />
              {fields.percent && <span className="err">{fields.percent[0]}</span>}
            </label>
            <label className="field">Of
              <select value={d.appliesTo} onChange={(e) => setD({ ...d, appliesTo: e.target.value as Draft["appliesTo"] })}>
                <option value="remittance">Every remittance</option>
                <option value="income">All income (salary etc.)</option>
                <option value="incoming">All money coming in</option>
              </select>
            </label>
            <label className="field full">What is it for?
              <select value={purpose} onChange={(e) => setD({ ...d, purpose: e.target.value as SetAside["purpose"] })}>
                <option value="giving">Giving (charity, sadaqah, zakat)</option>
                <option value="saving">Saving or spending (a goal, a purchase)</option>
              </select>
              <span className="small muted">Changes how paying more than was set aside is shown.</span>
            </label>
            <label className="field">Starting from
              <input type="date" value={d.startsOn} onChange={(e) => setD({ ...d, startsOn: e.target.value })} required />
              {fields.startsOn && <span className="err">{fields.startsOn[0]}</span>}
            </label>
            <label className="field">Until (optional)
              <input type="date" value={d.endedOn ?? ""} min={d.startsOn} onChange={(e) => setD({ ...d, endedOn: e.target.value || null })} />
              {fields.endedOn && <span className="err">{fields.endedOn[0]}</span>}
            </label>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>Pick an earlier start date to include payments you already received.</p>
          {err && <div className="alert error" style={{ marginTop: 12 }} role="alert">{err}</div>}
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : initial ? "Save changes" : "Create set-aside"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
