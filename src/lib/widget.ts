// The monthly payments widget: what the Scriptable script on the iPhone shows. Pure, so tests can check it.
// Amounts are sent already formatted in the owner's currency, so the script doesn't need to know about money.
import { formatPaisa } from "./money";
import { dueDate, monthLabel, type Month } from "./monthly";

type Tx = { id: string; amount_paisa: number; occurred_at: string; category: string; counterparty: string | null; note: string | null };
export type WidgetSourceRow = {
  id: string;
  name: string;
  amount_paisa: number | null;
  category: string;
  payee: string | null;
  due_day: number | null;
  paid: number;
  state: "paid" | "partial" | "skipped" | null;
  txs: Tx[];
  suggestion: (Tx & { score: number }) | null;
};

export type WidgetTone = "paid" | "skipped" | "late" | "soon" | "open";

const money = (p: number, currency: string) => formatPaisa(Math.round(p), { currency }).replace(/\.00$/, "");
const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** A transaction's date in Karachi time, YYYY-MM-DD. */
const pktDay = (ts: string) => new Date(Date.parse(ts) + 5 * 3600e3).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

/** The status words under a payment, the same as on the Monthly payments page. */
export function widgetStatus(r: WidgetSourceRow, month: Month, today: string, currency: string): { text: string; tone: WidgetTone } {
  if (r.state === "paid") return { text: "Paid", tone: "paid" };
  if (r.state === "skipped") return { text: "Skipped", tone: "skipped" };
  if (r.state === "partial") return { text: `${money(r.paid, currency)} of ${money(r.amount_paisa ?? 0, currency)} paid`, tone: "soon" };
  const thisMonth = today.slice(0, 7);
  if (month < thisMonth) return { text: "Not paid", tone: "late" };
  if (month > thisMonth) return { text: "Upcoming", tone: "open" };
  const due = dueDate(month, r.due_day);
  if (!due) return { text: "Not paid yet", tone: "open" };
  const n = days(today, due);
  if (n < 0) return { text: `${-n} day${n === -1 ? "" : "s"} late`, tone: "late" };
  if (n === 0) return { text: "Due today", tone: "soon" };
  if (n <= 3) return { text: `Due in ${n} day${n === 1 ? "" : "s"}`, tone: "soon" };
  return { text: `Due ${shortDate(due)}`, tone: "open" };
}

/** A transaction as the script lists it: "Rs 25,000 · 3 Nov · K-Electric". */
export function widgetTx(t: Tx, currency: string) {
  const day = pktDay(t.occurred_at);
  const who = t.counterparty?.trim() || t.note?.trim() || t.category;
  return {
    id: t.id,
    amount: money(t.amount_paisa, currency),
    date: day,
    dateText: shortDate(day),
    title: who.slice(0, 80),
    text: `${money(t.amount_paisa, currency)} · ${shortDate(day)} · ${who.slice(0, 60)}`,
  };
}

/** Still to pay first (late, then by due day), then paid, then skipped. */
function rank(r: WidgetSourceRow) {
  return r.state === "paid" ? 1 : r.state === "skipped" ? 2 : 0;
}

export function widgetView(d: { month: Month; items: WidgetSourceRow[] }, today: string, currency: string, appUrl: string) {
  const items = d.items
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => {
      const st = widgetStatus(r, d.month, today, currency);
      const left = r.amount_paisa ? Math.max(0, r.amount_paisa - r.paid) : 0;
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        amount: r.amount_paisa ? money(r.amount_paisa, currency) : null,
        left: r.state === "partial" && left ? money(left, currency) : null,
        dueDay: r.due_day,
        dueDate: dueDate(d.month, r.due_day),
        state: r.state ?? "open",
        status: st.text,
        tone: st.tone,
        linked: r.txs.map((t) => widgetTx(t, currency)),
        suggestion: r.suggestion ? widgetTx(r.suggestion, currency) : null,
      };
    });
  const open = d.items.filter((r) => r.state === null || r.state === "partial");
  const skipped = d.items.filter((r) => r.state === "skipped").length;
  const leftTotal = open.reduce((a, r) => a + (r.amount_paisa ? Math.max(0, r.amount_paisa - r.paid) : 0), 0);
  const thisMonth = today.slice(0, 7);
  const late = d.month <= thisMonth ? items.filter((i) => i.tone === "late").length : 0;
  return {
    ok: true as const,
    month: d.month,
    monthText: monthLabel(d.month),
    monthShort: monthLabel(d.month, "short").split(" ")[0],
    today,
    summary: {
      paid: d.items.filter((r) => r.state === "paid").length,
      due: d.items.length - skipped,
      open: open.length,
      late,
      left: money(leftTotal, currency),
      unknownLeft: open.filter((r) => !r.amount_paisa).length,
    },
    items,
    appUrl: `${appUrl}/app/monthly`,
  };
}

export type WidgetView = ReturnType<typeof widgetView>;
