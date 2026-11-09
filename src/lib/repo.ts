import "server-only";
import { q, sch, tx, type Space } from "./db";
import type { ListQuery, SetAsideInput, TransactionInput } from "./validation";
import { HttpError } from "./http";
import { OWN_ACCOUNTS, type Kind } from "./categories";
import { addDays } from "./time";
import { normalizePrefs, type Prefs } from "./preferences";
import { normalizeWords, type SmsWords } from "./sms/keywords";
import type { Bank } from "./banks";
import { BANK_CHARGES, TAX_DEDUCTED, type ChargeEdits } from "./charges";

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
  bank_id: string | null;
  /** For a bank charge or tax added on a transfer: the transfer it belongs to. */
  parent_id: string | null;
};

/** A listed transaction, with the bank charges and tax already added on it (so its edit form can show them). */
export type ListedTxRow = TxRow & { charge_fee_paisa: number | null; charge_tax_paisa: number | null };

const txCols = (a = "") =>
  `${a}id, ${a}kind, ${a}amount_paisa::float8 AS amount_paisa, ${a}occurred_at, ${a}category, ${a}counterparty, ${a}note, ${a}source, ${a}account_hint, ${a}bank_ref, ${a}set_aside_id, ${a}bank_id, ${a}parent_id`;
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
  if (f.bank === "none") where.push(`bank_id IS NULL`);
  else if (f.bank) where.push(`bank_id = ${p(f.bank)}`);
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

/** Total of the charges of one category added on the listed transfer `t`, or null when there are none. */
const chargeSum = (s: string, category: string) =>
  `(SELECT sum(c.amount_paisa)::float8 FROM ${s}.transactions c WHERE c.parent_id = t.id AND c.category = '${category}')`;

