import "server-only";
import { q, tx } from "./db";
import { HttpError } from "./http";

/** How long a deleted transaction waits in the recycle bin before it is gone for good. */
export const BIN_DAYS = 30;

export type BinRow = {
  id: string;
  kind: string;
  amount_paisa: number;
  occurred_at: string;
  category: string;
  counterparty: string | null;
  note: string | null;
  bank_id: string | null;
  deleted_at: string;
};

type Links = {
  splits?: unknown[];
  split_payments?: unknown[];
  monthly?: unknown[];
  children?: string[];
};

/**
 * Moves a transaction to the recycle bin: the row is kept as it was, with what was linked to it, and taken out
 * of the list and totals. The charges under a transfer stay where they are, as before.
 */
export async function binTransaction(id: string): Promise<boolean> {
  return tx(async (run) => {
    const { rows } = await run<{ row: Record<string, unknown> }>(`SELECT to_jsonb(t) AS row FROM app.transactions t WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) return false;
    const { rows: l } = await run<Links>(
      `SELECT
         (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]') FROM app.splits s WHERE s.transaction_id = $1) AS splits,
         (SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]') FROM app.split_payments p
            WHERE p.transaction_id = $1 OR p.split_id IN (SELECT id FROM app.splits WHERE transaction_id = $1)) AS split_payments,
         (SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]') FROM app.monthly_mark_txs m WHERE m.transaction_id = $1) AS monthly,
         (SELECT coalesce(jsonb_agg(c.id), '[]') FROM app.transactions c WHERE c.parent_id = $1) AS children`,
      [id],
    );
    await run(
      `INSERT INTO app.transaction_bin (id, row, links) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET row = EXCLUDED.row, links = EXCLUDED.links, deleted_at = now()`,
      [id, rows[0].row, l[0]],
    );
    await run(`DELETE FROM app.transactions WHERE id = $1`, [id]);
    return true;
  });
}

export async function listBin(): Promise<BinRow[]> {
  await q(`DELETE FROM app.transaction_bin WHERE deleted_at < now() - make_interval(days => $1)`, [BIN_DAYS]);
  const { rows } = await q<BinRow>(
    `SELECT id, row->>'kind' AS kind, (row->>'amount_paisa')::float8 AS amount_paisa, row->>'occurred_at' AS occurred_at,
            row->>'category' AS category, row->>'counterparty' AS counterparty, row->>'note' AS note, row->>'bank_id' AS bank_id, deleted_at
     FROM app.transaction_bin ORDER BY deleted_at DESC LIMIT 500`,
  );
  return rows;
}

/** Puts a transaction back as it was. Links to things deleted since (a bank, a set-aside, a split) are left off. */
export async function restoreTransaction(id: string): Promise<boolean> {
  try {
    return await tx(async (run) => {
      const { rows } = await run<{ row: Record<string, unknown>; links: Links }>(`SELECT row, links FROM app.transaction_bin WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows[0]) return false;
      const { row, links } = rows[0];
      await run(
        `INSERT INTO app.transactions
         SELECT (r).* FROM (SELECT jsonb_populate_record(NULL::app.transactions,
           $1::jsonb
           || jsonb_build_object('bank_id', (SELECT id FROM app.banks WHERE id = ($1::jsonb->>'bank_id')::uuid))
           || jsonb_build_object('set_aside_id', (SELECT id FROM app.set_asides WHERE id = ($1::jsonb->>'set_aside_id')::uuid))
           || jsonb_build_object('parent_id', (SELECT id FROM app.transactions WHERE id = ($1::jsonb->>'parent_id')::uuid))
           || jsonb_build_object('updated_at', now())) AS r) x`,
        [row],
      );
      await run(`INSERT INTO app.splits SELECT * FROM jsonb_populate_recordset(NULL::app.splits, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(links.splits ?? [])]);
      await run(
        `INSERT INTO app.split_payments
         SELECT p.* FROM jsonb_populate_recordset(NULL::app.split_payments, $1::jsonb) p
         WHERE EXISTS (SELECT 1 FROM app.splits s WHERE s.id = p.split_id) AND EXISTS (SELECT 1 FROM app.transactions t WHERE t.id = p.transaction_id)
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(links.split_payments ?? [])],
      );
      await run(
        `INSERT INTO app.monthly_mark_txs
         SELECT m.* FROM jsonb_populate_recordset(NULL::app.monthly_mark_txs, $1::jsonb) m
         WHERE EXISTS (SELECT 1 FROM app.monthly_marks k WHERE k.item_id = m.item_id AND k.month = m.month)
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(links.monthly ?? [])],
      );
      if (links.children?.length) {
        await run(`UPDATE app.transactions SET parent_id = $1 WHERE id = ANY($2::uuid[]) AND parent_id IS NULL`, [id, links.children]);
      }
      await run(`DELETE FROM app.transaction_bin WHERE id = $1`, [id]);
      return true;
    });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "23505") throw new HttpError(409, "This transaction is already back in your list (the same bank message was added again).");
    throw e;
  }
}

/** Deletes one transaction in the bin for good, or all of them when no id is given. */
export async function purgeBin(id?: string): Promise<number> {
  const r = id ? await q(`DELETE FROM app.transaction_bin WHERE id = $1`, [id]) : await q(`DELETE FROM app.transaction_bin`);
  return r.rowCount ?? 0;
}
