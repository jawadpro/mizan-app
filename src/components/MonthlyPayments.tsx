"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { formatPaisa, paisaToDecimal } from "@/lib/money";
import { addMonths, dueDate, monthLabel, type Month } from "@/lib/monthly";
import { formatDatePkt } from "@/lib/time";
import { apiFetch, ApiError } from "./api";
import { useData } from "./useData";
import { Empty, ErrorBox, Loading } from "./States";
import TxForm, { draftFrom, type TxDraft } from "./TxForm";
import { useToast } from "./Toast";
import "@/app/monthly.css";
import CloseButton from "./CloseButton";
import WidgetSetup from "./WidgetSetup";

export type MonthlyTx = { id: string; amount_paisa: number; occurred_at: string; category: string; counterparty: string | null; note: string | null };
export type MonthlyItem = {
  id: string;
  name: string;
  amount_paisa: number | null;
  category: string;
  payee: string | null;
  due_day: number | null;
  starts_month: Month;
  ended_month: Month | null;
};
type Row = MonthlyItem & {
  mark: { status: "paid" | "skipped"; full: boolean; amount_paisa: number | null; note: string | null; marked_at: string } | null;
  /** Every transaction linked for the month: one, or several when it was paid in parts. */
  txs: MonthlyTx[];
  /** Linked transactions plus any part paid outside Mizan. */
  paid: number;
  /** Part paid: the parts don't reach the usual amount yet. */
  state: "paid" | "partial" | "skipped" | null;
  suggestion: (MonthlyTx & { score: number }) | null;
};
export type MonthlyData = {
  today: string;
  month: Month;
  firstMonth: Month | null;
  totalItems: number;
  items: Row[];
  stopped: MonthlyItem[];
  history: { month: Month; due: number; paid: number; skipped: number }[];
};

const whole = (p: number) => formatPaisa(Math.round(p)).replace(/\.00$/, "");
export const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

/** What was paid for a row: its parts, or the usual amount when it was ticked off with no amount. */
export function paidAmount(r: Row): number {
  return r.state === "paid" && r.paid === 0 ? r.amount_paisa ?? 0 : r.paid;
}

/** What is still to pay on a row, when it has a usual amount. */
function remaining(r: Row): number {
  return r.amount_paisa ? Math.max(0, r.amount_paisa - r.paid) : 0;
}

const settled = (r: Row) => r.state === "paid" || r.state === "skipped";