export async function listTransactions(space: Space, f: ListQuery) {
  const { sql, params } = buildWhere(f);
  const s = sch(space);
  const offset = (f.page - 1) * f.pageSize;
  const [rows, agg] = await Promise.all([
    q<ListedTxRow>(
      `SELECT ${txCols("t.")}, ${chargeSum(s, "Bank charges")} AS charge_fee_paisa, ${chargeSum(s, "Tax deducted")} AS charge_tax_paisa
       FROM ${s}.transactions t ${sql} ORDER BY occurred_at DESC, created_at DESC LIMIT ${f.pageSize} OFFSET ${offset}`,
      params,
    ),
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

export async function analytics(space: Space, from: string, to: string, granularity: "day" | "month" | "year", bank?: string) {
  const s = sch(space);
  // The bank filter rides along with the date range, so every figure below follows it.
  const bankSql = bank === "none" ? " AND bank_id IS NULL" : bank ? ` AND bank_id = '${bank.replace(/[^0-9a-f-]/gi, "")}'::uuid` : "";
  const range = RANGE_SQL("$1", "$2") + bankSql;
  const step = granularity === "day" ? "1 day" : granularity === "month" ? "1 month" : "1 year";
  const fmt = granularity === "day" ? "YYYY-MM-DD" : granularity === "month" ? "YYYY-MM" : "YYYY";
  // The previous period has the same number of days and ends the day before this one starts.
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400e3) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -days);
  const totalsSql = `SELECT kind, sum(amount_paisa)::float8 AS total, count(*)::int AS n FROM ${s}.transactions WHERE ${range} AND ${NOT_OWN} GROUP BY kind`;
  const [totals, prevTotals, series, cats, recips, daily, balanceSeries] = await Promise.all([
    q<{ kind: Kind; total: number; n: number }>(totalsSql, [from, to]),
    q<{ kind: Kind; total: number; n: number }>(totalsSql, [prevFrom, prevTo]),
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
    // The balance covers all banks together, so it is left out when one bank is picked.
    space === "app" && !bank ? balanceOverTime(from, to, granularity) : Promise.resolve(null),
  ]);
  const group = (rows: { kind: Kind; total: number; n: number }[]) => {
    const out = { expense: { total: 0, n: 0 }, income: { total: 0, n: 0 }, remittance: { total: 0, n: 0 } };
    for (const r of rows) out[r.kind] = { total: r.total, n: r.n };
    return out;
  };
  const byKind = group(totals.rows);
  const prevKind = group(prevTotals.rows);
  const pending = await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${s}.review_items WHERE status='pending'${bankSql}`);
  return {
    from, to, granularity,
    totals: byKind,
    net: byKind.income.total + byKind.remittance.total - byKind.expense.total,
    avgDailyExpense: Math.round(byKind.expense.total / Math.max(1, daily.rows[0].days)),
    series: series.rows,
    categories: cats.rows,
    topRecipients: recips.rows,
    pendingReview: pending.rows[0].n,
    previous: {
      from: prevFrom,
      to: prevTo,
      totals: prevKind,
      net: prevKind.income.total + prevKind.remittance.total - prevKind.expense.total,
      avgDailyExpense: Math.round(prevKind.expense.total / Math.max(1, days)),
    },
    balanceSeries,
  };
}

/**
 * Bank balance at the end of each bucket, worked back from the balance anchor.
 * With S(t) the signed sum of every transaction at or after t, the balance at t is
 * anchor + S(anchor time) - S(t), which holds on both sides of the anchor.
 * Returns null until a balance has been set.
 */
async function balanceOverTime(from: string, to: string, granularity: "day" | "month" | "year") {
  const step = granularity === "day" ? "1 day" : granularity === "month" ? "1 month" : "1 year";
  const fmt = granularity === "day" ? "YYYY-MM-DD" : granularity === "month" ? "YYYY-MM" : "YYYY";
  const signed = `CASE WHEN t.kind = 'expense' THEN -t.amount_paisa ELSE t.amount_paisa END`;
  const { rows } = await q<{ bucket: string; balance: number }>(
    `WITH a AS (SELECT amount_paisa, date_trunc('minute', as_of) AS as_of FROM app.balance_anchor WHERE id = 1),
     buckets AS (
       SELECT b, least((b + interval '${step}') AT TIME ZONE 'Asia/Karachi', now()) AS e
       FROM generate_series(date_trunc('${granularity}', $1::date::timestamp), date_trunc('${granularity}', $2::date::timestamp), interval '${step}') AS b
     ),
     after_anchor AS (SELECT coalesce(sum(${signed}), 0) AS v FROM app.transactions t, a WHERE t.occurred_at >= a.as_of)
     SELECT to_char(buckets.b, '${fmt}') AS bucket,
            (a.amount_paisa + after_anchor.v - coalesce((SELECT sum(${signed}) FROM app.transactions t WHERE t.occurred_at >= buckets.e), 0))::float8 AS balance
     FROM buckets, a, after_anchor
     WHERE (buckets.b AT TIME ZONE 'Asia/Karachi') <= now()
     ORDER BY buckets.b`,
    [from, to],
  );
  const anchor = await q(`SELECT 1 FROM app.balance_anchor WHERE id = 1`);
  return anchor.rowCount ? rows : null;
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

/** Records a transfer's bank charge or tax as its own expense ("Bank charges" or "Tax deducted"), dated with the transfer. */
export async function addBankCharge(run: Run, parentId: string, chargesPaisa: number, t: Pick<TransactionInput, "occurredAt" | "counterparty">, accountHint: string | null, bankId: string | null, category = "Bank charges") {
  // The charge is paid to the transfer's bank; with no bank on the transfer, to the first bank in Settings.
  await run(
    `INSERT INTO app.transactions (kind, amount_paisa, occurred_at, category, counterparty, note, source, account_hint, bank_id, parent_id)
     VALUES ('expense',$1,$2,$6,
             coalesce((SELECT name FROM app.banks WHERE id = $5), (SELECT name FROM app.banks ORDER BY position, created_at LIMIT 1), 'Bank'),
             $3,'manual',$4,
             coalesce($5, (SELECT id FROM app.banks ORDER BY position, created_at LIMIT 1)),$7)`,
    [chargesPaisa, t.occurredAt, `${category === "Bank charges" ? "Charges" : "Tax"} on transfer${t.counterparty ? ` to ${t.counterparty}` : ""}`.slice(0, 500), accountHint, bankId, category, parentId],
  );
}

export async function createTransaction(t: TransactionInput, source: "manual" | "sms" = "manual") {
  const { rows } = await withFundCheck(() =>
    q<TxRow>(
      `INSERT INTO app.transactions (kind, amount_paisa, occurred_at, category, counterparty, note, source, set_aside_id, bank_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${TX_COLS}`,
      [t.kind, t.amount, t.occurredAt, t.category, t.counterparty ?? null, t.note ?? null, source, fundOf(t), t.bankId ?? null],
    ),
  );
  return rows[0];
}

/**
 * Sets a transfer's bank charge or tax of one category to `paisa`: changes the charge already added on it,
 * adds one if there was none, and removes it when `paisa` is 0.
 */
async function setBankCharge(run: Run, parent: TxRow, paisa: number, t: TransactionInput, category: string) {
  if (paisa <= 0) {
    await run(`DELETE FROM app.transactions WHERE parent_id=$1 AND category=$2`, [parent.id, category]);
    return;
  }
  const { rows } = await run<{ id: string }>(
    `UPDATE app.transactions SET amount_paisa=$3, updated_at=now()
     WHERE id = (SELECT id FROM app.transactions WHERE parent_id=$1 AND category=$2 ORDER BY created_at LIMIT 1)
     RETURNING id`,
    [parent.id, category, paisa],
  );
  // Two charges of the same kind (added twice before the box showed the first) become the one amount typed.
  if (rows[0]) await run(`DELETE FROM app.transactions WHERE parent_id=$1 AND category=$2 AND id<>$3`, [parent.id, category, rows[0].id]);
  else await addBankCharge(run, parent.id, paisa, t, parent.account_hint, parent.bank_id, category);
}

export async function updateTransaction(id: string, t: TransactionInput, charges: ChargeEdits = {}) {
  return withFundCheck(() => tx(async (run) => {
    const { rows } = await run<TxRow>(
      `UPDATE app.transactions SET kind=$2, amount_paisa=$3, occurred_at=$4, category=$5, counterparty=$6, note=$7, set_aside_id=$8,
              bank_id = CASE WHEN $9::boolean THEN $10::uuid ELSE bank_id END, updated_at=now()
       WHERE id=$1 RETURNING ${TX_COLS}`,
      // A form that doesn't show the bank (one bank only) leaves it as it is.
      [id, t.kind, t.amount, t.occurredAt, t.category, t.counterparty ?? null, t.note ?? null, fundOf(t), t.bankId !== undefined, t.bankId ?? null],
    );
    if (rows[0]) {
      if (charges.fee !== undefined) await setBankCharge(run, rows[0], charges.fee, t, BANK_CHARGES);
      if (charges.tax !== undefined) await setBankCharge(run, rows[0], charges.tax, t, TAX_DEDUCTED);
    }
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
  bank_id: string | null;
};

export async function listReview(space: Space) {
  const { rows } = await q<ReviewRow>(
    `SELECT id, status, reason, redacted_text, sender, received_at, kind, amount_paisa::float8 AS amount_paisa, occurred_at,
            counterparty, category, account_hint, bank_ref, bank_id
     FROM ${sch(space)}.review_items WHERE status='pending' ORDER BY received_at DESC LIMIT 200`,
  );
  return rows;
}

/** Confirms a review item into a real transaction and discards the retained SMS excerpt. */
export async function confirmReview(id: string, t: TransactionInput, chargesPaisa = 0, chargesCategory = "Bank charges") {
  return withFundCheck(() => tx(async (run) => {
    const item = await run<{ id: string; bank_ref: string | null; account_hint: string | null; sms_import_id: string | null; bank_id: string | null }>(
      `SELECT id, bank_ref, account_hint, sms_import_id, bank_id FROM app.review_items WHERE id=$1 AND status='pending' FOR UPDATE`,
      [id],
    );
    if (!item.rows[0]) return null;
    const it = item.rows[0];
    const bankId = t.bankId !== undefined ? t.bankId : it.bank_id;
    const ins = await run<TxRow>(
      `INSERT INTO app.transactions (kind, amount_paisa, occurred_at, category, counterparty, note, source, account_hint, bank_ref, sms_import_id, set_aside_id, bank_id)
       VALUES ($1,$2,$3,$4,$5,$6,'sms',$7,$8,$9,$10,$11)
       ON CONFLICT (bank_ref) WHERE bank_ref IS NOT NULL DO NOTHING
       RETURNING ${TX_COLS}`,
      [t.kind, t.amount, t.occurredAt, t.category, t.counterparty ?? null, t.note ?? null, it.account_hint, it.bank_ref, it.sms_import_id, fundOf(t), bankId],
    );
    if (!ins.rows[0]) return { duplicate: true as const };
    if (chargesPaisa > 0) await addBankCharge(run, ins.rows[0].id, chargesPaisa, t, it.account_hint, bankId, chargesCategory);
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
  purpose: "giving" | "saving";
  forgiven: number;
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
            s.purpose, s.forgiven_paisa::float8 AS forgiven,
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
  return rows.map((r) => ({ ...r, remaining: r.allocated - r.used + r.forgiven }));
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

/** Names that read as charity default to "giving" when no purpose is chosen. */
export const GIVING_NAME = /(allah|charit|sadq|sadaq|zakat|donat|khair|fitr|qurban|masjid|mosque)/i;

export async function createSetAside(v: SetAsideInput) {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO app.set_asides (name, percent_bp, applies_to, starts_on, ended_on, purpose) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [v.name, v.percentBp, v.appliesTo, v.startsOn, v.endedOn ?? null, v.purpose ?? (GIVING_NAME.test(v.name) ? "giving" : "saving")],
  );
  return rows[0].id;
}

export async function updateSetAside(id: string, v: SetAsideInput) {
  const r = await q(
    `UPDATE app.set_asides SET name=$2, percent_bp=$3, applies_to=$4, starts_on=$5, ended_on=$6, purpose=coalesce($7, purpose) WHERE id=$1`,
    [id, v.name, v.percentBp, v.appliesTo, v.startsOn, v.endedOn ?? null, v.purpose ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Forgive the current overpayment so the set-aside starts again from zero. Returns false if not found. */
export async function startSetAsideFresh(id: string) {
  const [row] = (await listSetAsides()).filter((s) => s.id === id);
  if (!row) return false;
  if (row.remaining < 0) {
    await q(`UPDATE app.set_asides SET forgiven_paisa = forgiven_paisa + $2 WHERE id=$1`, [id, Math.round(-row.remaining)]);
  }
  return true;
}

export async function deleteSetAside(id: string) {
  const r = await q(`DELETE FROM app.set_asides WHERE id=$1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ---- Spending check ----
// Compares this month so far with the same days of up to three earlier months. A month only
// counts once records cover it from day 1, so a first, partly recorded month never looks "cheap".

export async function listLimits() {
  const { rows } = await q<{ category: string; limit: number }>(
    `SELECT category, monthly_paisa::float8 AS "limit" FROM app.category_limits ORDER BY category`,
  );
  return rows;
}

export async function setLimit(category: string, monthlyPaisa: number) {
  await q(
    `INSERT INTO app.category_limits (category, monthly_paisa) VALUES ($1, $2)
     ON CONFLICT (category) DO UPDATE SET monthly_paisa = EXCLUDED.monthly_paisa, updated_at = now()`,
    [category, monthlyPaisa],
  );
}

export async function deleteLimit(category: string) {
  const r = await q(`DELETE FROM app.category_limits WHERE category = $1`, [category]);
  return (r.rowCount ?? 0) > 0;
}

export async function spendingCheckData(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const day = Number(today.slice(8, 10));
  const local = `(occurred_at AT TIME ZONE 'Asia/Karachi')`;
  const first = await q<{ first: string | null }>(`SELECT to_char(min(${local}), 'YYYY-MM-DD') AS first FROM app.transactions`);
  // Earliest month start that records fully cover, no more than three months back.
  const f = first.rows[0]?.first;
  let months = 0;
  if (f) {
    const [y, m] = monthStart.split("-").map(Number);
    for (let k = 1; k <= 3; k++) {
      const start = new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 10);
      if (f <= start) months = k;
    }
  }
  const [mtd, base, last30, limits] = await Promise.all([
    q<{ category: string; total: number }>(
      `SELECT category, sum(amount_paisa)::float8 AS total FROM app.transactions
       WHERE kind = 'expense' AND ${NOT_OWN} AND ${RANGE_SQL("$1", "$2")} GROUP BY category`,
      [monthStart, today],
    ),
    months > 0
      ? q<{ category: string; same: number; full: number }>(
          `SELECT category,
                  coalesce(sum(amount_paisa) FILTER (WHERE extract(day FROM ${local}) <= $3), 0)::float8 AS same,
                  sum(amount_paisa)::float8 AS full
           FROM app.transactions
           WHERE kind = 'expense' AND ${NOT_OWN}
             AND occurred_at >= (($1::date - make_interval(months => $2::int))::timestamp AT TIME ZONE 'Asia/Karachi')
             AND occurred_at < ($1::date::timestamp AT TIME ZONE 'Asia/Karachi')
           GROUP BY category`,
          [monthStart, months, day],
        )
      : Promise.resolve({ rows: [] as { category: string; same: number; full: number }[] }),
    q<{ total: number }>(
      `SELECT coalesce(sum(amount_paisa), 0)::float8 AS total FROM app.transactions
       WHERE kind = 'expense' AND ${NOT_OWN} AND ${RANGE_SQL("$1", "$2")}`,
      [addDays(today, -29), today],
    ),
    listLimits(),
  ]);
  const by = <T extends { category: string }>(rows: T[], v: (r: T) => number) => Object.fromEntries(rows.map((r) => [r.category, v(r)]));
  return {
    monthByCategory: by(mtd.rows, (r) => r.total),
    baselineSameDays: by(base.rows, (r) => r.same),
    baselineFull: by(base.rows, (r) => r.full),
    baselineMonths: months,
    last30Expense: last30.rows[0].total,
    limits,
  };
}

// ---- Settings ----

export async function getPrefs() {
  const { rows } = await q<{ value: unknown }>(`SELECT value FROM app.preferences WHERE id = 1`);
  return normalizePrefs(rows[0]?.value);
}

export async function updatePrefs(patch: Partial<Prefs>) {
  const next = { ...(await getPrefs()), ...patch };
  await q(
    `INSERT INTO app.preferences (id, value, updated_at) VALUES (1, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}

// ---- Direction words (all banks) ----

export async function getSmsWords(): Promise<SmsWords> {
  const { rows } = await q<{ value: unknown }>(`SELECT value FROM app.sms_words WHERE id = 1`);
  return normalizeWords(rows[0]?.value);
}

export async function saveSmsWords(words: SmsWords): Promise<SmsWords> {
  await q(
    `INSERT INTO app.sms_words (id, value, updated_at) VALUES (1, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(words)],
  );
  return getSmsWords();
}

// ---- Banks ----

export type BankRow = Bank & { id: string };

export async function listBanks(): Promise<BankRow[]> {
  const { rows } = await q<BankRow>(`SELECT id, name, senders, account_hint, auto_import, hold_transfers FROM app.banks ORDER BY position, created_at`);
  return rows;
}

/**
 * Saves the list in the order given. Rows keep their id, so transactions stay tagged; a bank left out
 * is deleted and its transactions become "no bank".
 */
export async function saveBanks(items: Bank[]): Promise<BankRow[]> {
  await tx(async (run) => {
    const keep = items.map((b) => b.id).filter((x): x is string => !!x);
    await run(`DELETE FROM app.banks WHERE NOT (id = ANY($1::uuid[]))`, [keep]);
    for (const [i, b] of items.entries()) {
      const vals = [i, b.name, b.senders, b.account_hint, b.auto_import, b.hold_transfers];
      const upd = b.id
        ? await run(`UPDATE app.banks SET position=$2, name=$3, senders=$4, account_hint=$5, auto_import=$6, hold_transfers=$7 WHERE id=$1`, [b.id, ...vals])
        : null;
      if (!upd?.rowCount) await run(`INSERT INTO app.banks (position, name, senders, account_hint, auto_import, hold_transfers) VALUES ($1,$2,$3,$4,$5,$6)`, vals);
    }
  });
  return listBanks();
}
