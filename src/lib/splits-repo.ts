import "server-only";
import { q, tx } from "./db";
import { showsForBank } from "./banks";
import { getPrefs } from "./repo";
import { isPaidBack, rankFor, suggestShares, type InTx } from "./splits";

export type SplitPayment = InTx & { kind: string };
/** bank_id: the bank the payment went out of, which is the bank its shares belong to; null for cash. */
export type Bill = { id: string; amount_paisa: number; occurred_at: string; category: string; counterparty: string | null; note: string | null; bank_id: string | null };
export type ShareRow = {
  id: string;
  transaction_id: string;
  person: string;
  amount_paisa: number;
  note: string | null;
  settled_at: string | null;
  settled_note: string | null;
  created_at: string;
  bill: Bill;
  /** How many shares the bill was split into (not counting the owner's own part). */
  shares_on_bill: number;
  /** The total of every share on the bill, so the owner's part is bill − this. */
  shared_total: number;
  payments: SplitPayment[];
};
export type Share = ShareRow & { paid: number; state: "open" | "settled"; settled_on: string | null };
export type ShareInput = { person: string; amount: number; note: string | null };

const SHARE_SQL = `
  SELECT s.id, s.transaction_id, s.person, s.amount_paisa::float8 AS amount_paisa, s.note, s.settled_at, s.settled_note, s.created_at,
         json_build_object('id', b.id, 'amount_paisa', b.amount_paisa::float8, 'occurred_at', b.occurred_at, 'category', b.category,
                           'counterparty', b.counterparty, 'note', b.note, 'bank_id', b.bank_id) AS bill,
         (SELECT count(*) FROM app.splits o WHERE o.transaction_id = s.transaction_id)::int AS shares_on_bill,
         (SELECT sum(o.amount_paisa) FROM app.splits o WHERE o.transaction_id = s.transaction_id)::float8 AS shared_total,
         coalesce((SELECT json_agg(json_build_object('id', t.id, 'kind', t.kind, 'amount_paisa', t.amount_paisa::float8, 'occurred_at', t.occurred_at,
                                                     'counterparty', t.counterparty, 'note', t.note) ORDER BY t.occurred_at)
                   FROM app.split_payments p JOIN app.transactions t ON t.id = p.transaction_id WHERE p.split_id = s.id), '[]'::json) AS payments
  FROM app.splits s JOIN app.transactions b ON b.id = s.transaction_id`;

function finish(r: ShareRow): Share {
  const paid = r.payments.reduce((a, p) => a + p.amount_paisa, 0);
  const done = isPaidBack(r.amount_paisa, paid, !!r.settled_at);
  const last = r.payments.at(-1)?.occurred_at ?? null;
  return { ...r, paid, state: done ? "settled" : "open", settled_on: done ? r.settled_at ?? last : null };
}

/** Incoming money not yet linked to any share, newest first. */
async function incoming(search?: string, since?: string) {
  const params: unknown[] = [];
  const conds = [`t.kind IN ('income', 'remittance')`, `NOT EXISTS (SELECT 1 FROM app.split_payments p WHERE p.transaction_id = t.id)`];
  if (since) {
    params.push(since);
    conds.push(`t.occurred_at >= $${params.length}::timestamptz - interval '1 day'`);
  }
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = params.length;
    const or = [`t.counterparty ILIKE $${n}`, `t.note ILIKE $${n}`];
    const digits = search.replace(/[,\s]/g, "");
    if (/^\d+(\.\d{1,2})?$/.test(digits)) {
      const [w, fr = ""] = digits.split(".");
      params.push(Number(w) * 100 + Number(fr.padEnd(2, "0")));
      or.push(`t.amount_paisa = $${params.length}`);
    }
    conds.push(`(${or.join(" OR ")})`);
  }
  const { rows } = await q<InTx>(
    `SELECT t.id, t.amount_paisa::float8 AS amount_paisa, t.occurred_at, t.counterparty, t.note FROM app.transactions t
     WHERE ${conds.join(" AND ")} ORDER BY t.occurred_at DESC LIMIT 300`,
    params,
  );
  return rows;
}

