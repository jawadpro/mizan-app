"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KIND_LABEL, KINDS, OWN_ACCOUNTS, type Kind } from "@/lib/categories";
import { formatPaisa } from "@/lib/money";
import { formatTimePkt, todayPkt } from "@/lib/time";
import {
  WEEKDAYS, dayNum, layoutDay, longDate, periodTitle, pktParts, shift, shortDate, visibleDays, weekdayIndex, type CalView,
} from "@/lib/calendar";
import { apiFetch, resourceUrl, type Space } from "./api";
import { ErrorBox } from "./States";
import TxForm, { draftFrom, type TxDraft } from "./TxForm";
import { useChargesEdit } from "./ChargesField";
import { useToast } from "./Toast";
import type { Tx } from "./types";
import "@/app/calendar.css";
import CloseButton from "./CloseButton";

type Page = { items: Tx[]; total: number };
type Ev = Tx & { day: string; minutes: number };

const HOUR_PX = 48;
const VIEWS: { id: CalView; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];
const VIEW_KEY = "mizan:calendar-view";

/** "Rs 1,250" when there are no paisa, else the full amount. */
const rs = (p: number) => formatPaisa(p).replace(/\.00$/, "");
const sign = (k: Kind) => (k === "expense" ? "−" : "+");
const titleOf = (t: Tx) => t.counterparty || t.category;
const hourLabel = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);

/** Loads every transaction between two Karachi days, page by page. */
function useRange(space: Space, from: string, to: string, kind: string) {
  const [items, setItems] = useState<Ev[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const all: Tx[] = [];
      for (let page = 1; page <= 50; page++) {
        const d = await apiFetch<Page>(resourceUrl(space, "transactions", { from, to, kind, page, pageSize: 200 }));
        all.push(...d.items);
        if (all.length >= d.total || d.items.length === 0) break;
      }
      if (n !== seq.current) return;
      setItems(all.map((t) => ({ ...t, ...pktParts(t.occurred_at) })).sort((a, b) => a.minutes - b.minutes));
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [space, from, to, kind]);
  useEffect(() => {
    load();
  }, [load]);
  return { items, error, loading, reload: load };
}

function Chip({ ev, onOpen, showTime }: { ev: Ev; onOpen: (e: Ev) => void; showTime?: boolean }) {
  return (
    <button
      type="button"
      className={`cal-chip ${ev.kind}`}
      onClick={(e) => { e.stopPropagation(); onOpen(ev); }}
      title={`${formatTimePkt(ev.occurred_at)} · ${titleOf(ev)} · ${ev.category} · ${sign(ev.kind)}${rs(ev.amount_paisa)}`}
    >
      {showTime && <span className="cal-chip-time">{formatTimePkt(ev.occurred_at)}</span>}
      <span className="cal-chip-amt">{sign(ev.kind)}{rs(ev.amount_paisa)}</span>
      <span className="cal-chip-short">{sign(ev.kind)}{formatPaisa(ev.amount_paisa, { compact: true, symbol: false })}</span>
      <span className="cal-chip-title">{titleOf(ev)}</span>
    </button>
  );
}

