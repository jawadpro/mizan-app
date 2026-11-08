import "server-only";
import { q } from "./db";
import { rankMatches, suggestFor, type Month } from "./monthly";
import type { MonthlyItemInput, MonthlyMarkInput } from "./validation";

export type MonthlyItemRow = {
  id: string;
  name: string;
  amount_paisa: number | null;
  category: string;
  payee: string | null;
  due_day: number | null;
  starts_month: Month;
  ended_month: Month | null;
};
export type LinkedTx = { id: string; amount_paisa: number; occurred_at: string; category: string; counterparty: string | null; note: string | null };
export type MonthlyMark = { status: "paid" | "skipped"; transaction_id: string | null; amount_paisa: number | null; note: string | null; marked_at: string };

const ITEM_COLS = (a = "") => `${a}id, ${a}name, ${a}amount_paisa::float8 AS amount_paisa, ${a}category, ${a}payee, ${a}due_day,
  to_char(${a}starts_month, 'YYYY-MM') AS starts_month, to_char(${a}ended_month, 'YYYY-MM') AS ended_month`;
const TX_COLS = (a = "") => `${a}id, ${a}amount_paisa::float8 AS amount_paisa, ${a}occurred_at, ${a}category, ${a}counterparty, ${a}note`;
const first = (m: Month) => `${m}-01`;

/** The checklist for one month: every item active in it, how it was settled, and a likely payment for the rest. */
export async function monthlyList(month: Month, today: string) {
  const { rows } = await q<MonthlyItemRow & { mark: MonthlyMark | null; tx: LinkedTx | null }>(
    `SELECT ${ITEM_COLS("i.")},
            CASE WHEN m.item_id IS NULL THEN NULL ELSE json_build_object(
              'status', m.status, 'transaction_id', m.transaction_id, 'amount_paisa', m.amount_paisa::float8,
              'note', m.note, 'marked_at', m.marked_at) END AS mark,
            CASE WHEN t.id IS NULL THEN NULL ELSE json_build_object(
              'id', t.id, 'amount_paisa', t.amount_paisa::float8, 'occurred_at', t.occurred_at, 'category', t.category,
              'counterparty', t.counterparty, 'note', t.note) END AS tx
     FROM app.monthly_items i
     LEFT JOIN app.monthly_marks m ON m.item_id = i.id AND m.month = $1::date
     LEFT JOIN app.transactions t ON t.id = m.transaction_id
     WHERE (i.starts_month <= $1::date AND (i.ended_month IS NULL OR i.ended_month >= $1::date)) OR m.item_id IS NOT NULL
     ORDER BY i.due_day NULLS LAST, i.position, lower(i.name)`,
    [first(month)],
  );
  const open = rows.filter((r) => !r.mark);
  const suggestions = new Map<string, LinkedTx & { score: number }>();
  // Look for payments only in months that have started.
  if (open.length && first(month) <= today) {
    const cands = await candidates(month, 5);
    for (const [k, v] of suggestFor(open, cands, month)) suggestions.set(k, v);
  }
  const [{ rows: bounds }, { rows: stopped }, { rows: history }] = await Promise.all([
    q<{ first_month: Month | null; n: number }>(`SELECT to_char(min(starts_month), 'YYYY-MM') AS first_month, count(*)::int AS n FROM app.monthly_items`),
    // Items that ended before this month, so they can be put back.
    q<MonthlyItemRow>(
      `SELECT ${ITEM_COLS()} FROM app.monthly_items WHERE ended_month < $1::date
         AND NOT EXISTS (SELECT 1 FROM app.monthly_marks m WHERE m.item_id = monthly_items.id AND m.month = $1::date)
       ORDER BY ended_month DESC, lower(name)`,
      [first(month)],
    ),
    // How the six months up to this one went, for the history strip.
    q<{ month: Month; due: number; paid: number; skipped: number }>(
      `SELECT to_char(g.m, 'YYYY-MM') AS month,
              (SELECT count(*) FROM app.monthly_items i
                WHERE (i.starts_month <= g.m AND (i.ended_month IS NULL OR i.ended_month >= g.m))
                   OR EXISTS (SELECT 1 FROM app.monthly_marks k WHERE k.item_id = i.id AND k.month = g.m))::int AS due,
              (SELECT count(*) FROM app.monthly_marks k WHERE k.month = g.m AND k.status = 'paid')::int AS paid,
              (SELECT count(*) FROM app.monthly_marks k WHERE k.month = g.m AND k.status = 'skipped')::int AS skipped
       FROM generate_series($1::date - interval '5 months', $1::date, interval '1 month') AS g(m)
       ORDER BY g.m`,
      // Anchored on this month (or the month shown, if later), so looking back keeps recent months in view.
      [first(month > today.slice(0, 7) ? month : today.slice(0, 7))],
    ),
  ]);
  return {
    month,
    firstMonth: bounds[0]?.first_month ?? null,
    totalItems: bounds[0]?.n ?? 0,
    items: rows.map((r) => ({ ...r, suggestion: suggestions.get(r.id) ?? null })),
    stopped,
    history: history.filter((h) => h.due > 0),
  };
}

