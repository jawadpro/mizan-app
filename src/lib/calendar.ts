// Date maths for the calendar view. Every date here is a Karachi calendar day as "YYYY-MM-DD";
// weeks start on Monday.
import { addDays, dateToPktLocal } from "./time";

export type CalView = "day" | "week" | "month";

const pad = (n: number) => String(n).padStart(2, "0");

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/** The days shown for a view, first to last. A month always shows six full weeks, like Google Calendar. */
export function visibleDays(view: CalView, anchor: string): string[] {
  if (view === "day") return [anchor];
  const start = view === "week" ? startOfWeek(anchor) : startOfWeek(startOfMonth(anchor));
  const n = view === "week" ? 7 : 42;
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

export function shift(view: CalView, anchor: string, dir: 1 | -1): string {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  return addMonths(anchor, dir);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function dayNum(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function shortDate(iso: string): string {
  return `${dayNum(iso)} ${SHORT[Number(iso.slice(5, 7)) - 1]}`;
}

export function longDate(iso: string): string {
  return `${LONG_DAYS[weekdayIndex(iso)]}, ${dayNum(iso)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** The heading for the period on screen, e.g. "November 2026", "3 – 9 Nov 2026", "2 Nov – 8 Dec 2026". */
export function periodTitle(view: CalView, anchor: string): string {
  const y = anchor.slice(0, 4);
  if (view === "month") return `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${y}`;
  if (view === "day") return longDate(anchor);
  const days = visibleDays("week", anchor);
  const a = days[0], b = days[6];
  if (a.slice(0, 7) === b.slice(0, 7)) return `${dayNum(a)} – ${dayNum(b)} ${SHORT[Number(a.slice(5, 7)) - 1]} ${b.slice(0, 4)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${shortDate(a)} – ${shortDate(b)} ${b.slice(0, 4)}`;
  return `${shortDate(a)} ${a.slice(0, 4)} – ${shortDate(b)} ${b.slice(0, 4)}`;
}

/** Karachi day and minutes past midnight for a stored timestamp. */
export function pktParts(occurredAt: string): { day: string; minutes: number } {
  const local = dateToPktLocal(occurredAt);
  return { day: local.slice(0, 10), minutes: Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)) };
}

/**
 * Places point-in-time events on a day's time grid. Each event gets a visual length of `span`
 * minutes; events that would overlap sit side by side, Google Calendar style.
 * Returns, in input order, the column each event takes and how many columns its cluster has.
 */
export function layoutDay(minutes: number[], span = 30): { col: number; cols: number }[] {
  const order = minutes.map((m, i) => ({ m, i })).sort((a, b) => a.m - b.m || a.i - b.i);
  const out: { col: number; cols: number }[] = new Array(minutes.length);
  let cluster: { i: number; col: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = colEnds.length;
    for (const c of cluster) out[c.i] = { col: c.col, cols };
    cluster = [];
    colEnds = [];
  };
  for (const { m, i } of order) {
    if (m >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= m);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(0);
    }
    colEnds[col] = m + span;
    cluster.push({ i, col });
    clusterEnd = Math.max(clusterEnd, m + span);
  }
  flush();
  return out;
}