export default function Calendar({ space }: { space: Space }) {
  const toast = useToast();
  const today = todayPkt();
  const [view, setView] = useState<CalView>("month");
  const [anchor, setAnchor] = useState(today);
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<Ev | null>(null);
  const [editing, setEditing] = useState<Tx | "new" | null>(null);
  const [newDay, setNewDay] = useState<string | null>(null);
  const chargesEdit = useChargesEdit();
  const readOnly = space === "demo";

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "day" || v === "week" || v === "month") setView(v);
    } catch { /* storage blocked */ }
  }, []);
  const pickView = (v: CalView) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ }
  };
  const goDay = (d: string) => { setAnchor(d); pickView("day"); };

  const days = useMemo(() => visibleDays(view, anchor), [view, anchor]);
  const { items, error, loading, reload } = useRange(space, days[0], days[days.length - 1], kind);

  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of items ?? []) {
      const list = m.get(e.day);
      if (list) list.push(e);
      else m.set(e.day, [e]);
    }
    return m;
  }, [items]);

  // Totals for the period on screen; in month view only the month itself, not the spill-over days.
  const sums = useMemo(() => {
    const s = { expense: 0, income: 0, remittance: 0 };
    const month = anchor.slice(0, 7);
    for (const e of items ?? []) {
      if (e.category === OWN_ACCOUNTS) continue;
      if (view === "month" && e.day.slice(0, 7) !== month) continue;
      s[e.kind] += e.amount_paisa;
    }
    return s;
  }, [items, view, anchor]);

  const spentOn = (d: string) => (byDay.get(d) ?? []).reduce((a, e) => (e.kind === "expense" && e.category !== OWN_ACCOUNTS ? a + e.amount_paisa : a), 0);

  // Keyboard: ← → move, T today, D/W/M switch view (ignored while typing or a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || editing || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") setAnchor((a) => shift(view, a, -1));
      else if (e.key === "ArrowRight") setAnchor((a) => shift(view, a, 1));
      else if (e.key === "t" || e.key === "T") setAnchor(todayPkt());
      else if (e.key === "d") pickView("day");
      else if (e.key === "w") pickView("week");
      else if (e.key === "m") pickView("month");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, open, editing]);

  // Swipe left/right on phones to move between periods.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setAnchor((a) => shift(view, a, dx < 0 ? 1 : -1));
  };

  async function save(d: TxDraft, id?: string) {
    const chargesNote = id ? chargesEdit.toastFor(d) : null;
    await apiFetch(id ? `/api/transactions/${id}` : "/api/transactions", { method: id ? "PATCH" : "POST", body: JSON.stringify(id ? chargesEdit.body(d) : d) });
    setEditing(null);
    toast(chargesNote ?? (id ? "Transaction updated" : "Transaction added"), "ok");
    reload();
  }
  async function destroy(id: string) {
    await apiFetch(`/api/transactions/${id}`, { method: "DELETE" });
    setEditing(null);
    toast("Moved to the recycle bin", "ok");
    reload();
  }
  async function remove(t: Tx) {
    if (!window.confirm(`Delete ${formatPaisa(t.amount_paisa)} ${t.counterparty ? `to ${t.counterparty}` : ""}? It goes to the recycle bin, where you can restore it for 30 days.`)) return;
    try {
      await apiFetch(`/api/transactions/${t.id}`, { method: "DELETE" });
      setOpen(null);
      toast("Moved to the recycle bin", "ok");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const addOn = (d: string | null) => {
    if (readOnly) return;
    chargesEdit.start("new");
    setNewDay(d);
    setEditing("new");
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="muted cal-sub">Every transaction on the day it happened. Tap one to see or edit it.</p>
        </div>
        <div className="toolbar">
          <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          {readOnly ? (
            <button className="btn primary" disabled title="The demo is read-only.">+ Add transaction</button>
          ) : (
            <button className="btn primary" onClick={() => addOn(view === "day" ? anchor : null)}>+ Add transaction</button>
          )}
        </div>
      </div>

      <div className="card cal-card">
        <div className="cal-bar">
          <div className="cal-nav">
            <button className="btn sm" onClick={() => setAnchor(today)} disabled={days.includes(today) && (view !== "month" || anchor.slice(0, 7) === today.slice(0, 7))}>Today</button>
            <button className="icon-btn cal-arrow" onClick={() => setAnchor((a) => shift(view, a, -1))} aria-label={`Previous ${view}`}>‹</button>
            <button className="icon-btn cal-arrow" onClick={() => setAnchor((a) => shift(view, a, 1))} aria-label={`Next ${view}`}>›</button>
            <h2 className="cal-title" aria-live="polite">
              {view === "day" ? <><span className="cal-title-long">{periodTitle(view, anchor)}</span><span className="cal-title-short">{WEEKDAYS[weekdayIndex(anchor)]}, {shortDate(anchor)} {anchor.slice(0, 4)}</span></> : periodTitle(view, anchor)}
            </h2>
          </div>
          <div className="seg" role="tablist" aria-label="Calendar view">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? "on" : ""} onClick={() => pickView(v.id)}>{v.label}</button>
            ))}
          </div>
        </div>
        <div className="cal-sums small muted">
          {kind !== "income" && kind !== "remittance" && <span><span className="amt expense">{rs(sums.expense)}</span> spent</span>}
          {kind !== "expense" && kind !== "remittance" && (sums.income > 0 || kind === "income") && <span><span className="amt income">{rs(sums.income)}</span> income</span>}
          {kind !== "expense" && kind !== "income" && (sums.remittance > 0 || kind === "remittance") && <span><span className="amt remittance">{rs(sums.remittance)}</span> remittances</span>}
          {loading && <span className="cal-loading">Loading…</span>}
        </div>

        {error ? <ErrorBox message={error} onRetry={reload} /> : (
          <div className={`cal-body${loading && items ? " busy" : ""}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {view === "month" ? (
              <MonthGrid days={days} anchor={anchor} today={today} byDay={byDay} spentOn={spentOn} onOpen={setOpen} onDay={goDay} />
            ) : (
              <TimeGrid days={days} today={today} byDay={byDay} spentOn={spentOn} onOpen={setOpen} onDay={goDay} single={view === "day"} />
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className="modal cal-detail" role="dialog" aria-modal="true" aria-labelledby="cal-detail-title">
            <div className="modal-head">
              <h2 id="cal-detail-title"><span className={`cal-dot ${open.kind}`} aria-hidden />{titleOf(open)}</h2>
              <CloseButton onClick={() => setOpen(null)} />
            </div>
            <div className={`cal-detail-amt amt ${open.kind}`}>{sign(open.kind)}{formatPaisa(open.amount_paisa)}</div>
            <dl className="cal-detail-list">
              <dt>When</dt><dd>{longDate(open.day)} · {formatTimePkt(open.occurred_at)}</dd>
              <dt>Category</dt><dd>{open.category} <span className={`pill ${open.kind}`}>{KIND_LABEL[open.kind]}</span></dd>
              {open.note && <><dt>Note</dt><dd>{open.note}</dd></>}
              <dt>Source</dt><dd>{open.source === "sms" ? `Bank SMS${open.account_hint ? ` · account ending ${open.account_hint}` : ""}` : open.source === "demo" ? "Demo" : "Added by hand"}</dd>
            </dl>
            {!readOnly && (
              <div className="modal-foot">
                <button className="btn danger" onClick={() => remove(open)}>Delete</button>
                <button className="btn primary" onClick={() => { chargesEdit.start(open); setEditing(open); setOpen(null); }}>Edit</button>
              </div>
            )}
          </div>
        </div>
      )}

      {editing && (
        <TxForm
          title={editing === "new" ? "Add transaction" : "Edit transaction"}
          submitLabel={editing === "new" ? "Add transaction" : "Save changes"}
          initial={editing === "new" ? { ...draftFrom(), ...(newDay && newDay !== today ? { occurredAt: `${newDay}T12:00` } : {}) } : draftFrom(editing)}
          onClose={() => setEditing(null)}
          onSubmit={(d) => save(d, editing === "new" ? undefined : editing.id)}
          onDelete={editing === "new" ? undefined : () => destroy(editing.id)}
          extra={editing === "new" ? undefined : (d, fieldErrors) =>
            d.kind === "expense" && d.category !== "Bank charges" && d.category !== "Tax deducted" && (
              chargesEdit.field(d, fieldErrors.charges?.[0])
            )
          }
        />
      )}
    </>
  );
}

type GridProps = {
  days: string[];
  today: string;
  byDay: Map<string, Ev[]>;
  spentOn: (d: string) => number;
  onOpen: (e: Ev) => void;
  onDay: (d: string) => void;
};

function MonthGrid({ days, anchor, today, byDay, spentOn, onOpen, onDay }: GridProps & { anchor: string }) {
  const month = anchor.slice(0, 7);
  const MAX = 3;
  return (
    <div className="cal-month" role="grid" aria-label={periodTitle("month", anchor)}>
      <div className="cal-month-head" role="row">
        {WEEKDAYS.map((w) => <div key={w} role="columnheader">{w}</div>)}
      </div>
      <div className="cal-month-cells">
        {days.map((d) => {
          const evs = byDay.get(d) ?? [];
          const spent = spentOn(d);
          const extra = evs.length - MAX;
          return (
            <div
              key={d}
              role="gridcell"
              className={`cal-cell${d.slice(0, 7) !== month ? " out" : ""}${d === today ? " today" : ""}${weekdayIndex(d) >= 5 ? " weekend" : ""}`}
              onClick={() => onDay(d)}
            >
              <div className="cal-cell-top">
                <button type="button" className="cal-daynum" onClick={(e) => { e.stopPropagation(); onDay(d); }} aria-label={`${longDate(d)}, ${evs.length} transaction${evs.length === 1 ? "" : "s"}`}>
                  {dayNum(d) === 1 ? shortDate(d) : dayNum(d)}
                </button>
                {spent > 0 && <span className="cal-cell-total">−{formatPaisa(spent, { compact: true, symbol: false })}</span>}
              </div>
              <div className="cal-cell-evs">
                {evs.slice(0, extra > 0 ? MAX - 1 : MAX).map((e) => <Chip key={e.id} ev={e} onOpen={onOpen} />)}
                {extra > 0 && (
                  <button type="button" className="cal-more" onClick={(e) => { e.stopPropagation(); onDay(d); }}>+{extra + 1} more</button>
                )}
              </div>
              {evs.length > 0 && (
                <div className="cal-dots" aria-hidden>
                  {evs.slice(0, 4).map((e) => <span key={e.id} className={`cal-dot ${e.kind}`} />)}
                  {evs.length > 4 && <span className="cal-dots-more">+{evs.length - 4}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({ days, today, byDay, spentOn, onOpen, onDay, single }: GridProps & { single: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const first = Math.min(...days.flatMap((d) => (byDay.get(d) ?? []).map((e) => e.minutes)), 8 * 60);
  const key = days[0] + days.length;
  // Open each period scrolled to its first transaction (or 8 AM), not midnight.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (first / 60 - 0.5) * HOUR_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, first === 8 * 60]);
  const [now, setNow] = useState(() => pktParts(new Date().toISOString()));
  useEffect(() => {
    const t = setInterval(() => setNow(pktParts(new Date().toISOString())), 60_000);
    return () => clearInterval(t);
  }, []);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className={`cal-time${single ? " single" : ""}`}>
      <div className="cal-time-head" style={{ gridTemplateColumns: `var(--gutter) repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => {
          const spent = spentOn(d);
          const n = (byDay.get(d) ?? []).length;
          return (
            <button type="button" key={d} className={`cal-col-head${d === today ? " today" : ""}`} onClick={() => onDay(d)} disabled={single}>
              <span className="cal-col-wd">{WEEKDAYS[weekdayIndex(d)]}</span>
              <span className="cal-col-num">{dayNum(d)}</span>
              <span className="cal-col-total">{spent > 0 ? `−${formatPaisa(spent, { compact: true, symbol: false })}` : single && n === 0 ? "No transactions" : " "}</span>
            </button>
          );
        })}
      </div>
      <div className="cal-time-scroll" ref={scroller}>
        <div className="cal-time-grid" style={{ gridTemplateColumns: `var(--gutter) repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
          <div className="cal-gutter">
            {hours.map((h) => <div key={h} className="cal-hour-label" style={{ top: h * HOUR_PX }}>{h === 0 ? "" : hourLabel(h)}</div>)}
          </div>
          {days.map((d) => {
            const evs = byDay.get(d) ?? [];
            const place = layoutDay(evs.map((e) => e.minutes), single ? 40 : 30);
            return (
              <div key={d} className={`cal-col${d === today ? " today" : ""}`}>
                {hours.map((h) => <div key={h} className="cal-hour-line" style={{ top: h * HOUR_PX }} />)}
                {evs.map((e, i) => {
                  const { col, cols } = place[i];
                  return (
                    <div
                      key={e.id}
                      className="cal-ev"
                      style={{ top: (e.minutes / 60) * HOUR_PX, left: `calc(${(col / cols) * 100}% + 1px)`, width: `calc(${100 / cols}% - 3px)` }}
                    >
                      <Chip ev={e} onOpen={onOpen} showTime={single} />
                    </div>
                  );
                })}
                {d === now.day && <div className="cal-now" style={{ top: (now.minutes / 60) * HOUR_PX }} aria-hidden />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
