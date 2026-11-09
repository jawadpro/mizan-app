"use client";
import "@/app/spending.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, OWN_ACCOUNTS } from "@/lib/categories";
import { formatPaisa, getDisplayCurrency, paisaToDecimal } from "@/lib/money";
import type { Insights, Tip, TipAction } from "@/lib/insights";
import { apiFetch, ApiError } from "./api";
import { useData } from "./useData";
import { ErrorBox, Skeleton } from "./States";
import { useToast } from "./Toast";
import CloseButton from "./CloseButton";

const rs = (p: number) => formatPaisa(Math.round(p)).replace(/\.\d\d$/, "");
const HIDDEN_KEY = "mizan.tips.hidden";
const SHOW = 3;
/** Fired when tips are hidden or limits change, so the bell can update its count. */
export const TIPS_CHANGED = "mizan:tips-changed";
const changed = () => window.dispatchEvent(new Event(TIPS_CHANGED));

export function readHidden(month: string): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "{}") as { month?: string; ids?: string[] };
    return v.month === month && Array.isArray(v.ids) ? v.ids : [];
  } catch {
    return [];
  }
}
function writeHidden(month: string, ids: string[]) {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify({ month, ids }));
  } catch {
    /* not remembered on this device */
  }
  changed();
}

export type LimitEdit = { category: string; amount: string; existing: boolean };

