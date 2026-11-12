"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, todayPkt } from "@/lib/time";
import "@/app/daterange.css";

type Range = { from: string; to: string };
type Preset = { id: string; label: string; range: () => Range };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function parts(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
}

function presets(): Preset[] {
  const today = todayPkt();
  const { y, m } = parts(today);
  return [
    { id: "today", label: "Today", range: () => ({ from: today, to: today }) },
    { id: "yesterday", label: "Yesterday", range: () => ({ from: addDays(today, -1), to: addDays(today, -1) }) },
    { id: "7d", label: "Last 7 days", range: () => ({ from: addDays(today, -6), to: today }) },
    { id: "30d", label: "Last 30 days", range: () => ({ from: addDays(today, -29), to: today }) },
    { id: "month", label: "This month", range: () => ({ from: `${y}-${pad(m + 1)}-01`, to: today }) },
    { id: "lastMonth", label: "Last month", range: () => ({ from: iso(y, m - 1, 1), to: iso(y, m, 0) }) },
    { id: "3m", label: "Last 3 months", range: () => ({ from: iso(y, m - 2, 1), to: today }) },
    { id: "year", label: "This year", range: () => ({ from: `${y}-01-01`, to: today }) },
    { id: "lastYear", label: "Last year", range: () => ({ from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }) },
  ];
}

function fmt(s: string, withYear = true) {
  const { y, m, d } = parts(s);
  return `${d} ${MONTHS[m]}${withYear ? ` ${y}` : ""}`;
}

/** Short human label for a range: a preset's name when it matches one, otherwise the dates. */
export function rangeLabel(from: string, to: string): string {
  if (!from && !to) return "Any date";
  const hit = from && to ? presets().find((p) => { const r = p.range(); return r.from === from && r.to === to; }) : undefined;
  if (hit) return hit.label;
  if (from && !to) return `From ${fmt(from)}`;
  if (!from && to) return `Until ${fmt(to)}`;
  if (from === to) return fmt(from);
  const sameYear = parts(from).y === parts(to).y;
  return `${fmt(from, !sameYear)} – ${fmt(to)}`;
}

function Month({ y, m, from, to, hover, today, onPick, onHover }: {
  y: number; m: number; from: string; to: string; hover: string; today: string;
  onPick: (d: string) => void; onHover: (d: string) => void;
}) {
  const first = new Date(Date.UTC(y, m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  // While choosing the end, preview the range up to the hovered day.
  const end = to || (from && hover && hover >= from ? hover : "");
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(y, m, i + 1))];
  while (cells.length % 7) cells.push(null);
  return (
    <div className="drp-month">
      <div className="drp-weekdays">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
      <div className="drp-grid" onMouseLeave={() => onHover("")}>
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const isStart = d === from;
          const isEnd = d === end;
          const inRange = !!from && !!end && d > from && d < end;
          const future = d > today;
          const cls = ["drp-day", isStart && "start", isEnd && "end", inRange && "in", d === today && "today", future && "future", !to && end && "preview"].filter(Boolean).join(" ");
          return (
            <button key={d} type="button" className={cls} onClick={() => onPick(d)} onMouseEnter={() => onHover(d)} aria-label={fmt(d)} aria-pressed={isStart || isEnd || inRange}>
              {parts(d).d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Range>({ from, to });
  const [hover, setHover] = useState("");
  const today = todayPkt();
  const [view, setView] = useState(() => { const p = parts(to || from || today); return { y: p.y, m: p.m }; });
  const [twoUp, setTwoUp] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const list = useMemo(presets, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setDraft({ from, to });
    // Show the month of the range's end on the right, so the start sits on the left.
    const p = parts(to || from || today);
    const mq = window.matchMedia("(min-width: 700px)").matches;
    setTwoUp(mq);
    const back = mq ? 1 : 0;
    const d = new Date(Date.UTC(p.y, p.m - back, 1));
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    const close = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (r: Range) => { onChange(r.from, r.to); setOpen(false); };
  const pick = (d: string) => {
    if (!draft.from || draft.to || d < draft.from) setDraft({ from: d, to: "" });
    else setDraft({ from: draft.from, to: d });
  };
  const shift = (n: number) => { const d = new Date(Date.UTC(view.y, view.m + n, 1)); setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() }); };
  const second = (() => { const d = new Date(Date.UTC(view.y, view.m + 1, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; })();
  const active = !!(from || to);
  const activePreset = list.find((p) => { const r = p.range(); return r.from === draft.from && r.to === draft.to; })?.id;

  return (
    <div className="drp" ref={root}>
      <button type="button" className={`drp-trigger${active ? " on" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label="Date range">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>
        <span>{rangeLabel(from, to)}</span>
        <svg className="drp-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {active && (
        <button type="button" className="drp-clear" aria-label="Clear dates" title="Clear dates" onClick={() => onChange("", "")}>×</button>
      )}
      {open && <div className="drp-back" onClick={() => setOpen(false)} aria-hidden />}
      {open && (
        <div className="drp-pop" role="dialog" aria-label="Choose a date range">
          <div className="drp-presets">
            {list.map((p) => (
              <button key={p.id} type="button" className={activePreset === p.id ? "on" : ""} onClick={() => apply(p.range())}>{p.label}</button>
            ))}
            <button type="button" className={!draft.from && !draft.to ? "on" : ""} onClick={() => apply({ from: "", to: "" })}>Any date</button>
          </div>
          <div className="drp-cal">
            <div className="drp-nav">
              <button type="button" className="drp-arrow" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
              <div className="drp-titles">
                <span>{MONTHS_LONG[view.m]} {view.y}</span>
                {twoUp && <span>{MONTHS_LONG[second.m]} {second.y}</span>}
              </div>
              <button type="button" className="drp-arrow" onClick={() => shift(1)} aria-label="Next month">›</button>
            </div>
            <div className="drp-months">
              <Month {...view} from={draft.from} to={draft.to} hover={hover} today={today} onPick={pick} onHover={setHover} />
              {twoUp && <Month {...second} from={draft.from} to={draft.to} hover={hover} today={today} onPick={pick} onHover={setHover} />}
            </div>
            <div className="drp-foot">
              <span className="drp-sel">
                {draft.from ? (
                  <>
                    <b>{fmt(draft.from)}</b> → <b className={draft.to ? "" : "muted"}>{draft.to ? fmt(draft.to) : "pick end date"}</b>
                  </>
                ) : <span className="muted">Pick a start date</span>}
              </span>
              <span className="drp-actions">
                <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="btn primary sm" disabled={!draft.from} onClick={() => apply({ from: draft.from, to: draft.to || draft.from })}>Apply</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
