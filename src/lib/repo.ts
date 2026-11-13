import "server-only";
import { q, sch, tx, type Space } from "./db";
import type { ListQuery, SetAsideInput, TransactionInput } from "./validation";
import { HttpError } from "./http";
import { OWN_ACCOUNTS, type Kind } from "./categories";
import { addDays } from "./time";
import { normalizePrefs, type Prefs } from "./preferences";
import { normalizeWords, type SmsWords } from "./sms/keywords";
import { bankDigits, MAX_DIGITS, type Bank } from "./banks";
import { BANK_CHARGES, TAX_DEDUCTED, type ChargeEdits } from "./charges";
import { binTransaction } from "./bin";

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
export type ListedTxRow = TxRow & { charge_fee_paisa: number | null; charge_tax_paisa: number | null; split?: { n: number; open: number; total: number } | null; repays?: string | null };

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

/** On a split payment: how many shares, how many are still open and what they add up to. On incoming money: whose share it paid back. */
const SPLIT_COLS = `,
  (SELECT json_build_object('n', count(*), 'total', sum(sp.amount_paisa)::float8,
          'open', count(*) FILTER (WHERE sp.settled_at IS NULL AND coalesce((SELECT sum(x.amount_paisa) FROM app.split_payments pp
            JOIN app.transactions x ON x.id = pp.transaction_id WHERE pp.split_id = sp.id), 0) * 100 < sp.amount_paisa * 98))
     FROM app.splits sp WHERE sp.transaction_id = t.id HAVING count(*) > 0) AS split,
  (SELECT s2.person FROM app.split_payments p2 JOIN app.splits s2 ON s2.id = p2.split_id WHERE p2.transaction_id = t.id) AS repays`;

/** Total of the charges of one category added on the listed transfer `t`, or null when there are none. */
const chargeSum = (s: string, category: string) =>
  `(SELECT sum(c.amount_paisa)::float8 FROM ${s}.transactions c WHERE c.parent_id = t.id AND c.category = '${category}')`;