/**
 * Every open share with a likely repayment, and the shares settled in the last 60 days. With a bank picked
 * ("none" for cash), only shares on payments from that bank, plus those on cash payments, which belong to no bank.
 */
export async function listSplits(bank = "") {
  const { rows } = await q<ShareRow>(`${SHARE_SQL} ORDER BY b.occurred_at DESC, s.created_at`);
  const all = rows.map(finish).filter((s) => showsForBank(s.bill.bank_id, bank));
  const open = all.filter((s) => s.state === "open");
  const cutoff = Date.now() - 60 * 86400e3;
  const settled = all
    .filter((s) => s.state === "settled" && Date.parse(s.settled_on ?? s.created_at) >= cutoff)
    .sort((a, b) => Date.parse(b.settled_on ?? "") - Date.parse(a.settled_on ?? ""));
  let suggestions = new Map<string, InTx & { score: number }>();
  if (open.length) {
    const oldest = open.reduce((m, s) => (s.bill.occurred_at < m ? s.bill.occurred_at : m), open[0].bill.occurred_at);
    const cands = await incoming(undefined, oldest);
    suggestions = suggestShares(open.map((s) => ({ ...s, bill_at: s.bill.occurred_at })), cands);
  }
  const owed = open.reduce((a, s) => a + s.amount_paisa - Math.min(s.paid, s.amount_paisa), 0);
  return {
    owed,
    open: open.map((s) => ({ ...s, suggestion: suggestions.get(s.id) ?? null })),
    settled,
    settledCount: all.length - open.length,
  };
}

/** The shares on one payment, for its split form. */
export async function splitsForBill(transactionId: string) {
  const { rows: bill } = await q<Bill & { kind: string; parent_id: string | null }>(
    `SELECT id, kind, parent_id, amount_paisa::float8 AS amount_paisa, occurred_at, category, counterparty, note, bank_id FROM app.transactions WHERE id = $1`,
    [transactionId],
  );
  if (!bill.length) return null;
  const { rows } = await q<ShareRow>(`${SHARE_SQL} WHERE s.transaction_id = $1 ORDER BY s.created_at`, [transactionId]);
  return { bill: bill[0], shares: rows.map(finish) };
}

/** Everyone a bill has been split with before, most recent first, for picking names. */
export async function splitPeople() {
  const { rows } = await q<{ person: string }>(
    `SELECT person FROM (SELECT DISTINCT ON (lower(person)) person, created_at FROM app.splits ORDER BY lower(person), created_at DESC) p
     ORDER BY created_at DESC LIMIT 200`,
  );
  return rows.map((r) => r.person);
}

export async function getShare(id: string) {
  const { rows } = await q<ShareRow>(`${SHARE_SQL} WHERE s.id = $1`, [id]);
  return rows[0] ? finish(rows[0]) : null;
}

type Err = "no-bill" | "not-expense" | "too-much";

/** Adds shares to a payment. They may add up to the whole payment (paid entirely for others) but not more. */
export async function addShares(transactionId: string, shares: ShareInput[]): Promise<{ ids: string[] } | { error: Err; left?: number }> {
  return tx(async (run) => {
    const { rows: b } = await run<{ kind: string; amount_paisa: number }>(
      `SELECT kind, amount_paisa::float8 AS amount_paisa FROM app.transactions WHERE id = $1 FOR UPDATE`,
      [transactionId],
    );
    if (!b.length) return { error: "no-bill" as const };
    if (b[0].kind !== "expense") return { error: "not-expense" as const };
    const { rows: [{ total }] } = await run<{ total: number }>(
      `SELECT coalesce(sum(amount_paisa), 0)::float8 AS total FROM app.splits WHERE transaction_id = $1`,
      [transactionId],
    );
    const adding = shares.reduce((a, s) => a + s.amount, 0);
    if (total + adding > b[0].amount_paisa) return { error: "too-much" as const, left: b[0].amount_paisa - total };
    const ids: string[] = [];
    for (const s of shares) {
      const { rows } = await run<{ id: string }>(
        `INSERT INTO app.splits (transaction_id, person, amount_paisa, note) VALUES ($1, $2, $3, $4) RETURNING id`,
        [transactionId, s.person, s.amount, s.note],
      );
      ids.push(rows[0].id);
    }
    return { ids };
  });
}

