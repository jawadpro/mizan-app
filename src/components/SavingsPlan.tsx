"use client";
import "@/app/spending.css";
import "@/app/savings.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatPaisa, getDisplayCurrency, paisaToDecimal } from "@/lib/money";
import { addMonths, monthLabel } from "@/lib/monthly";
import type { SavingsPlan as Plan, SavingsTip, SavingsTipAction } from "@/lib/savings";
import { apiFetch, ApiError } from "./api";
import { useData } from "./useData";
import { Empty, ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";
import CloseButton from "./CloseButton";
import { LimitModal, TIPS_CHANGED, type LimitEdit } from "./SpendingCheck";

const rs = (p: number) => formatPaisa(Math.round(p)).replace(/\.\d\d$/, "");
const signed = (p: number) => (p < 0 ? `−${rs(-p)}` : rs(p));
const SHOW = 4;

export type SavingsData = Plan & { ok: true };

/** How much can be saved each month, how this month is going, and tips for saving more. */
export default function SavingsPlan() {
  const { data, error, loading, reload } = useData<SavingsData>("/api/savings");
  const limits = useData<{ items: { category: string }[] }>("/api/limits");
  const [editTarget, setEditTarget] = useState(false);
  const [limit, setLimit] = useState<LimitEdit | null>(null);
  const [all, setAll] = useState(false);
  const toast = useToast();

  const head = (
    <div className="page-head">
      <div>
        <h1>Savings plan</h1>
        <p className="muted">How much you can realistically save each month, worked out from your own income and spending.</p>
      </div>
      {data?.ready && <div className="toolbar"><button className="btn" onClick={() => setEditTarget(true)}>{data.targetIsOwn ? "Change target" : "Set my own target"}</button></div>}
    </div>
  );

  if (error) return <>{head}<ErrorBox message={error} onRetry={reload} /></>;
  if (loading && !data) return <>{head}<div className="card"><Loading /></div></>;
  if (!data) return head;
  if (!data.ready) {
    return (
      <>
        {head}
        <div className="card">
          <Empty icon="🌱" title="Not enough history yet">
            <p>The plan needs at least one full month of income and spending. Once this month is recorded, you&apos;ll see how much you can save and where to find it.</p>
          </Empty>
        </div>
      </>
    );
  }

  const p = data;
  const month = p.today.slice(0, 7);
  const histFrom = `${p.history[0].month}-01`;
  const txHref = (a: Extract<SavingsTipAction, { kind: "transactions" }>) => {
    const sp = new URLSearchParams({ kind: "expense", from: histFrom, to: p.today });
    if (a.category) sp.set("category", a.category);
    return `/app/transactions?${sp}`;
  };
  const taken = limits.data?.items.map((l) => l.category) ?? [];
  const action = (a: SavingsTipAction) => {
    if (a.kind === "transactions") return <Link className="btn sm" href={txHref(a)}>{a.label ?? `See ${a.category}`}</Link>;
    if (a.kind === "link") return <Link className="btn sm" href={a.href}>{a.label}</Link>;
    const has = taken.includes(a.category);
    return (
      <button className="btn sm" onClick={() => setLimit({ category: a.category, amount: paisaToDecimal(a.suggested).replace(/\.00$/, ""), existing: has })}>
        {has ? "Adjust limit" : "Set a limit"}
      </button>
    );
  };

  const tm = p.thisMonth;
  const left = tm.days - tm.day;
  const progress = p.target > 0 ? Math.max(0, Math.min(1, tm.savedSoFar / p.target)) : 0;
  const onTrack = tm.projected >= p.target;
  const shown = all ? p.tips : p.tips.slice(0, SHOW);
  const maxHist = Math.max(1, ...p.history.map((h) => Math.max(h.income, h.spend)));

  return (
    <>
      {head}
      <div className="sv-grid">
        <section className="card balance-hero sv-hero">
          <div className="small muted">You can realistically save</div>
          <div className="sv-big num">{rs(p.suggested)}<span className="sv-per"> a month</span></div>
          <p className="small sv-why">
            {p.suggested > 0 ? (
              <>From your last {p.monthsUsed === 1 ? "month" : `${p.monthsUsed} months`}: {p.uneven ? "a careful income figure" : "usual income"} of {rs(p.planIncome)}, usual spending of {rs(p.usual.spend)}, plus the cuts suggested below, with 5% kept back for surprises.</>
            ) : (
              <>A usual month costs {rs(p.usual.spend)} against {rs(p.usual.income)} coming in, so there is nothing spare yet. The tips below show where to start.</>
            )}
            {p.rule20 > 0 && p.suggested < p.rule20 && <> A common goal is 20% of income, about {rs(p.rule20)}; the tips help close the gap.</>}
          </p>
          {p.target > 0 && (
            <>
              <div className="sv-target">
                <span>{p.targetIsOwn ? "Your target" : "Target"}: <strong className="num">{rs(p.target)}</strong> a month</span>
                <button className="linkish small" onClick={() => setEditTarget(true)}>{p.targetIsOwn ? "Change" : "Set your own"}</button>
              </div>
              <div className="sv-ahead">
                {[3, 6, 12].map((k) => (
                  <div key={k} className="sv-chip">
                    <span className="small muted">By {monthLabel(addMonths(month, k), "short")}</span>
                    <span className="num">{rs(p.target * k)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card sv-month">
          <div className="card-head"><h2>{monthLabel(month, "long").replace(/ \d{4}$/, "")} so far</h2><span className="small muted">Day {tm.day} of {tm.days}</span></div>
          <div className="sv-row"><span className="muted">Came in</span><span className="num">{rs(tm.income)}</span></div>
          <div className="sv-row"><span className="muted">Spent</span><span className="num">{rs(tm.spend)}</span></div>
          <div className="sv-row strong"><span>Left over</span><span className={`num${tm.savedSoFar < 0 ? " ink-bad" : ""}`}>{signed(tm.savedSoFar)}</span></div>
          {p.target > 0 && (
            <>
              <div className="progress" aria-label={`${Math.round(progress * 100)}% of the target`}><div className={onTrack ? "" : "warn"} style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>
              <p className="small sv-status">
                {tm.income === 0 ? (
                  <>Nothing has come in yet this month. When about {rs(p.planIncome)} arrives, keep spending under {rs(Math.max(0, p.planIncome - p.target - tm.spend))} to save {rs(p.target)}.</>
                ) : p.target <= tm.savedSoFar && left === 0 ? (
                  <span className="ink-ok">Target met this month.</span>
                ) : tm.roomLeft >= 0 ? (
                  <>
                    <span className={onTrack ? "ink-ok" : "ink-warn"}>{onTrack ? "On track" : "Behind"}</span>{" "}
                    {left > 0
                      ? <>To save {rs(p.target)} this month, keep the rest of your spending under {rs(tm.roomLeft)}{left > 1 ? `, about ${rs(tm.roomLeft / left)} a day` : ""}.</>
                      : <>Month ends with {rs(tm.savedSoFar)} left over.</>}
                    {" "}At your usual pace the month ends near {signed(tm.projected)} left over.
                  </>
                ) : (
                  <><span className="ink-bad">Out of reach this month</span> by {rs(-tm.roomLeft)}. Saving whatever is left still counts; next month starts fresh.</>
                )}
              </p>
            </>
          )}
        </section>
      </div>

      <section className="card sv-tips">
        <div className="card-head"><h2>Ways to save more</h2>{p.tips.some((t) => t.monthly) && <span className="small muted">Amounts are per month</span>}</div>
        {p.tips.length === 0 ? (
          <div className="tip ok"><div className="tip-body"><div className="tip-title">Nothing stands out</div><div className="tip-detail">Your spending is steady and nothing is creeping up. Keep putting the target aside as money comes in.</div></div></div>
        ) : (
          <div className="tips">
            {shown.map((t) => <TipRow key={t.id} t={t} action={action} />)}
            {p.tips.length > SHOW && (
              <div className="tips-more small muted"><button className="linkish" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show ${p.tips.length - SHOW} more`}</button></div>
            )}
          </div>
        )}
      </section>

      <div className="sv-grid">
        <section className="card">
          <div className="card-head"><h2>Recent months</h2></div>
          <div className="sv-hist">
            {p.history.map((h) => (
              <div key={h.month} className="sv-hist-row">
                <span className="sv-hist-m">{monthLabel(h.month, "short")}</span>
                <div className="sv-bars" aria-hidden>
                  <div className="sv-bar in" style={{ width: `${(h.income / maxHist) * 100}%` }} />
                  <div className="sv-bar out" style={{ width: `${(h.spend / maxHist) * 100}%` }} />
                </div>
                <span className={`num sv-hist-v${h.saved < 0 ? " ink-bad" : " ink-ok"}`} title={`In ${rs(h.income)}, spent ${rs(h.spend)}`}>{signed(h.saved)}</span>
              </div>
            ))}
          </div>
          <p className="small muted sv-legend"><span className="sv-key in" /> Came in <span className="sv-key out" /> Spent · the figure is what was left over. Money moved to Savings counts as saved.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>A usual month</h2><span className="small muted">{rs(p.usual.spend)} spent</span></div>
          <div className="sv-cats">
            {p.categories.slice(0, 8).map((c) => (
              <div key={c.category} className="sv-row">
                <span>{c.category} {c.fixed && <span className="sv-tag">fixed</span>}</span>
                <span className="num">{rs(c.usual)}</span>
              </div>
            ))}
          </div>
          {p.recurringTotal > 0 && <p className="small muted" style={{ marginBottom: 0 }}>Monthly payments: {rs(p.recurringTotal)}. <Link href="/app/monthly">Open the list</Link></p>}
        </section>
      </div>

      <p className="small muted spend-note">Worked out on your own records only; nothing is sent anywhere. Fixed costs (rent, bills, school, health, tax, giving) are never counted as cuts.</p>

      {editTarget && (
        <TargetModal
          plan={p}
          onClose={() => setEditTarget(false)}
          onSaved={(msg) => {
            setEditTarget(false);
            toast(msg, "ok");
            reload();
          }}
        />
      )}
      {limit && (
        <LimitModal
          edit={limit}
          taken={taken}
          onClose={() => setLimit(null)}
          onSaved={(msg) => {
            setLimit(null);
            toast(msg, "ok");
            limits.reload();
            window.dispatchEvent(new Event(TIPS_CHANGED));
          }}
        />
      )}
    </>
  );
}

function TipRow({ t, action }: { t: SavingsTip; action: (a: SavingsTipAction) => React.ReactNode }) {
  return (
    <div className={`tip ${t.tone}`}>
      <div className="tip-body">
        <div className="tip-title">{t.title}{t.monthly ? <span className="sv-save num">save ~{rs(t.monthly)}</span> : null}</div>
        <div className="tip-detail">{t.detail}</div>
        <div className="tip-actions">{t.actions.map((a, i) => <span key={i}>{action(a)}</span>)}</div>
      </div>
    </div>
  );
}

function TargetModal({ plan, onClose, onSaved }: { plan: Extract<Plan, { ready: true }>; onClose: () => void; onSaved: (msg: string) => void }) {
  const [amount, setAmount] = useState(plan.targetIsOwn ? paisaToDecimal(plan.target).replace(/\.00$/, "") : paisaToDecimal(plan.suggested).replace(/\.00$/, ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(target: string, msg: string) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/savings", { method: "PUT", body: JSON.stringify({ target }) });
      onSaved(msg);
    } catch (ex) {
      const a = ex as ApiError;
      setErr(a.fields?.target?.[0] ?? a.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="target-title" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 id="target-title">Monthly savings target</h2>
          <CloseButton onClick={onClose} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save(amount, "Savings target saved"); }}>
          <label className="field">Save each month ({getDisplayCurrency()})
            <input inputMode="decimal" placeholder="e.g. 25,000" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </label>
          <p className="small muted" style={{ marginTop: 10 }}>
            The plan suggests {rs(plan.suggested)} from your recent months. A higher target is fine; the page shows each month how much spending room it leaves.
          </p>
          {err && <div className="alert error" style={{ marginTop: 12 }} role="alert">{err}</div>}
          <div className="modal-foot">
            {plan.targetIsOwn && <button type="button" className="btn" onClick={() => save("", "Back to the suggested amount")} disabled={busy} style={{ marginRight: "auto" }}>Use suggestion</button>}
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || !amount.trim()}>{busy ? "Saving…" : "Save target"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
