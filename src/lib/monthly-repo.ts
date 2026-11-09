import "server-only";
import { q, tx } from "./db";
import { isComplete, rankMatches, suggestFor, type Month } from "./monthly";
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
export type MonthlyMark = { status: "paid" | "skipped"; full: boolean; amount_paisa: number | null; note: string | null; marked_at: string };
export type MonthState = "paid" | "partial" | "skipped" | null;

const ITEM_COLS = (a = "") => `${a}id, ${a}name, ${a}amount_paisa::float8 AS amount_paisa, ${a}category, ${a}payee, ${a}due_day,
  to_char(${a}starts_month, 'YYYY-MM') AS starts_month, to_char(${a}ended_month, 'YYYY-MM') AS ended_month`;
const TX_COLS = (a = "") => `${a}id, ${a}amount_paisa::float8 AS amount_paisa, ${a}occurred_at, ${a}category, ${a}counterparty, ${a}note`;
const first = (m: Month) => `${m}-01`;

/** Sum of the transactions linked to mark "m". */
const LINKED_SUM = `(SELECT coalesce(sum(t.amount_paisa), 0) FROM app.monthly_mark_txs l JOIN app.transactions t ON t.id = l.transaction_id
  WHERE l.item_id = m.item_id AND l.month = m.month)`;
/** SQL form of isComplete() in monthly.ts, for mark "m" of item "i". */
const COMPLETE_SQL = `(m.status = 'paid' AND (m.paid_in_full OR i.amount_paisa IS NULL
  OR (coalesce(m.amount_paisa, 0) + ${LINKED_SUM}) * 100 >= i.amount_paisa * 98))`;