/** Month-so-far spending check: tips when spending is off track, and monthly category limits. Shown in the bell's panel. */
export default function SpendingCheck({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  const { data, error, loading, reload } = useData<Insights & { ok: true }>("/api/insights");
  const [hidden, setHidden] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<LimitEdit | null>(null);
  const toast = useToast();
  const monthKey = data?.month.from ?? "";
  useEffect(() => {
    if (monthKey) setHidden(readHidden(monthKey));
  }, [monthKey]);

  const monthName = data ? new Date(`${data.month.from}T00:00:00Z`).toLocaleString("en", { month: "long", timeZone: "UTC" }) : "";
  const tips = useMemo(() => (data?.tips ?? []).filter((t) => !hidden.includes(t.id)), [data, hidden]);
  const shown = all ? tips : tips.slice(0, SHOW);
  const hiddenCount = (data?.tips.length ?? 0) - tips.length;

  function hide(id: string) {
    const next = [...hidden, id];
    setHidden(next);
    writeHidden(monthKey, next);
  }
  function unhideAll() {
    setHidden([]);
    writeHidden(monthKey, []);
  }
  const txHref = (category?: string) => {
    const sp = new URLSearchParams({ kind: "expense", from: data!.month.from, to: data!.month.to });
    if (category) sp.set("category", category);
    return `/app/transactions?${sp}`;
  };

  const amountText = (p?: number) => (p ? paisaToDecimal(p).replace(/\.00$/, "") : "");
  function action(a: TipAction) {
    if (a.kind === "transactions") return <Link className="btn sm" href={txHref(a.category)}>{a.label ?? (a.category ? `See ${a.category}` : "See this month's spending")}</Link>;
    if (a.kind === "link") return <Link className="btn sm" href={a.href}>{a.label}</Link>;
    const existing = a.existing != null;
    return (
      <button className={`btn sm${existing ? "" : " primary"}`} onClick={() => setEdit({ category: a.category, amount: amountText(a.existing ?? a.suggested), existing })}>
        {existing ? "Adjust limit" : `Set a ${a.category} limit`}
      </button>
    );
  }

  return (
    <div className="spend-check" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      <div className="card-head">
        <h2 id="spend-title">Spending check{monthName ? ` · ${monthName} so far` : ""}</h2>
        <div className="toolbar">
          <button className="btn sm" onClick={() => setEdit({ category: "", amount: "", existing: false })} disabled={!data}>Add a limit</button>
          {onClose && <CloseButton onClick={onClose} />}
        </div>
      </div>

      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? (
        <div className="grid" style={{ gap: 8 }}><Skeleton h={22} w="60%" /><Skeleton h={16} w="85%" /></div>
      ) : data && (
        <>
          {tips.length === 0 ? (
            <div className="tip ok">
              <div className="tip-body">
                <div className="tip-title">Spending looks on track</div>
                <div className="tip-detail">
                  {rs(data.spent)} spent by day {data.month.day} of {data.month.days}
                  {data.usualSoFar != null ? `, against about ${rs(data.usualSoFar)} by this date usually.` : "."}
                  {data.baselineMonths === 0 && " Tips get sharper once a full month of spending is recorded."}
                  {hiddenCount > 0 && <> <button className="linkish" onClick={unhideAll}>Show {hiddenCount} hidden tip{hiddenCount === 1 ? "" : "s"}</button></>}
                </div>
              </div>
            </div>
          ) : (
            <div className="tips">
              {shown.map((t) => <TipRow key={t.id} t={t} onHide={() => hide(t.id)} action={action} />)}
              {(tips.length > SHOW || hiddenCount > 0) && (
                <div className="tips-more small muted">
                  {tips.length > SHOW && <button className="linkish" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show ${tips.length - SHOW} more`}</button>}
                  {hiddenCount > 0 && <button className="linkish" onClick={unhideAll}>Show {hiddenCount} hidden</button>}
                </div>
              )}
            </div>
          )}

          {data.limits.length > 0 && (
            <div className="limits">
              <div className="limits-title small muted">Monthly limits</div>
              {data.limits.map((l) => {
                const used = l.spent / l.limit;
                const tone = used >= 1 ? "bad" : used >= data.warnAt || (l.projected ?? 0) > l.limit * 1.1 ? "warn" : "ok";
                return (
                  <button key={l.category} className="limit-row" onClick={() => setEdit({ category: l.category, amount: amountText(l.limit), existing: true })} title="Change or remove this limit">
                    <div className="top">
                      <span>{l.category}</span>
                      <span className="num"><span className={tone === "ok" ? "" : `ink-${tone}`}>{rs(l.spent)}</span> <span className="muted">of {rs(l.limit)}</span></span>
                    </div>
                    <div className="progress"><div className={tone} style={{ width: `${Math.min(100, Math.max(2, used * 100))}%` }} /></div>
                  </button>
                );
              })}
            </div>
          )}
          <p className="small muted spend-note">Charity, Zakat and Savings are never counted as overspending. <Link href="/app/settings">Spending check settings</Link></p>
        </>
      )}

      {edit && (
        <LimitModal
          edit={edit}
          taken={data?.limits.map((l) => l.category) ?? []}
          onClose={() => setEdit(null)}
          onSaved={(msg) => {
            setEdit(null);
            toast(msg, "ok");
            reload();
            changed();
          }}
        />
      )}
    </div>
  );
}

function TipRow({ t, onHide, action }: { t: Tip; onHide: () => void; action: (a: TipAction) => React.ReactNode }) {
  return (
    <div className={`tip ${t.tone}`}>
      <div className="tip-body">
        <div className="tip-title">{t.title}</div>
        <div className="tip-detail">{t.detail}</div>
        <div className="tip-actions">
          {t.actions.map((a, i) => <span key={i}>{action(a)}</span>)}
        </div>
      </div>
      <button className="btn ghost sm tip-hide" onClick={onHide} aria-label={`Hide “${t.title}” for this month`} title="Hide for this month">✕</button>
    </div>
  );
}

const LIMIT_CATEGORIES = CATEGORIES.expense.filter((c) => c !== OWN_ACCOUNTS);

export function LimitModal({ edit, taken, onClose, onSaved }: { edit: LimitEdit; taken: string[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [category, setCategory] = useState(edit.category || LIMIT_CATEGORIES.find((c) => !taken.includes(c)) || "");
  const [amount, setAmount] = useState(edit.amount);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const options = Array.from(new Set([...(edit.category ? [edit.category] : []), ...LIMIT_CATEGORIES]));
  const isExisting = taken.includes(category);
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
      await apiFetch("/api/limits", { method: "PUT", body: JSON.stringify({ category, amount }) });
      onSaved(`${category} limit saved`);
    } catch (ex) {
      const a = ex as ApiError;
      setErr(a.fields?.amount?.[0] ?? a.fields?.category?.[0] ?? a.message);
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await apiFetch("/api/limits", { method: "DELETE", body: JSON.stringify({ category }) });
      onSaved(`${category} limit removed`);
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="limit-title" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 id="limit-title">{edit.category ? `${edit.category} monthly limit` : "Monthly spending limit"}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <form onSubmit={submit}>
          {!edit.category && (
            <label className="field">Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {options.map((c) => <option key={c} value={c}>{c}{taken.includes(c) ? " (has a limit)" : ""}</option>)}
              </select>
            </label>
          )}
          <label className="field" style={{ marginTop: edit.category ? 0 : 12 }}>Limit each month ({getDisplayCurrency()})
            <input inputMode="decimal" placeholder="e.g. 15,000" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </label>
          <p className="small muted" style={{ marginTop: 10 }}>
            {edit.existing ? "The spending check warns you as it gets close and again if you go over." : "Suggested from what this category usually costs a month. The spending check warns you as it gets close and again if you go over."}
          </p>
          {err && <div className="alert error" style={{ marginTop: 12 }} role="alert">{err}</div>}
          <div className="modal-foot">
            {isExisting && <button type="button" className="btn danger" onClick={remove} disabled={busy} style={{ marginRight: "auto" }}>Remove limit</button>}
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || !amount.trim() || !category}>{busy ? "Saving…" : "Save limit"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