export async function updateShare(id: string, s: ShareInput): Promise<"ok" | "missing" | { error: "too-much"; left: number }> {
  return tx(async (run) => {
    const { rows } = await run<{ transaction_id: string }>(`SELECT transaction_id FROM app.splits WHERE id = $1`, [id]);
    if (!rows.length) return "missing" as const;
    const { rows: [b] } = await run<{ amount_paisa: number; others: number }>(
      `SELECT t.amount_paisa::float8 AS amount_paisa,
              (SELECT coalesce(sum(o.amount_paisa), 0) FROM app.splits o WHERE o.transaction_id = t.id AND o.id <> $2)::float8 AS others
       FROM app.transactions t WHERE t.id = $1 FOR UPDATE`,
      [rows[0].transaction_id, id],
    );
    if (b.others + s.amount > b.amount_paisa) return { error: "too-much" as const, left: b.amount_paisa - b.others };
    await run(`UPDATE app.splits SET person = $2, amount_paisa = $3, note = $4 WHERE id = $1`, [id, s.person, s.amount, s.note]);
    return "ok" as const;
  });
}

export async function deleteShare(id: string) {
  const { rowCount } = await q(`DELETE FROM app.splits WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/** Links incoming money to a share as (part of) its repayment. */
export async function linkPayment(id: string, transactionId: string): Promise<"ok" | "missing" | "no-transaction" | "not-incoming" | "taken"> {
  const { rows: share } = await q(`SELECT 1 FROM app.splits WHERE id = $1`, [id]);
  if (!share.length) return "missing";
  const { rows: t } = await q<{ kind: string; taken: string | null }>(
    `SELECT kind, (SELECT split_id FROM app.split_payments p WHERE p.transaction_id = t.id)::text AS taken FROM app.transactions t WHERE id = $1`,
    [transactionId],
  );
  if (!t.length) return "no-transaction";
  if (t[0].kind === "expense") return "not-incoming";
  if (t[0].taken && t[0].taken !== id) return "taken";
  await q(`INSERT INTO app.split_payments (split_id, transaction_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, transactionId]);
  return "ok";
}

export async function unlinkPayment(id: string, transactionId: string) {
  const { rowCount } = await q(`DELETE FROM app.split_payments WHERE split_id = $1 AND transaction_id = $2`, [id, transactionId]);
  return (rowCount ?? 0) > 0;
}

/** Settles a share by hand (cash, or let off), or reopens one settled by hand. */
export async function settleShare(id: string, settled: boolean, note: string | null) {
  const { rowCount } = await q(
    settled ? `UPDATE app.splits SET settled_at = now(), settled_note = $2 WHERE id = $1` : `UPDATE app.splits SET settled_at = NULL, settled_note = NULL WHERE id = $1`,
    settled ? [id, note] : [id],
  );
  return (rowCount ?? 0) > 0;
}

/** Incoming money to pick from when linking a repayment, best guesses first. */
export async function shareMatches(id: string, search?: string) {
  const s = await getShare(id);
  if (!s) return null;
  const txs = await incoming(search, search ? undefined : s.bill.occurred_at);
  return rankFor({ ...s, bill_at: s.bill.occurred_at }, txs).slice(0, 40);
}

/** The owner's name as the bank prints it, tidied up ("MUHAMMAD JAWAD" → "Muhammad Jawad"), for receipts. */
export async function ownerName() {
  const first = (await getPrefs().catch(() => null))?.ownNames.split(",")[0].trim() ?? "";
  return first ? first.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase()) : null;
}
