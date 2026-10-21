import "server-only";
import { q, sch, tx, type Space } from "./db";
import type { ListQuery, SetAsideInput, TransactionInput } from "./validation";
import { HttpError } from "./http";
import { OWN_ACCOUNTS, type Kind } from "./categories";

export type TxRow = {
  id: string;
  kind: Kind;
  amount_paisa: number;
  occurred_at: string;
  category: string;
  counterparty: string | null;
  note: string | null;
  source: "manual" | "sms" | "demo";
  account_hint: string | null;
  bank_ref: string | null;
  set_aside_id: string | null;
};

const txCols = (a = "") =>
  `${a}id, ${a}kind, ${a}amount_paisa::float8 AS amount_paisa, ${a}occurred_at, ${a}category, ${a}counterparty, ${a}note, ${a}source, ${a}account_hint, ${a}bank_ref, ${a}set_aside_id`;
const TX_COLS = txCols();
const RANGE_SQL = (a: string, b: string) =>
  `occurred_at >= (${a}::date::timestamp AT TIME ZONE 'Asia/Karachi') AND occurred_at < ((${b}::date + 1)::timestamp AT TIME ZONE 'Asia/Karachi')`;

function buildWhere(f: Partial<ListQuery>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.kind) where.push(`kind = ${p(f.kind)}`);
  if (f.category) where.push(`category = ${p(f.category)}`);
  if (f.source) where.push(`source = ${p(f.source)}`);
  if (f.counterparty) where.push(`lower(counterparty) = lower(${p(f.counterparty)})`);
  if (f.from) where.push(`occurred_at >= (${p(f.from)}::date::timestamp AT TIME ZONE 'Asia/Karachi')`);
  if (f.to) where.push(`occurred_at < ((${p(f.to)}::date + 1)::timestamp AT TIME ZONE 'Asia/Karachi')`);
  if (f.q) {
    const term = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const t = p(term);
    const conds = [`counterparty ILIKE ${t}`, `note ILIKE ${t}`, `category ILIKE ${t}`];
    const digits = f.q.replace(/[,\s]/g, "");
    if (/^\d+(\.\d{1,2})?$/.test(digits)) {
      const [w, fr = ""] = digits.split(".");
      conds.push(`amount_paisa = ${p(Number(w) * 100 + Number(fr.padEnd(2, "0")))}`);
    }
    where.push(`(${conds.join(" OR ")})`);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

// Transfers between the user's own accounts move the balance but are neither spending nor income.
const NOT_OWN = `category <> '${OWN_ACCOUNTS}'`;

export async function listTransactions(space: Space, f: ListQuery) {
  const { sql, params } = buildWhere(f);
  const s = sch(space);
  const offset = (f.page - 1) * f.pageSize;
  const [rows, agg] = await Promise.all([
    q<TxRow>(`SELECT ${TX_COLS} FROM ${s}.transactions ${sql} ORDER BY occurred_at DESC, created_at DESC LIMIT ${f.pageSize} OFFSET ${offset}`, params),
    q<{ n: number; expense: number; income: number; remittance: number }>(
      `SELECT count(*)::int AS n,
              coalesce(sum(amount_paisa) FILTER (WHERE kind='expense' AND ${NOT_OWN}),0)::float8 AS expense,
              coalesce(sum(amount_paisa) FILTER (WHERE kind='income' AND ${NOT_OWN}),0)::float8 AS income,
              coalesce(sum(amount_paisa) FILTER (WHERE kind='remittance'),0)::float8 AS remittance
       FROM ${s}.transactions ${sql}`,
      params,
    ),
  ]);
  return { items: rows.rows, total: agg.rows[0].n, sums: agg.rows[0], page: f.page, pageSize: f.pageSize };
}

export async function exportTransactions(space: Space, f: Partial<ListQuery>) {
  const { sql, params } = buildWhere(f);
  const { rows } = await q<TxRow>(`SELECT ${TX_COLS} FROM ${sch(space)}.transactions ${sql} ORDER BY occurred_at DESC LIMIT 50000`, params);
  return rows;
}

export async function analytics(space: Space, from: string, to: string, granularity: "day" | "month" | "year") {
  const s = sch(space);
  const range = RANGE_SQL("$1", "$2");
  const step = granularity === "day" ? "1 day" : granularity === "month" ? "1 month" : "1 year";
  const fmt = granularity === "day" ? "YYYY-MM-DD" : granularity === "month" ? "YYYY-MM" : "YYYY";
  const [totals, series, cats, recips, daily] = await Promise.all([
    q<{ kind: Kind; total: number; n: number }>(
      `SELECT kind, sum(amount_paisa)::float8 AS total, count(*)::int AS n FROM ${s}.transactions WHERE ${range} AND ${NOT_OWN} GROUP BY kind`,
      [from, to],
    ),
    q<{ bucket: string; expense: number; income: number; remittance: number }>(
      `WITH buckets AS (
         SELECT generate_series(date_trunc('${granularity}', $1::date::timestamp), date_trunc('${granularity}', $2::date::timestamp), interval '${step}') AS b
       ), agg AS (
         SELECT date_trunc('${granularity}', occurred_at AT TIME ZONE 'Asia/Karachi') AS b,
                sum(amount_paisa) FILTER (WHERE kind='expense' AND ${NOT_OWN}) AS expense,
                sum(amount_paisa) FILTER (WHERE kind='income' AND ${NOT_OWN}) AS income,
                sum(amount_paisa) FILTER (WHERE kind='remittance') AS remittance
         FROM ${s}.transactions WHERE ${range} GROUP BY 1
       )
       SELECT to_char(buckets.b, '${fmt}') AS bucket,
              coalesce(agg.expense,0)::float8 AS expense, coalesce(agg.income,0)::float8 AS income, coalesce(agg.remittance,0)::float8 AS remittance
       FROM buckets LEFT JOIN agg ON agg.b = buckets.b ORDER BY buckets.b`,
      [from, to],
    ),
    q<{ category: string; total: number; n: number }>(
      `SELECT category, sum(amount_paisa)::float8 AS total, count(*)::int AS n FROM ${s}.transactions
       WHERE kind='expense' AND ${NOT_OWN} AND ${range} GROUP BY category ORDER BY total DESC`,
      [from, to],
    ),
    q<{ counterparty: string; total: number; n: number }>(
      `SELECT min(counterparty) AS counterparty, sum(amount_paisa)::float8 AS total, count(*)::int AS n FROM ${s}.transactions
       WHERE kind='expense' AND ${NOT_OWN} AND counterparty IS NOT NULL AND ${range} GROUP BY lower(counterparty) ORDER BY total DESC LIMIT 8`,
      [from, to],
    ),
    q<{ days: number }>(`SELECT ($2::date - $1::date + 1)::int AS days`, [from, to]),
  ]);
  const byKind = { expense: { total: 0, n: 0 }, income: { total: 0, n: 0 }, remittance: { total: 0, n: 0 } };
  for (const r of totals.rows) byKind[r.kind] = { total: r.total, n: r.n };
  const pending = await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${s}.review_items WHERE status='pending'`);
  return {
    from, to, granularity,
    totals: byKind,
    net: byKind.income.total + byKind.remittance.total - byKind.expense.total,
    avgDailyExpense: Math.round(byKind.expense.total / Math.max(1, daily.rows[0].days)),
    series: series.rows,
    categories: cats.rows,
    topRecipients: recips.rows,
    pendingReview: pending.rows[0].n,
  };
}

export async function recipients(space: Space, from?: string, to?: string) {
  const s = sch(space);
  const params: unknown[] = [];
  let range = "";
  if (from && to) {
    params.push(from, to);
    range = `AND ${RANGE_SQL("$1", "$2")}`;
  }
  const { rows } = await q<{ counterparty: string; sent: number; received: number; n: number; last_at: string; first_at: string }>(
    `SELECT min(counterparty) AS counterparty,
            coalesce(sum(amount_paisa) FILTER (WHERE kind='expense'),0)::float8 AS sent,
            coalesce(sum(amount_paisa) FILTER (WHERE kind<>'expense'),0)::float8 AS received,
            count(*)::int AS n, max(occurred_at) AS last_at, min(occurred_at) AS first_at
     FROM ${s}.transactions WHERE counterparty IS NOT NULL AND ${NOT_OWN} ${range}
     GROUP BY lower(counterparty) ORDER BY (coalesce(sum(amount_paisa),0)) DESC LIMIT 500`,
    params,
  );
  return rows;
}

export async function distinctCategories(space: Space) {
  const { rows } = await q<{ category: string }>(`SELECT DISTINCT category FROM ${sch(space)}.transactions ORDER BY 1`);
  return rows.map((r) => r.category);
}

// ---- Writes: private workspace only. The demo schema is never written at runtime. ----

/** Only expenses can be paid out of a set-aside. A dangling id is reported as a field error. */
const fundOf = (t: TransactionInput) => (t.kind === "expense" ? t.setAsideId ?? null : null);
async function withFundCheck<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string })?.code === "23503") throw new HttpError(400, "That set-aside no longer exists", { fields: { setAsideId: ["Choose another set-aside"] } });
    throw e;
  }
}

type Run = typeof q;

/** Records a transfer's bank charge or tax as its own expense, dated with the transfer. */
async function addBankCharge(run: Run, chargesPaisa: number, t: TransactionInput, accountHint: string | null) {
  await run(
    `INSERT INTO app.transactions (kind, amount_paisa, occurred_at, category, counterparty, note, source, account_hint)
     VALUES ('expense',$1,$2,'Bank charges','MCB',$3,'manual',$4)`,
    [chargesPaisa, t.occurredAt, `Charges on transfer${t.counterparty ? ` to ${t.counterparty}` : ""}`.slice(0, 500), accountHint],
  );
}

export async function createTransaction(t: TransactionInput, source: "manual" | "sms" = "manual") {
  const { rows } = await withFundCheck(() =>
    q<TxRow>(
      `INSERT INTO app.transactions (kind, amount_paisa, occurred_at, category, counterparty, note, source, set_aside_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${TX_COLS}`,
      [t.kind, t.amount, t.occurredAt, t.category, t.counterparty ?? null, t.note ?? null, source, fundOf(t)],
    ),
  );
  return rows[0];
}

export async function updateTransaction(id: string, t: TransactionInput, chargesPaisa = 0) {
  return withFundCheck(() => tx(async (run) => {
    const { rows } = await run<TxRow>(
      `UPDATE app.transactions SET kind=$2, amount_paisa=$3, occurred_at=$4, category=$5, counterparty=$6, note=$7, set_aside_id=$8, updated_at=now()
       WHERE id=$1 RETURNING ${TX_COLS}`,
      [id, t.kind, t.amount, t.occurredAt, t.category, t.counterparty ?? null, t.note ?? null, fundOf(t)],
    );
    if (rows[0] && chargesPaisa > 0) await addBankCharge(run, chargesPaisa, t, rows[0].account_hint);
    return rows[0] ?? null;
  }));
}

export async function deleteTransaction(id: string) {
  const r = await q(`DELETE FROM app.transactions WHERE id=$1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export type ReviewRow = {
  id: string;
  status: string;
  reason: string;
  redacted_text: string | null;
  sender: string | null;
  received_at: string;
  kind: Kind | null;
  amount_paisa: number | null;
  occurred_at: string | null;
  counterparty: string | null;
  category: string | null;
  account_hint: string | null;
  bank_ref: string | null;
};

export async function listReview(space: Space) {
  const { rows } = await q<ReviewRow>(
    `SELECT id, status, reason, redacted_text, sender, received_at, kind, amount_paisa::float8 AS amount_paisa, occurred_at,
            counterparty, category, account_hint, bank_ref
     FROM ${sch(space)}.review_items WHERE status='pending' ORDER BY received_at DESC LIMIT 200`,
  );
  return rows;
}

/** Confirms a review item into a real transaction and discards the retained SMS excerpt. */
export async function confirmReview(id: string, t: TransactionInput, chargesPaisa = 0) {
  return withFundCheck(() => tx(async (run) => {
    const item = await run<{ id: string; bank_ref: string | null; account_hint: string | null; sms_import_id: string | null }>(
      `SELECT id, bank_ref, account_hint, sms_import_id FROM app.review_items WHERE id=$1 AND status='pending' FOR UPDATE`,
      [id],
    );
    if (!item.rows[0]) return null;
    const it = item.rows[0];
    const ins = await run<TxRow>(
      `INSERT INTO app.transactions (kind, amount_paisa, occurred_at, category, counterparty, note, source, account_hint, bank_ref, sms_import_id, set_aside_id)
       VALUES ($1,$2,$3,$4,$5,$6,'sms',$7,$8,$9,$10)
       ON CONFLICT (bank_ref) WHERE bank_ref IS NOT NULL DO NOTHING
       RETURNING ${TX_COLS}`,
      [t.kind, t.amount, t.occurredAt, t.category, t.counterparty ?? null, t.note ?? null, it.account_hint, it.bank_ref, it.sms_import_id, fundOf(t)],
    );
    if (!ins.rows[0]) return { duplicate: true as const };
    if (chargesPaisa > 0) await addBankCharge(run, chargesPaisa, t, it.account_hint);
    await run(
      `UPDATE app.review_items SET status='confirmed', transaction_id=$2, resolved_at=now(), redacted_text=NULL WHERE id=$1`,
      [id, ins.rows[0].id],
    );
    return { transaction: ins.rows[0] };
  }));
}

export async function dismissReview(id: string) {
  const r = await q(`UPDATE app.review_items SET status='dismissed', resolved_at=now(), redacted_text=NULL WHERE id=$1 AND status='pending'`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ---- Bank balance ----
// The user states their balance once (the anchor). Every transaction dated from that minute on
// moves it: income and remittances add, expenses subtract. Editing or deleting those
// transactions therefore corrects the balance automatically.

export type BalanceRow = { anchor: number; as_of: string; delta: number; n: number; balance: number };

export async function getBalance(): Promise<BalanceRow | null> {
  const { rows } = await q<{ anchor: number; as_of: string; delta: number; n: number }>(
    `SELECT a.amount_paisa::float8 AS anchor, a.as_of,
            coalesce(sum(CASE WHEN t.kind = 'expense' THEN -t.amount_paisa ELSE t.amount_paisa END), 0)::float8 AS delta,
            count(t.id)::int AS n
     FROM app.balance_anchor a
     LEFT JOIN app.transactions t ON t.occurred_at >= date_trunc('minute', a.as_of)
     GROUP BY a.amount_paisa, a.as_of`,
  );
  const r = rows[0];
  return r ? { ...r, balance: r.anchor + r.delta } : null;
}

export async function setBalance(amountPaisa: number) {
  await q(
    `INSERT INTO app.balance_anchor (id, amount_paisa, as_of, updated_at) VALUES (1, $1, now(), now())
     ON CONFLICT (id) DO UPDATE SET amount_paisa = EXCLUDED.amount_paisa, as_of = EXCLUDED.as_of, updated_at = now()`,
    [amountPaisa],
  );
  return getBalance();
}

// ---- Set-asides ----
// A rule such as "10% of every remittance for charity". The amount set aside is computed from
// matching transactions in the rule's date window; expenses tagged with the rule are paid out of it.

export type SetAsideRow = {
  id: string;
  name: string;
  percent_bp: number;
  applies_to: "remittance" | "income" | "incoming";
  starts_on: string;
  ended_on: string | null;
  allocated: number;
  sources: number;
  used: number;
  remaining: number;
};

const MATCHES = `t.category <> '${OWN_ACCOUNTS}' AND ((s.applies_to = 'incoming' AND t.kind IN ('income', 'remittance')) OR t.kind = s.applies_to)
  AND t.occurred_at >= (s.starts_on::timestamp AT TIME ZONE 'Asia/Karachi')
  AND (s.ended_on IS NULL OR t.occurred_at < ((s.ended_on + 1)::timestamp AT TIME ZONE 'Asia/Karachi'))`;

export async function listSetAsides(): Promise<SetAsideRow[]> {
  const { rows } = await q<Omit<SetAsideRow, "remaining">>(
    `SELECT s.id, s.name, s.percent_bp, s.applies_to, to_char(s.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(s.ended_on, 'YYYY-MM-DD') AS ended_on,
            coalesce(src.allocated, 0)::float8 AS allocated, coalesce(src.n, 0)::int AS sources,
            coalesce(out.used, 0)::float8 AS used
     FROM app.set_asides s
     LEFT JOIN LATERAL (
       SELECT sum(floor(t.amount_paisa * s.percent_bp / 10000.0)) AS allocated, count(*) AS n
       FROM app.transactions t WHERE ${MATCHES}
     ) src ON true
     LEFT JOIN LATERAL (
       SELECT sum(u.amount_paisa) AS used FROM app.transactions u WHERE u.set_aside_id = s.id AND u.kind = 'expense'
     ) out ON true
     ORDER BY s.ended_on IS NOT NULL, s.created_at`,
  );
  return rows.map((r) => ({ ...r, remaining: r.allocated - r.used }));
}

export async function setAsideContributions(id: string) {
  const { rows } = await q<TxRow & { share: number }>(
    `SELECT ${txCols("t.")},
            floor(t.amount_paisa * s.percent_bp / 10000.0)::float8 AS share
     FROM app.set_asides s JOIN app.transactions t ON ${MATCHES}
     WHERE s.id = $1 ORDER BY t.occurred_at DESC LIMIT 100`,
    [id],
  );
  return rows;
}

export async function createSetAside(v: SetAsideInput) {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO app.set_asides (name, percent_bp, applies_to, starts_on, ended_on) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [v.name, v.percentBp, v.appliesTo, v.startsOn, v.endedOn ?? null],
  );
  return rows[0].id;
}

export async function updateSetAside(id: string, v: SetAsideInput) {
  const r = await q(
    `UPDATE app.set_asides SET name=$2, percent_bp=$3, applies_to=$4, starts_on=$5, ended_on=$6 WHERE id=$1`,
    [id, v.name, v.percentBp, v.appliesTo, v.startsOn, v.endedOn ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteSetAside(id: string) {
  const r = await q(`DELETE FROM app.set_asides WHERE id=$1`, [id]);
  return (r.rowCount ?? 0) > 0;
}