/** Still to pay (including part paid) on top in due order, then paid, then skipped. */
export function sortForList(items: Row[]): Row[] {
  const rank = (r: Row) => (r.state === "paid" ? 1 : r.state === "skipped" ? 2 : 0);
  return items.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

export function summarize(d: MonthlyData) {
  const paid = d.items.filter((r) => r.state === "paid");
  const skipped = d.items.filter((r) => r.state === "skipped");
  const open = d.items.filter((r) => r.state === null || r.state === "partial");
  const due = d.items.length - skipped.length;
  return {
    paid: paid.length,
    due,
    open,
    paidTotal: d.items.reduce((a, r) => a + (r.state === "skipped" ? 0 : paidAmount(r)), 0),
    leftTotal: open.reduce((a, r) => a + remaining(r), 0),
    unknownLeft: open.filter((r) => !r.amount_paisa).length,
  };
}

function status(r: Row, d: MonthlyData): { text: string; tone: "paid" | "skipped" | "late" | "soon" | "open" } {
  if (r.state === "paid") return { text: "Paid", tone: "paid" };
  if (r.state === "skipped") return { text: "Skipped", tone: "skipped" };
  if (r.state === "partial") return { text: `${whole(r.paid)} of ${whole(r.amount_paisa ?? 0)} paid`, tone: "soon" };
  const thisMonth = d.today.slice(0, 7);
  if (d.month < thisMonth) return { text: "Not paid", tone: "late" };
  if (d.month > thisMonth) return { text: "Upcoming", tone: "open" };
  const due = dueDate(d.month, r.due_day);
  if (!due) return { text: "Not paid yet", tone: "open" };
  const n = daysBetween(d.today, due);
  if (n < 0) return { text: `${-n} day${n === -1 ? "" : "s"} late`, tone: "late" };
  if (n === 0) return { text: "Due today", tone: "soon" };
  if (n <= 3) return { text: `Due in ${n} day${n === 1 ? "" : "s"}`, tone: "soon" };
  return { text: `Due ${shortDate(due)}`, tone: "open" };
}

export default function MonthlyPayments() {
  const [month, setMonth] = useState<Month | null>(null);
  const { data, error, loading, reload } = useData<MonthlyData>(`/api/monthly${month ? `?month=${month}` : ""}`);
  const [editing, setEditing] = useState<MonthlyItem | "new" | null>(null);
  const [paying, setPaying] = useState<Row | null>(null);
  const [widget, setWidget] = useState(false);
  const toast = useToast();
  const cur = data?.month ?? month;
  const thisMonth = data?.today.slice(0, 7);
  const canBack = !!(data && data.firstMonth && data.month > data.firstMonth);
  const canNext = !!(data && thisMonth && data.month < addMonths(thisMonth, 1));

  async function mark(r: Row, body: Record<string, unknown>, msg: string) {
    try {
      await apiFetch(`/api/monthly/${r.id}/mark`, { method: "PUT", body: JSON.stringify({ month: data!.month, ...body }) });
      toast(msg, "ok");
      setPaying(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function unmark(r: Row) {
    try {
      await apiFetch(`/api/monthly/${r.id}/mark`, { method: "DELETE", body: JSON.stringify({ month: data!.month }) });
      toast(`${r.name} is back to not paid`, "ok");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function action(item: MonthlyItem, body: Record<string, unknown>, msg: string) {
    try {
      await apiFetch(`/api/monthly/${item.id}`, { method: "POST", body: JSON.stringify(body) });
      toast(msg, "ok");
      setEditing(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function remove(item: MonthlyItem) {
    if (!window.confirm(`Delete "${item.name}" and its history? To keep past months, choose "Stop" instead.`)) return;
    try {
      await apiFetch(`/api/monthly/${item.id}`, { method: "DELETE" });
      toast(`${item.name} deleted`, "ok");
      setEditing(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const s = data ? summarize(data) : null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Monthly payments</h1>
          <p className="muted">Rent, bills, school fees: everything you pay every month, as a checklist that starts fresh each month.</p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => setWidget(true)}>Home Screen widget</button>
          <button className="btn primary" onClick={() => setEditing("new")}>+ Add payment</button>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? <div className="card"><Loading /></div> : data && data.totalItems === 0 ? (
        <div className="card">
          <Empty icon="🗓️" title="No monthly payments yet">
            <p>Add the things you pay every month. Each month you get a fresh checklist, can link each one to the transaction that paid it, and can look back at any past month.</p>
            <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setEditing("new")}>Add your first payment</button>
          </Empty>
        </div>
      ) : data && s && (
        <>
          <div className="card mp-head">
            <div className="mp-month">
              <button className="btn sm ghost" onClick={() => setMonth(addMonths(data.month, -1))} disabled={!canBack} aria-label="Previous month">‹</button>
              <h2>{monthLabel(data.month)}</h2>
              <button className="btn sm ghost" onClick={() => setMonth(addMonths(data.month, 1))} disabled={!canNext} aria-label="Next month">›</button>
              {data.month !== thisMonth && <button className="btn sm" onClick={() => setMonth(thisMonth!)}>This month</button>}
            </div>
            {data.items.length > 0 && (
              <>
                <div className="mp-count">
                  <strong className="num">{s.paid}</strong> of <strong className="num">{s.due}</strong> paid
                  {s.paid === s.due && s.due > 0 && <span className="pill income" style={{ marginLeft: 8 }}>All done</span>}
                </div>
                <div className="progress" aria-hidden><div style={{ width: `${s.due ? (s.paid / s.due) * 100 : 100}%` }} /></div>
                <div className="small muted mp-totals">
                  <span>{whole(s.paidTotal)} paid</span>
                  {s.open.length > 0 && (
                    <span>
                      {s.leftTotal > 0 ? `${whole(s.leftTotal)} still to pay` : "Still to pay"}
                      {s.unknownLeft > 0 && ` ${s.leftTotal > 0 ? "+ " : ""}${s.unknownLeft} bill${s.unknownLeft === 1 ? "" : "s"} that change${s.unknownLeft === 1 ? "s" : ""}`}
                    </span>
                  )}
                </div>
              </>
            )}
            {data.history.length > 1 && (
              <div className="mp-history" aria-label="Recent months">
                {data.history.map((h) => {
                  const due = h.due - h.skipped;
                  return (
                    <button key={h.month} className={`mp-hist${h.month === data.month ? " on" : ""}${h.paid >= due ? " done" : ""}`} onClick={() => setMonth(h.month)} title={`${monthLabel(h.month)}: ${h.paid} of ${due} paid`}>
                      <span>{monthLabel(h.month, "short").replace(/ \d{4}$/, "")}</span>
                      <span className="num">{h.paid}/{due}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {data.items.length === 0 ? (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing was on the list in {monthLabel(data.month)}.</p></div>
          ) : (
            <div className="card mp-list">
              {sortForList(data.items).map((r, i, list) => (
                <Fragment key={r.id}>
                  {settled(r) && (i === 0 || !settled(list[i - 1])) && (
                    <div className="mp-divider small muted">Done this month ({list.length - i})</div>
                  )}
                  <ItemRow r={r} d={data} onPay={() => setPaying(r)} onUnmark={() => unmark(r)} onEdit={() => setEditing(r)}
                    onLink={(t) => mark(r, { status: "paid", transactionId: t.id }, `${r.name}: payment linked`)} />
                </Fragment>
              ))}
            </div>
          )}

          {data.stopped.length > 0 && (
            <details className="card mp-stopped">
              <summary className="small muted">Stopped ({data.stopped.length})</summary>
              {data.stopped.map((it) => (
                <div key={it.id} className="mp-stopped-row">
                  <span>{it.name} <span className="small muted">· last month {monthLabel(it.ended_month!, "short")}</span></span>
                  <span className="toolbar">
                    <button className="btn sm" onClick={() => action(it, { action: "resume" }, `${it.name} is back on the list`)}>Put back</button>
                    <button className="btn sm ghost" onClick={() => setEditing(it)}>Edit</button>
                  </span>
                </div>
              ))}
            </details>
          )}
        </>
      )}

      {editing && cur && (
        <ItemForm
          initial={editing === "new" ? null : editing}
          month={cur}
          startMonth={thisMonth && thisMonth > cur ? thisMonth : cur}
          onClose={() => setEditing(null)}
          onSaved={() => { toast(editing === "new" ? "Payment added" : "Payment updated", "ok"); setEditing(null); reload(); }}
          onStop={editing !== "new" ? () => action(editing, { action: "stop", lastMonth: cur }, `${editing.name} stops after ${monthLabel(cur)}`) : undefined}
          onDelete={editing !== "new" ? () => remove(editing) : undefined}
        />
      )}
      {widget && <WidgetSetup onClose={() => setWidget(false)} />}
      {paying && data && (
        <PayDialog r={paying} d={data} onClose={() => setPaying(null)} onMark={(body, msg) => mark(paying, body, msg)} onReload={reload} />
      )}
    </>
  );
}

function ItemRow({ r, d, onPay, onUnmark, onEdit, onLink }: { r: Row; d: MonthlyData; onPay: () => void; onUnmark: () => void; onEdit: () => void; onLink: (t: MonthlyTx) => void }) {
  const st = status(r, d);
  const due = dueDate(d.month, r.due_day);
  const done = r.state === "paid";
  const settled = r.state === "paid" || r.state === "skipped";
  return (
    <div className={`mp-row ${st.tone}`}>
      <button className={`mp-check${done ? " on" : ""}${r.state === "skipped" ? " skip" : ""}${r.state === "partial" ? " part" : ""}`} onClick={settled ? onUnmark : onPay}
        aria-label={settled ? `Undo: ${r.name} is ${r.state}` : `Mark ${r.name} as paid`} title={settled ? "Undo" : "Mark as paid"}>
        {done ? "✓" : r.state === "skipped" ? "–" : r.state === "partial" ? "½" : ""}
      </button>
      <div className="mp-main">
        <div className="mp-line">
          <span className="mp-name">{r.name}</span>
          <span className={`mp-status ${st.tone}`}>{st.text}</span>
        </div>
        <div className="small muted">
          {r.amount_paisa ? whole(r.amount_paisa) : "Amount changes"}
          {due && ` · due ${shortDate(due)}`}
          {` · ${r.category}`}
        </div>
        {(r.state === "paid" || r.state === "partial") && <Parts r={r} />}
        {r.state === "partial" && r.amount_paisa && <div className="small muted">{whole(remaining(r))} still to pay</div>}
        {r.state === "skipped" && r.mark?.note && <div className="small muted">{r.mark.note}</div>}
        {(r.state === null || r.state === "partial") && r.suggestion && (
          <div className="mp-suggest small">
            <span>{r.state === "partial" ? "Next part looks paid" : "Looks paid"}: {whole(r.suggestion.amount_paisa)}{r.suggestion.counterparty ? ` to ${r.suggestion.counterparty}` : ""} on {formatDatePkt(r.suggestion.occurred_at)}</span>
            <button className="btn sm primary" onClick={() => onLink(r.suggestion!)}>Link it</button>
          </div>
        )}
      </div>
      <div className="mp-actions">
        {r.state === "partial" ? (
          <button className="btn sm" onClick={onPay}>Add payment</button>
        ) : r.mark ? (
          <button className="btn sm ghost" onClick={onPay}>Change</button>
        ) : (
          <button className="btn sm" onClick={onPay}>Mark paid</button>
        )}
        <button className="btn sm ghost" onClick={onEdit} aria-label={`Edit ${r.name}`}>Edit</button>
      </div>
    </div>
  );
}

/** The payments that settled a row: each linked transaction, and a part paid outside Mizan. */
function Parts({ r, onRemove }: { r: Row; onRemove?: (t: MonthlyTx) => void }) {
  const cash = r.mark?.amount_paisa;
  if (!r.txs.length && !cash) {
    return <div className="small mp-paid">Marked paid without a transaction{r.mark?.note ? `: ${r.mark.note}` : ""}</div>;
  }
  return (
    <div className="mp-parts">
      {r.txs.map((t) => (
        <div key={t.id} className="small mp-paid mp-part">
          <span>Paid {whole(t.amount_paisa)}{t.counterparty ? ` to ${t.counterparty}` : ""} on {formatDatePkt(t.occurred_at)}</span>
          {onRemove && <button type="button" className="btn sm ghost" onClick={() => onRemove(t)} aria-label={`Unlink ${whole(t.amount_paisa)} on ${formatDatePkt(t.occurred_at)}`}>Unlink</button>}
        </div>
      ))}
      {!!cash && <div className="small mp-paid">Paid {whole(cash)} without a transaction{r.mark?.note ? `: ${r.mark.note}` : ""}</div>}
    </div>
  );
}

type PayTab = "link" | "new" | "outside";

function PayDialog({ r, d, onClose, onMark, onReload }: { r: Row; d: MonthlyData; onClose: () => void; onMark: (body: Record<string, unknown>, msg: string) => Promise<void>; onReload: () => void }) {
  const [tab, setTab] = useState<PayTab>("link");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const left = r.state === "partial" ? remaining(r) : r.amount_paisa ?? 0;
  const [amount, setAmount] = useState(r.mark?.amount_paisa ? paisaToDecimal(r.mark.amount_paisa) : left ? paisaToDecimal(left) : "");
  const [note, setNote] = useState(r.mark?.note ?? "");
  const [recording, setRecording] = useState(false);
  const toast = useToast();
  const matches = useData<{ items: (MonthlyTx & { score: number })[] }>(tab === "link" ? `/api/monthly/${r.id}?month=${d.month}${search ? `&q=${encodeURIComponent(search)}` : ""}` : null);
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !recording && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording]);

  async function record(t: TxDraft) {
    const res = await apiFetch<{ item: { id: string } }>("/api/transactions", { method: "POST", body: JSON.stringify(t) });
    try {
      await apiFetch(`/api/monthly/${r.id}/mark`, { method: "PUT", body: JSON.stringify({ month: d.month, status: "paid", transactionId: res.item.id }) });
      toast(`${r.name}: payment recorded and linked`, "ok");
    } catch {
      toast("The payment was saved, but it could not be ticked off. Try linking it.", "error");
    }
    onReload();
    onClose();
  }

  if (recording) {
    const thisMonth = d.today.slice(0, 7);
    // In the month being viewed: today, or the due date (else the last day) for another month.
    const day = d.month === thisMonth ? null : dueDate(d.month, r.due_day ?? 31);
    return (
      <TxForm
        title={`Pay ${r.name}`}
        submitLabel="Save and mark paid"
        initial={draftFrom({
          kind: "expense",
          amount_paisa: left || null,
          category: r.category,
          counterparty: r.payee ?? r.name,
          note: `${r.name}, ${monthLabel(d.month)}`,
          occurred_at: day ? `${day}T12:00:00+05:00` : null,
        })}
        onSubmit={record}
        onClose={() => setRecording(false)}
      />
    );
  }

  const items = matches.data?.items ?? [];
  async function unlink(t: MonthlyTx) {
    try {
      await apiFetch(`/api/monthly/${r.id}/mark`, { method: "DELETE", body: JSON.stringify({ month: d.month, transactionId: t.id }) });
      toast(`Unlinked ${whole(t.amount_paisa)} from ${r.name}`, "ok");
      onReload();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const hasParts = r.txs.length > 0 || !!r.mark?.amount_paisa;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mp-pay-title">
        <div className="modal-head">
          <div>
            <h2 id="mp-pay-title">{r.name}</h2>
            <div className="small muted">{monthLabel(d.month)}{r.amount_paisa ? ` · usually ${whole(r.amount_paisa)}` : ""}</div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        {hasParts && r.state !== "skipped" && (
          <div className="mp-sofar">
            <div className="mp-sofar-head">
              <strong className="small">Paid so far: {whole(r.paid)}</strong>
              {r.state === "partial" && <span className="small muted">{whole(left)} still to pay</span>}
            </div>
            <Parts r={r} onRemove={unlink} />
            {r.state === "partial" && (
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => onMark({ status: "paid", full: true }, `${r.name} marked as fully paid`)}>Mark as fully paid</button>
            )}
            <p className="small muted" style={{ margin: "10px 0 0" }}>{r.state === "partial" ? "Add the next part below." : "Paid in more than one part? Add another below."}</p>
          </div>
        )}
        <div className="seg mp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "link"} className={tab === "link" ? "on" : ""} onClick={() => setTab("link")}>Pick a transaction</button>
          <button role="tab" aria-selected={tab === "new"} className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>Record new</button>
          <button role="tab" aria-selected={tab === "outside"} className={tab === "outside" ? "on" : ""} onClick={() => setTab("outside")}>No transaction</button>
        </div>

        {tab === "link" && (
          <>
            <input className="mp-search" type="search" placeholder={`Search ${monthLabel(d.month, "short")} by name, note or amount`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
            {matches.error ? <ErrorBox message={matches.error} onRetry={matches.reload} /> : matches.loading && !matches.data ? <Loading rows={3} /> : items.length === 0 ? (
              <p className="small muted">{search ? `No spending in ${monthLabel(d.month)} matches that search.` : `No spending found in ${monthLabel(d.month)}. Record it as a new payment instead.`}</p>
            ) : (
              <>
              {!search && items[0].score < 50 && <p className="small muted" style={{ marginTop: 0 }}>Nothing looks like {r.name} yet, so here is all spending in {monthLabel(d.month)}. Search, or record it as new.</p>}
              <div className="mp-cands">
                {items.map((t) => (
                  <button key={t.id} className="mp-cand" onClick={() => onMark({ status: "paid", transactionId: t.id }, hasParts ? `Payment added to ${r.name}` : `${r.name}: payment linked`)}>
                    <span className="mp-cand-main">
                      <span>{t.counterparty ?? t.category}{t.score >= 50 && <span className="pill income" style={{ marginLeft: 6 }}>Likely</span>}</span>
                      <span className="small muted">{formatDatePkt(t.occurred_at)} · {t.category}{t.note ? ` · ${t.note}` : ""}</span>
                    </span>
                    <span className="num">{whole(t.amount_paisa)}</span>
                  </button>
                ))}
              </div>
              </>
            )}
          </>
        )}

        {tab === "new" && (
          <div className="mp-pane">
            <p className="small muted">Adds the payment to your transactions and links it to {r.name} for {monthLabel(d.month)}. Use this when it was not picked up from a bank message.</p>
            <button className="btn primary" onClick={() => setRecording(true)}>Record the payment</button>
          </div>
        )}

        {tab === "outside" && (
          <form className="mp-pane" onSubmit={(e) => { e.preventDefault(); onMark({ status: "paid", full: true, amount: amount || null, note: note || null }, `${r.name} marked as paid`); }}>
            <p className="small muted">For {hasParts ? "the rest, if it was" : "a payment"} made in cash or from an account Mizan doesn&apos;t track. It won&apos;t change your balance or spending, and ticks {r.name} off as fully paid.</p>
            <div className="form-grid">
              <label className="field">Amount (optional)
                <input inputMode="decimal" placeholder="e.g. 85,000" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="field">Note (optional)
                <input maxLength={200} placeholder="e.g. Paid in cash" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}><button type="submit" className="btn primary">Mark as paid</button></div>
          </form>
        )}

        <div className="modal-foot mp-foot">
          {r.mark?.status !== "skipped" && (
            <button type="button" className="btn ghost" onClick={() => onMark({ status: "skipped", note: null }, `${r.name} skipped for ${monthLabel(d.month)}`)}>Skip this month</button>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

type Draft = { name: string; amount: string; category: string; payee: string; dueDay: string; startsMonth: string; endedMonth: string };

function ItemForm({ initial, month, startMonth, onClose, onSaved, onStop, onDelete }: { initial: MonthlyItem | null; month: Month; startMonth: Month; onClose: () => void; onSaved: () => void; onStop?: () => void; onDelete?: () => void }) {
  const [d, setD] = useState<Draft>(() => initial
    ? { name: initial.name, amount: initial.amount_paisa ? paisaToDecimal(initial.amount_paisa) : "", category: initial.category, payee: initial.payee ?? "", dueDay: initial.due_day ? String(initial.due_day) : "", startsMonth: initial.starts_month, endedMonth: initial.ended_month ?? "" }
    : { name: "", amount: "", category: "Rent", payee: "", dueDay: "", startsMonth: startMonth, endedMonth: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const set = (k: keyof Draft, v: string) => setD((x) => ({ ...x, [k]: v }));
  const cats = Array.from(new Set([...CATEGORIES.expense, d.category]));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Guess the category from the name while it hasn't been picked by hand.
  const [catTouched, setCatTouched] = useState(!!initial);
  function onName(v: string) {
    setD((x) => ({ ...x, name: v, category: catTouched ? x.category : guessCategory(v) ?? x.category }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setFields({});
    try {
      await apiFetch(initial ? `/api/monthly/${initial.id}` : "/api/monthly", {
        method: initial ? "PATCH" : "POST",
        body: JSON.stringify({ ...d, amount: d.amount || null, dueDay: d.dueDay ? Number(d.dueDay) : null, endedMonth: d.endedMonth || null, payee: d.payee || null }),
      });
      onSaved();
    } catch (ex) {
      const a = ex as ApiError;
      setErr(a.message);
      setFields(a.fields ?? {});
      setBusy(false);
    }
  }
  const stopped = !!initial?.ended_month;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mp-item-title">
        <div className="modal-head">
          <h2 id="mp-item-title">{initial ? "Edit monthly payment" : "Add a monthly payment"}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <label className="field full">Name
              <input maxLength={60} placeholder="e.g. Rent, Electricity, School fees" value={d.name} onChange={(e) => onName(e.target.value)} autoFocus required />
              {fields.name && <span className="err">{fields.name[0]}</span>}
            </label>
            <label className="field">Usual amount
              <input inputMode="decimal" placeholder="Leave empty if it changes" value={d.amount} onChange={(e) => set("amount", e.target.value)} />
              {fields.amount && <span className="err">{fields.amount[0]}</span>}
            </label>
            <label className="field">Due on
              <select value={d.dueDay} onChange={(e) => set("dueDay", e.target.value)}>
                <option value="">No set day</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{ordinal(n)} of the month</option>)}
              </select>
            </label>
            <label className="field">Category
              <select value={d.category} onChange={(e) => { setCatTouched(true); set("category", e.target.value); }}>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">Paid to (optional)
              <input maxLength={120} placeholder="e.g. Landlord, K-Electric" value={d.payee} onChange={(e) => set("payee", e.target.value)} />
            </label>
            <label className="field">First month
              <input type="month" value={d.startsMonth} onChange={(e) => set("startsMonth", e.target.value)} required />
              {fields.startsMonth && <span className="err">{fields.startsMonth[0]}</span>}
            </label>
            <label className="field">Last month (optional)
              <input type="month" value={d.endedMonth} min={d.startsMonth} onChange={(e) => set("endedMonth", e.target.value)} />
              {fields.endedMonth && <span className="err">{fields.endedMonth[0]}</span>}
            </label>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>The name, who it&apos;s paid to and the amount help Mizan spot the payment among your transactions.</p>
          {err && <div className="alert error" style={{ marginTop: 12 }} role="alert">{err}</div>}
          <div className="modal-foot mp-foot">
            {onDelete && <button type="button" className="btn ghost danger" onClick={onDelete}>Delete</button>}
            {onStop && !stopped && <button type="button" className="btn ghost" onClick={onStop} title={`Keeps it up to ${monthLabel(month)} and its history`}>Stop after {monthLabel(month, "short")}</button>}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : initial ? "Save changes" : "Add payment"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

function guessCategory(name: string): string | null {
  const n = name.toLowerCase();
  if (/rent|kiraya|landlord/.test(n)) return "Rent";
  if (/school|fee|tuition|universit|college|academy|madrasa/.test(n)) return "Education";
  if (/electric|k-?electric|lesco|iesco|gas|ssgc|sngpl|water|internet|ptcl|wifi|bill|mobile|phone|nayatel|stormfiber/.test(n)) return "Utilities";
  if (/gym|netflix|spotify|youtube|subscription/.test(n)) return "Entertainment";
  if (/insurance|doctor|medic|pharma/.test(n)) return "Health";
  if (/committee|bc\b|saving/.test(n)) return "Savings";
  if (/sadaq|charity|donation/.test(n)) return "Charity";
  if (/fuel|petrol|car|van|transport/.test(n)) return "Transport";
  return null;
}