/** The checklist for one month: every item active in it, how it was settled, and a likely payment for the rest. */
export async function monthlyList(month: Month, today: string) {
  const { rows: raw } = await q<MonthlyItemRow & { mark: MonthlyMark | null; txs: LinkedTx[] }>(
    `SELECT ${ITEM_COLS("i.")},
            CASE WHEN m.item_id IS NULL THEN NULL ELSE json_build_object(
              'status', m.status, 'full', m.paid_in_full, 'amount_paisa', m.amount_paisa::float8,
              'note', m.note, 'marked_at', m.marked_at) END AS mark,
            coalesce((SELECT json_agg(json_build_object(
                'id', t.id, 'amount_paisa', t.amount_paisa::float8, 'occurred_at', t.occurred_at, 'category', t.category,
                'counterparty', t.counterparty, 'note', t.note) ORDER BY t.occurred_at)
              FROM app.monthly_mark_txs l JOIN app.transactions t ON t.id = l.transaction_id
              WHERE l.item_id = i.id AND l.month = $1::date), '[]'::json) AS txs
     FROM app.monthly_items i
     LEFT JOIN app.monthly_marks m ON m.item_id = i.id AND m.month = $1::date
     WHERE (i.starts_month <= $1::date AND (i.ended_month IS NULL OR i.ended_month >= $1::date)) OR m.item_id IS NOT NULL
     ORDER BY i.due_day NULLS LAST, i.position, lower(i.name)`,
    [first(month)],
  );
  const rows = raw.map((r) => {
    const paid = r.txs.reduce((a, t) => a + t.amount_paisa, 0) + (r.mark?.amount_paisa ?? 0);
    const state: MonthState = !r.mark ? null : r.mark.status === "skipped" ? "skipped" : isComplete(r.amount_paisa, r.mark.full, paid) ? "paid" : "partial";
    return { ...r, paid, state };
  });
  // Look for payments only in months that have started; for a part-paid item, look for the rest.
  const open = rows.filter((r) => r.state === null || r.state === "partial")
    .map((r) => (r.state === "partial" && r.amount_paisa ? { ...r, amount_paisa: Math.max(1, r.amount_paisa - r.paid) } : r));
  const suggestions = new Map<string, LinkedTx & { score: number }>();
  if (open.length && first(month) <= today) {
    const cands = await candidates(month);
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
              (SELECT count(*) FROM app.monthly_marks m JOIN app.monthly_items i ON i.id = m.item_id
                WHERE m.month = g.m AND ${COMPLETE_SQL})::int AS paid,
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

/** Expenses dated in the month (Karachi time) that no checklist item has claimed yet. */
async function candidates(month: Month, search?: string) {
  const params: unknown[] = [first(month)];
  let extra = "";
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const conds = [`counterparty ILIKE $2`, `note ILIKE $2`, `category ILIKE $2`];
    const digits = search.replace(/[,\s]/g, "");
    if (/^\d+(\.\d{1,2})?$/.test(digits)) {
      const [w, fr = ""] = digits.split(".");
      params.push(Number(w) * 100 + Number(fr.padEnd(2, "0")));
      conds.push(`amount_paisa = $3`);
    }
    extra = ` AND (${conds.join(" OR ")})`;
  }
  const { rows } = await q<LinkedTx>(
    `SELECT ${TX_COLS()} FROM app.transactions
     WHERE kind = 'expense'
       AND occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Karachi')
       AND occurred_at < (($1::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Karachi')
       AND NOT EXISTS (SELECT 1 FROM app.monthly_mark_txs l WHERE l.transaction_id = transactions.id)
       ${extra}
     ORDER BY occurred_at DESC LIMIT 400`,
    params,
  );
  return rows;
}

/** Transactions to choose from when linking a payment, best guesses first (aimed at what is still to pay). */
export async function monthlyMatches(id: string, month: Month, search?: string) {
  const item = await getItem(id);
  if (!item) return null;
  const { rows: [paid] } = await q<{ total: number }>(
    `SELECT coalesce(sum(t.amount_paisa), 0)::float8 AS total FROM app.monthly_mark_txs l JOIN app.transactions t ON t.id = l.transaction_id
     WHERE l.item_id = $1 AND l.month = $2::date`,
    [id, first(month)],
  );
  const target = item.amount_paisa && paid.total > 0 ? { ...item, amount_paisa: Math.max(1, item.amount_paisa - paid.total) } : item;
  // Only that month's spending, with or without a search.
  const txs = await candidates(month, search);
  return rankMatches(target, txs, month, 0).slice(0, 40);
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

/**
 * Ticks an item off for a month, or adds to it: a transaction adds a part, "full" says it is fully paid,
 * amount and note record a part paid outside Mizan (only when given). Skipping clears the parts.
 */
export async function markMonthly(id: string, v: MonthlyMarkInput) {
  if (v.transactionId) {
    const { rows } = await q(`SELECT 1 FROM app.transactions WHERE id = $1`, [v.transactionId]);
    if (!rows.length) return "no-transaction" as const;
  }
  return tx(async (run) => {
    const { rows: item } = await run(`SELECT 1 FROM app.monthly_items WHERE id = $1`, [id]);
    if (!item.length) return "no-item" as const;
    const m = first(v.month);
    if (v.status === "skipped") {
      await run(
        `INSERT INTO app.monthly_marks (item_id, month, status, note) VALUES ($1, $2::date, 'skipped', $3)
         ON CONFLICT (item_id, month) DO UPDATE SET status = 'skipped', paid_in_full = false, amount_paisa = NULL, note = EXCLUDED.note, marked_at = now()`,
        [id, m, v.note ?? null],
      );
      await run(`DELETE FROM app.monthly_mark_txs WHERE item_id = $1 AND month = $2::date`, [id, m]);
      return "ok" as const;
    }
    const setAmount = v.amount !== undefined;
    const setNote = v.note !== undefined;
    await run(
      `INSERT INTO app.monthly_marks (item_id, month, status, paid_in_full, amount_paisa, note) VALUES ($1, $2::date, 'paid', $3, $4, $5)
       ON CONFLICT (item_id, month) DO UPDATE SET status = 'paid',
         paid_in_full = CASE WHEN monthly_marks.status = 'skipped' THEN EXCLUDED.paid_in_full ELSE monthly_marks.paid_in_full OR EXCLUDED.paid_in_full END,
         amount_paisa = CASE WHEN $6 THEN EXCLUDED.amount_paisa WHEN monthly_marks.status = 'skipped' THEN NULL ELSE monthly_marks.amount_paisa END,
         note = CASE WHEN $7 THEN EXCLUDED.note WHEN monthly_marks.status = 'skipped' THEN NULL ELSE monthly_marks.note END,
         marked_at = now()`,
      [id, m, v.full ?? false, v.amount ?? null, v.note ?? null, setAmount, setNote],
    );
    if (v.transactionId) {
      await run(
        `INSERT INTO app.monthly_mark_txs (item_id, month, transaction_id) VALUES ($1, $2::date, $3) ON CONFLICT DO NOTHING`,
        [id, m, v.transactionId],
      );
    }
    return "ok" as const;
  });
}

/** Removes one part (a linked transaction), or with none given puts the item back to not paid for the month. */
export async function unmarkMonthly(id: string, month: Month, transactionId?: string) {
  if (!transactionId) {
    const { rowCount } = await q(`DELETE FROM app.monthly_marks WHERE item_id = $1 AND month = $2::date`, [id, first(month)]);
    return (rowCount ?? 0) > 0;
  }
  const { rowCount } = await q(`DELETE FROM app.monthly_mark_txs WHERE item_id = $1 AND month = $2::date AND transaction_id = $3`, [id, first(month), transactionId]);
  // With nothing left to show for it, the month goes back to not paid.
  await q(
    `DELETE FROM app.monthly_marks m WHERE item_id = $1 AND month = $2::date AND status = 'paid' AND NOT paid_in_full AND amount_paisa IS NULL AND note IS NULL
       AND NOT EXISTS (SELECT 1 FROM app.monthly_mark_txs l WHERE l.item_id = m.item_id AND l.month = m.month)`,
    [id, first(month)],
  );
  return (rowCount ?? 0) > 0;
}