export async function listTransactions(space: Space, f: ListQuery) {
  const { sql, params } = buildWhere(f);
  const s = sch(space);
  const offset = (f.page - 1) * f.pageSize;
  const [rows, agg] = await Promise.all([
    q<ListedTxRow>(
      `SELECT ${txCols("t.")}, ${chargeSum(s, "Bank charges")} AS charge_fee_paisa, ${chargeSum(s, "Tax deducted")} AS charge_tax_paisa${s === "app" ? SPLIT_COLS : ""}
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
    // One bank's own balance when a bank is picked, every account together otherwise. Cash has none.
    space === "app" && bank !== "none" ? balanceOverTime(from, to, granularity, bank ? bank.replace(/[^0-9a-f-]/gi, "") : undefined) : Promise.resolve(null),
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
 * Bank balance at the end of each bucket, worked back from each account's balance anchor.
 * With S(t) the signed sum of the account's transactions at or after t, its balance at t is
 * anchor + S(anchor time) - S(t), which holds on both sides of the anchor. The accounts are added up,
 * or only `bank` is taken. Returns null until a balance has been set (for that bank).
 */
async function balanceOverTime(from: string, to: string, granularity: "day" | "month" | "year", bank?: string) {
  const step = granularity === "day" ? "1 day" : granularity === "month" ? "1 month" : "1 year";
  const fmt = granularity === "day" ? "YYYY-MM-DD" : granularity === "month" ? "YYYY-MM" : "YYYY";
  await adoptLegacyAnchor();
  const { rows } = await q<{ bucket: string; balance: number }>(
    `WITH ${ANCHORS_SQL},
     sel AS (SELECT * FROM anchors WHERE $3::uuid IS NULL OR bank_id = $3::uuid),
     buckets AS (
       SELECT b, least((b + interval '${step}') AT TIME ZONE 'Asia/Karachi', now()) AS e
       FROM generate_series(date_trunc('${granularity}', $1::date::timestamp), date_trunc('${granularity}', $2::date::timestamp), interval '${step}') AS b
     )
     SELECT to_char(bk.b, '${fmt}') AS bucket, sum(a.amount_paisa + coalesce(x.v, 0))::float8 AS balance
     FROM buckets bk CROSS JOIN sel a CROSS JOIN single s
     LEFT JOIN LATERAL (
       SELECT sum(${SIGNED} * ((t.occurred_at >= a.as_of)::int - (t.occurred_at >= bk.e)::int)) AS v
       FROM app.transactions t WHERE ${MOVES}
     ) x ON true
     WHERE (bk.b AT TIME ZONE 'Asia/Karachi') <= now()
     GROUP BY bk.b
     ORDER BY bk.b`,
    [from, to, bank ?? null],
  );
  return rows.length ? rows : null;
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
             coalesce((SELECT name FROM app.banks WHERE id = $5), (SELECT name FROM app.banks WHERE archived_at IS NULL ORDER BY position, created_at LIMIT 1), 'Bank'),
             $3,'manual',$4,
             coalesce($5, (SELECT id FROM app.banks WHERE archived_at IS NULL ORDER BY position, created_at LIMIT 1)),$7)`,
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

/** Moves a transaction to the recycle bin, where it can be restored for 30 days. */
export async function deleteTransaction(id: string) {
  return binTransaction(id);
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
export async function confirmReview(id: string, t: TransactionInput, chargesPaisa = 0, chargesCategory = "Bank charges", rememberAccount = false) {
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
    // The owner picked the account: save its digits on that bank, so its next alerts go there on their own.
    if (rememberAccount && bankId && it.account_hint) await rememberDigits(run, bankId, it.account_hint);
    await run(
      `UPDATE app.review_items SET status='confirmed', transaction_id=$2, resolved_at=now(), redacted_text=NULL WHERE id=$1`,
      [id, ins.rows[0].id],
    );
    return { transaction: ins.rows[0] };
  }));
}

/** Adds account digits to a bank's saved ones, unless they're there already or it has the most it can hold. */
async function rememberDigits(run: Run, bankId: string, digits: string) {
  const row = await run<{ account_hint: string }>(`SELECT account_hint FROM app.banks WHERE id=$1 FOR UPDATE`, [bankId]);
  if (!row.rows[0]) return;
  const saved = bankDigits(row.rows[0]);
  if (saved.includes(digits) || saved.length >= MAX_DIGITS || !/^\d{3,4}$/.test(digits)) return;
  await run(`UPDATE app.banks SET account_hint=$2 WHERE id=$1`, [bankId, [...saved, digits].join(", ")]);
}

export async function dismissReview(id: string) {
  const r = await q(`UPDATE app.review_items SET status='dismissed', resolved_at=now(), redacted_text=NULL WHERE id=$1 AND status='pending'`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ---- Bank balance ----
// Each bank account has its own balance: the user states it once (the anchor), and every one of that
// account's transactions dated from that minute on moves it: income and remittances add, expenses subtract.
// Editing or deleting those transactions therefore corrects the balance automatically. With one bank, payments
// not tagged with a bank count towards it too; with several, they are cash and move no account. An install
// with no banks keeps a single anchor (app.balance_anchor) that every transaction moves.

export type BalanceRow = { anchor: number; as_of: string; delta: number; n: number; balance: number };
export type AccountBalance = BalanceRow & { bank_id: string };
export type Balances = { total: BalanceRow | null; accounts: AccountBalance[] };

const SIGNED = `CASE WHEN t.kind = 'expense' THEN -t.amount_paisa ELSE t.amount_paisa END`;
/** Every balance anchor: one per bank account, or the single one of an install without banks. */
// A removed (archived) bank's balance is left out; a paused one still counts, as its money is still there.
const ANCHORS_SQL = `single AS (SELECT count(*) = 1 AS v FROM app.banks WHERE archived_at IS NULL),
  anchors AS (
    SELECT bb.bank_id, bb.amount_paisa, date_trunc('minute', bb.as_of) AS as_of
    FROM app.bank_balances bb JOIN app.banks k ON k.id = bb.bank_id AND k.archived_at IS NULL
    UNION ALL
    SELECT NULL::uuid, a.amount_paisa, date_trunc('minute', a.as_of) FROM app.balance_anchor a
    WHERE a.id = 1 AND NOT EXISTS (SELECT 1 FROM app.banks WHERE archived_at IS NULL)
  )`;
/** Whether transaction `t` moves the balance anchored by `a` (with `s` from ANCHORS_SQL). */
const MOVES = `(a.bank_id IS NULL OR t.bank_id = a.bank_id OR (s.v AND t.bank_id IS NULL))`;

/**
 * A balance set before banks were added belongs to the first bank. The old row is left in place (it is ignored
 * once there are banks), so an older deployment on the same database still shows a balance.
 */
async function adoptLegacyAnchor() {
  await q(
    `INSERT INTO app.bank_balances (bank_id, amount_paisa, as_of, updated_at)
     SELECT b.id, a.amount_paisa, a.as_of, a.updated_at
     FROM app.balance_anchor a, (SELECT id FROM app.banks WHERE archived_at IS NULL ORDER BY position, created_at LIMIT 1) b
     WHERE a.id = 1 AND NOT EXISTS (SELECT 1 FROM app.bank_balances)
     ON CONFLICT (bank_id) DO NOTHING`,
  );
}

export async function getBalances(): Promise<Balances> {
  await adoptLegacyAnchor();
  const { rows } = await q<{ bank_id: string | null; anchor: number; as_of: string; delta: number; n: number }>(
    `WITH ${ANCHORS_SQL}
     SELECT a.bank_id, a.amount_paisa::float8 AS anchor, a.as_of,
            coalesce(sum(${SIGNED}), 0)::float8 AS delta, count(t.id)::int AS n
     FROM anchors a CROSS JOIN single s
     LEFT JOIN app.transactions t ON t.occurred_at >= a.as_of AND ${MOVES}
     GROUP BY a.bank_id, a.amount_paisa, a.as_of`,
  );
  const all = rows.map((r) => ({ ...r, balance: r.anchor + r.delta }));
  const total = all.length
    ? all.reduce<BalanceRow>(
        (acc, r) => ({ anchor: acc.anchor + r.anchor, delta: acc.delta + r.delta, n: acc.n + r.n, balance: acc.balance + r.balance, as_of: r.as_of > acc.as_of ? r.as_of : acc.as_of }),
        { anchor: 0, delta: 0, n: 0, balance: 0, as_of: "" },
      )
    : null;
  return { total, accounts: all.filter((r): r is AccountBalance => r.bank_id !== null) };
}

/** The balance of every account together. */
export async function getBalance(): Promise<BalanceRow | null> {
  return (await getBalances()).total;
}

/** Sets the balance of one bank account (or, with no banks, the single balance). One bank is picked for you. */
export async function setBalance(amountPaisa: number, bankId?: string | null) {
  const banks = await q<{ id: string }>(`SELECT id FROM app.banks WHERE archived_at IS NULL ORDER BY position, created_at`);
  if (!banks.rowCount) {
    await q(
      `INSERT INTO app.balance_anchor (id, amount_paisa, as_of, updated_at) VALUES (1, $1, now(), now())
       ON CONFLICT (id) DO UPDATE SET amount_paisa = EXCLUDED.amount_paisa, as_of = EXCLUDED.as_of, updated_at = now()`,
      [amountPaisa],
    );
    return;
  }
  const id = bankId ?? (banks.rowCount === 1 ? banks.rows[0].id : null);
  if (!id) throw new HttpError(400, "Choose which account this balance is for", { fields: { bank: ["Choose an account"] } });
  if (!banks.rows.some((b) => b.id === id)) throw new HttpError(400, "That account no longer exists", { fields: { bank: ["Choose another account"] } });
  await adoptLegacyAnchor();
  await q(
    `INSERT INTO app.bank_balances (bank_id, amount_paisa, as_of, updated_at) VALUES ($1, $2, now(), now())
     ON CONFLICT (bank_id) DO UPDATE SET amount_paisa = EXCLUDED.amount_paisa, as_of = EXCLUDED.as_of, updated_at = now()`,
    [id, amountPaisa],
  );
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
  /** The bank whose incoming money fills it; null for all banks. */
  bank_id: string | null;
  forgiven: number;
  allocated: number;
  sources: number;
  used: number;
  remaining: number;
};

const MATCHES = `t.category <> '${OWN_ACCOUNTS}' AND ((s.applies_to = 'incoming' AND t.kind IN ('income', 'remittance')) OR t.kind = s.applies_to)
  AND t.occurred_at >= (s.starts_on::timestamp AT TIME ZONE 'Asia/Karachi')
  AND (s.ended_on IS NULL OR t.occurred_at < ((s.ended_on + 1)::timestamp AT TIME ZONE 'Asia/Karachi'))
  AND (s.bank_id IS NULL OR t.bank_id = s.bank_id)`;

export async function listSetAsides(): Promise<SetAsideRow[]> {
  const { rows } = await q<Omit<SetAsideRow, "remaining">>(
    `SELECT s.id, s.name, s.percent_bp, s.applies_to, to_char(s.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(s.ended_on, 'YYYY-MM-DD') AS ended_on,
            s.purpose, s.bank_id, s.forgiven_paisa::float8 AS forgiven,
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

/** A set-aside linked to a bank that was removed meanwhile. */
async function savingSetAside<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string })?.code === "23503") throw new HttpError(400, "That bank no longer exists", { fields: { bankId: ["Choose another bank"] } });
    throw e;
  }
}

export async function createSetAside(v: SetAsideInput) {
  const { rows } = await savingSetAside(() =>
    q<{ id: string }>(
      `INSERT INTO app.set_asides (name, percent_bp, applies_to, starts_on, ended_on, purpose, bank_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [v.name, v.percentBp, v.appliesTo, v.startsOn, v.endedOn ?? null, v.purpose ?? (GIVING_NAME.test(v.name) ? "giving" : "saving"), v.bankId ?? null],
    ),
  );
  return rows[0].id;
}

/** Left out, the purpose and bank stay as they were (pausing sends neither). */
export async function updateSetAside(id: string, v: SetAsideInput) {
  const r = await savingSetAside(() =>
    q(
      `UPDATE app.set_asides SET name=$2, percent_bp=$3, applies_to=$4, starts_on=$5, ended_on=$6, purpose=coalesce($7, purpose),
              bank_id = CASE WHEN $8::boolean THEN $9::uuid ELSE bank_id END
       WHERE id=$1`,
      [id, v.name, v.percentBp, v.appliesTo, v.startsOn, v.endedOn ?? null, v.purpose ?? null, v.bankId !== undefined, v.bankId ?? null],
    ),
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

/** Limits a query to one bank's transactions: `param` holds "", "none" (cash) or a bank id. */
const ONE_BANK = (param: string) => `(${param}::text = '' OR (${param}::text = 'none' AND bank_id IS NULL) OR bank_id::text = ${param}::text)`;

/**
 * Totals for the savings plan: whole months the records fully cover (up to six), this month so far, and monthly
 * payments. With a bank ("none" for cash), only that bank's transactions count, and monthly payments are left out
 * because they aren't tied to a bank.
 */
export async function savingsData(today: string, bank = "") {
  const monthStart = `${today.slice(0, 8)}01`;
  const local = `(occurred_at AT TIME ZONE 'Asia/Karachi')`;
  const first = await q<{ first: string | null }>(`SELECT to_char(min(${local}), 'YYYY-MM-DD') AS first FROM app.transactions WHERE ${ONE_BANK("$1")}`, [bank]);
  const f = first.rows[0]?.first;
  let months = 0;
  if (f) {
    const [y, m] = monthStart.split("-").map(Number);
    for (let k = 1; k <= 6; k++) {
      const start = new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 10);
      if (f <= start) months = k;
    }
  }
  const [totals, recurring] = await Promise.all([
    q<{ month: string; kind: Kind; category: string; total: number }>(
      `SELECT to_char(${local}, 'YYYY-MM') AS month, kind, category, sum(amount_paisa)::float8 AS total
       FROM app.transactions
       WHERE ${NOT_OWN} AND ${ONE_BANK("$4")}
         AND occurred_at >= (($1::date - make_interval(months => $2::int))::timestamp AT TIME ZONE 'Asia/Karachi')
         AND occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Karachi')
       GROUP BY 1, 2, 3`,
      [monthStart, months, today, bank],
    ),
    bank
      ? Promise.resolve({ rows: [] as { name: string; amount: number | null; category: string }[] })
      : q<{ name: string; amount: number | null; category: string }>(
      `SELECT name, amount_paisa::float8 AS amount, category FROM app.monthly_items
       WHERE starts_month <= $1::date AND (ended_month IS NULL OR ended_month >= $1::date)`,
      [monthStart],
    ),
  ]);
  const blank = () => ({ income: 0, byCategory: {} as Record<string, number> });
  const by = new Map<string, ReturnType<typeof blank>>();
  for (const r of totals.rows) {
    const m = by.get(r.month) ?? blank();
    if (r.kind === "expense") m.byCategory[r.category] = (m.byCategory[r.category] ?? 0) + r.total;
    else m.income += r.total;
    by.set(r.month, m);
  }
  const thisKey = today.slice(0, 7);
  const list = [];
  const [y, mo] = monthStart.split("-").map(Number);
  for (let k = months; k >= 1; k--) {
    const key = new Date(Date.UTC(y, mo - 1 - k, 1)).toISOString().slice(0, 7);
    list.push({ month: key, ...(by.get(key) ?? blank()) });
  }
  return { months: list, thisMonth: by.get(thisKey) ?? blank(), recurring: recurring.rows };
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

/** The banks in use (paused ones included), in order. Removed banks are left out. */
export async function listBanks(): Promise<BankRow[]> {
  const { rows } = await q<BankRow>(
    `SELECT id, name, senders, account_hint, auto_import, hold_transfers, active FROM app.banks WHERE archived_at IS NULL ORDER BY position, created_at`,
  );
  return rows;
}

const RECORDS = `((SELECT count(*) FROM app.transactions t WHERE t.bank_id = b.id) + (SELECT count(*) FROM app.review_items r WHERE r.bank_id = b.id AND r.status = 'pending'))::int`;

export type BankWithRecords = BankRow & { records: number };
export type RemovedBank = { id: string; name: string; account_hint: string; records: number; archived_at: string };

/** Banks in use and removed ones, each with how many transactions (and alerts waiting in Review) carry it. */
export async function listBanksWithRecords(): Promise<{ items: BankWithRecords[]; removed: RemovedBank[] }> {
  const { rows } = await q<BankWithRecords & { archived_at: string | null }>(
    `SELECT b.id, b.name, b.senders, b.account_hint, b.auto_import, b.hold_transfers, b.active, b.archived_at, ${RECORDS} AS records
     FROM app.banks b ORDER BY b.position, b.created_at`,
  );
  return {
    items: rows.filter((r) => !r.archived_at).map(({ archived_at: _a, ...r }) => r),
    removed: rows.filter((r) => r.archived_at).map((r) => ({ id: r.id, name: r.name, account_hint: r.account_hint, records: r.records, archived_at: r.archived_at! })),
  };
}

/**
 * Saves the list in the order given. Rows keep their id, so transactions stay tagged. A bank left out is
 * deleted only when nothing carries it; one with transactions or alerts in Review is removed from sight instead
 * (kept, with its history, until it is restored or deleted for good).
 */
export async function saveBanks(items: Bank[]) {
  await tx(async (run) => {
    const keep = items.map((b) => b.id).filter((x): x is string => !!x);
    const gone = `archived_at IS NULL AND NOT (id = ANY($1::uuid[]))`;
    const used = `(EXISTS (SELECT 1 FROM app.transactions t WHERE t.bank_id = app.banks.id) OR EXISTS (SELECT 1 FROM app.review_items r WHERE r.bank_id = app.banks.id AND r.status = 'pending'))`;
    await run(`UPDATE app.banks SET archived_at = now() WHERE ${gone} AND ${used}`, [keep]);
    await run(`DELETE FROM app.banks WHERE ${gone} AND NOT ${used}`, [keep]);
    for (const [i, b] of items.entries()) {
      const vals = [i, b.name, b.senders, b.account_hint, b.auto_import, b.hold_transfers, b.active ?? true];
      const upd = b.id
        ? await run(`UPDATE app.banks SET position=$2, name=$3, senders=$4, account_hint=$5, auto_import=$6, hold_transfers=$7, active=$8 WHERE id=$1 AND archived_at IS NULL`, [b.id, ...vals])
        : null;
      if (!upd?.rowCount) await run(`INSERT INTO app.banks (position, name, senders, account_hint, auto_import, hold_transfers, active) VALUES ($1,$2,$3,$4,$5,$6,$7)`, vals);
    }
  });
  return listBanksWithRecords();
}

/** Brings a removed bank back, at the end of the list, with its history and balance. */
export async function restoreBank(id: string) {
  const r = await q(
    `UPDATE app.banks SET archived_at = NULL, position = (SELECT coalesce(max(position), -1) + 1 FROM app.banks WHERE archived_at IS NULL)
     WHERE id = $1 AND archived_at IS NOT NULL`,
    [id],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Deletes a removed bank for good, once its name is typed back. Its transactions stay, without a bank. */
export async function deleteBankForGood(id: string, typedName: string) {
  const row = await q<{ name: string }>(`SELECT name FROM app.banks WHERE id = $1 AND archived_at IS NOT NULL`, [id]);
  const name = row.rows[0]?.name;
  if (!name) return false;
  if (typedName.trim().toLowerCase() !== name.trim().toLowerCase()) throw new HttpError(400, `Type ${name} to delete it for good`, { fields: { confirm: [`Type ${name}`] } });
  await q(`DELETE FROM app.banks WHERE id = $1 AND archived_at IS NOT NULL`, [id]);
  return true;
}