/** Expenses around a month that no checklist item has claimed yet (plus, optionally, the one an item already has). */
async function candidates(month: Month, slackDays: number, keep: string | null = null, search?: string) {
  const params: unknown[] = [first(month), slackDays, keep];
  let extra = "";
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const conds = [`counterparty ILIKE $4`, `note ILIKE $4`, `category ILIKE $4`];
    const digits = search.replace(/[,\s]/g, "");
    if (/^\d+(\.\d{1,2})?$/.test(digits)) {
      const [w, fr = ""] = digits.split(".");
      params.push(Number(w) * 100 + Number(fr.padEnd(2, "0")));
      conds.push(`amount_paisa = $5`);
    }
    extra = ` AND (${conds.join(" OR ")})`;
  }
  const { rows } = await q<LinkedTx>(
    `SELECT ${TX_COLS()} FROM app.transactions
     WHERE kind = 'expense'
       AND occurred_at >= (($1::date - $2::int)::timestamp AT TIME ZONE 'Asia/Karachi')
       AND occurred_at < ((($1::date + interval '1 month')::date + $2::int)::timestamp AT TIME ZONE 'Asia/Karachi')
       AND (id = $3::uuid OR NOT EXISTS (SELECT 1 FROM app.monthly_marks mm WHERE mm.transaction_id = transactions.id))
       ${extra}
     ORDER BY occurred_at DESC LIMIT 400`,
    params,
  );
  return rows;
}

/** Transactions to choose from when linking a payment, best guesses first. */
export async function monthlyMatches(id: string, month: Month, search?: string) {
  const item = await getItem(id);
  if (!item) return null;
  const { rows: marks } = await q<{ transaction_id: string | null }>(
    `SELECT transaction_id FROM app.monthly_marks WHERE item_id = $1 AND month = $2::date`,
    [id, first(month)],
  );
  // With a search, look a little wider: the payment may have gone out early or late.
  const txs = await candidates(month, search ? 20 : 10, marks[0]?.transaction_id ?? null, search);
  return rankMatches(item, txs, month, 0).slice(0, 40);
}

async function getItem(id: string) {
  const { rows } = await q<MonthlyItemRow>(`SELECT ${ITEM_COLS()} FROM app.monthly_items WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createMonthlyItem(v: MonthlyItemInput) {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO app.monthly_items (position, name, amount_paisa, category, payee, due_day, starts_month, ended_month)
     VALUES ((SELECT coalesce(max(position), 0) + 1 FROM app.monthly_items), $1, $2, $3, $4, $5, $6::date, $7::date) RETURNING id`,
    [v.name, v.amount, v.category, v.payee, v.dueDay, first(v.startsMonth), v.endedMonth ? first(v.endedMonth) : null],
  );
  return rows[0].id;
}

export async function updateMonthlyItem(id: string, v: MonthlyItemInput) {
  const { rowCount } = await q(
    `UPDATE app.monthly_items SET name = $2, amount_paisa = $3, category = $4, payee = $5, due_day = $6, starts_month = $7::date, ended_month = $8::date
     WHERE id = $1`,
    [id, v.name, v.amount, v.category, v.payee, v.dueDay, first(v.startsMonth), v.endedMonth ? first(v.endedMonth) : null],
  );
  return (rowCount ?? 0) > 0;
}

/** Stop after a month (keeps every past month as it was), or put it back on the list. */
export async function stopMonthlyItem(id: string, lastMonth: Month | null) {
  const { rowCount } = await q(
    `UPDATE app.monthly_items SET ended_month = CASE WHEN $2::date IS NULL THEN NULL ELSE greatest($2::date, starts_month) END WHERE id = $1`,
    [id, lastMonth ? first(lastMonth) : null],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteMonthlyItem(id: string) {
  const { rowCount } = await q(`DELETE FROM app.monthly_items WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function markMonthly(id: string, v: MonthlyMarkInput) {
  if (v.transactionId) {
    const { rows } = await q(`SELECT 1 FROM app.transactions WHERE id = $1`, [v.transactionId]);
    if (!rows.length) return "no-transaction" as const;
  }
  const { rowCount } = await q(
    `INSERT INTO app.monthly_marks (item_id, month, status, transaction_id, amount_paisa, note)
     SELECT id, $2::date, $3, $4, $5, $6 FROM app.monthly_items WHERE id = $1
     ON CONFLICT (item_id, month) DO UPDATE SET status = EXCLUDED.status, transaction_id = EXCLUDED.transaction_id,
       amount_paisa = EXCLUDED.amount_paisa, note = EXCLUDED.note, marked_at = now()`,
    [id, first(v.month), v.status, v.status === "paid" ? v.transactionId ?? null : null, v.status === "paid" && !v.transactionId ? v.amount ?? null : null, v.note ?? null],
  );
  return (rowCount ?? 0) > 0 ? ("ok" as const) : ("no-item" as const);
}

export async function unmarkMonthly(id: string, month: Month) {
  const { rowCount } = await q(`DELETE FROM app.monthly_marks WHERE item_id = $1 AND month = $2::date`, [id, first(month)]);
  return (rowCount ?? 0) > 0;
}
