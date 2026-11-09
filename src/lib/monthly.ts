// Monthly payments: month arithmetic and spotting which transaction paid an item. No database here.

/** "YYYY-MM" */
export type Month = string;

export function isMonth(s: unknown): s is Month {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && +s.slice(0, 4) >= 2000 && +s.slice(0, 4) <= 2100;
}

export function monthOf(isoDate: string): Month {
  return isoDate.slice(0, 7);
}

export function addMonths(m: Month, n: number): Month {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function daysInMonth(m: Month): number {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** The due date in a month; a due day past the month's end (31 in February) falls on its last day. */
export function dueDate(m: Month, dueDay: number | null): string | null {
  if (!dueDay) return null;
  return `${m}-${String(Math.min(dueDay, daysInMonth(m))).padStart(2, "0")}`;
}

export function monthLabel(m: Month, style: "long" | "short" = "long"): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en", { month: style, year: "numeric", timeZone: "UTC" });
}

export type ItemLike = { name: string; amount_paisa: number | null; category: string; payee: string | null; due_day: number | null };
export type TxLike = { id: string; amount_paisa: number; occurred_at: string; category: string; counterparty: string | null; note: string | null };

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").split(" ").filter((w) => w.length >= 3);

function textHit(needle: string | null, hay: string) {
  if (!needle) return false;
  const n = needle.trim().toLowerCase();
  if (n.length >= 3 && hay.includes(n)) return true;
  const ws = words(n);
  return ws.length > 0 && ws.every((w) => hay.includes(w));
}

/**
 * How likely a transaction is to be this month's payment for an item, 0 to 100.
 * The payee matters most, then the amount, then the category; being near the due date breaks ties.
 */
export function matchScore(item: ItemLike, t: TxLike, month: Month): number {
  const hay = `${t.counterparty ?? ""} ${t.note ?? ""}`.toLowerCase();
  let s = 0;
  const payeeHit = textHit(item.payee, hay);
  const nameHit = textHit(item.name, hay);
  if (payeeHit) s += 45;
  else if (nameHit) s += 30;
  if (item.amount_paisa) {
    const diff = Math.abs(t.amount_paisa - item.amount_paisa) / item.amount_paisa;
    if (diff === 0) s += 35;
    else if (diff <= 0.02) s += 30;
    else if (diff <= 0.1) s += 20;
    else if (diff <= 0.25) s += 8;
  }
  if (t.category === item.category && item.category !== "Uncategorized") s += 15;
  const due = dueDate(month, item.due_day);
  if (due) {
    const days = Math.abs(Date.parse(t.occurred_at) - Date.parse(`${due}T12:00:00+05:00`)) / 86400e3;
    if (days <= 3) s += 5;
    else if (days <= 10) s += 2;
  }
  return Math.min(100, s);
}

/** Good enough to offer as "looks like this one" without the user searching. */
export const SUGGEST_AT = 50;

/** Ranks the candidates for an item, best first, leaving out ones that don't look related at all. */
export function rankMatches<T extends TxLike>(item: ItemLike, txs: T[], month: Month, min = 15): (T & { score: number })[] {
  return txs
    .map((t) => ({ ...t, score: matchScore(item, t, month) }))
    .filter((t) => t.score >= min)
    .sort((a, b) => b.score - a.score || Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}

/**
 * One suggestion per unpaid item, never the same transaction for two items: each transaction goes to
 * the item it fits best.
 */
export function suggestFor<I extends ItemLike & { id: string }, T extends TxLike>(items: I[], txs: T[], month: Month): Map<string, T & { score: number }> {
  const pairs: { item: I; t: T & { score: number } }[] = [];
  for (const item of items) for (const t of rankMatches(item, txs, month, SUGGEST_AT)) pairs.push({ item, t });
  pairs.sort((a, b) => b.t.score - a.t.score);
  const out = new Map<string, T & { score: number }>();
  const used = new Set<string>();
  for (const { item, t } of pairs) {
    if (out.has(item.id) || used.has(t.id)) continue;
    out.set(item.id, t);
    used.add(t.id);
  }
  return out;
}

/**
 * Whether a month's payment is complete: ticked off as fully paid, a bill with no usual amount, or parts
 * adding up to at least 98% of the usual amount (a small shortfall is usually a fee or rounding).
 * The SQL in monthly-repo.ts applies the same rule for the history strip.
 */
export function isComplete(usual: number | null, full: boolean, paidSoFar: number): boolean {
  return full || !usual || paidSoFar * 100 >= usual * 98;
}
