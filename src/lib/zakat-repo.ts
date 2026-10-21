import "server-only";
import { q } from "./db";

// Zakat years: what was worked out as due each Ramadan. Payments are "Zakat" expenses, grouped by the
// Ramadan-to-Ramadan year they fall in.

export const ZAKAT_CATEGORY = "Zakat";

export type ZakatYearRow = { hijri_year: number; assessed_on: string; basis: "silver" | "gold"; wealth_paisa: number; nisab_paisa: number; due_paisa: number };
export type ZakatPaymentRow = { id: string; amount_paisa: number; occurred_at: string; counterparty: string | null };

export async function zakatRecords() {
  const [years, payments] = await Promise.all([
    q<ZakatYearRow>(
      `SELECT hijri_year, to_char(assessed_on, 'YYYY-MM-DD') AS assessed_on, basis,
              wealth_paisa::float8 AS wealth_paisa, nisab_paisa::float8 AS nisab_paisa, due_paisa::float8 AS due_paisa
       FROM app.zakat_years ORDER BY hijri_year DESC`,
    ),
    q<ZakatPaymentRow>(
      `SELECT id, amount_paisa::float8 AS amount_paisa, occurred_at, counterparty FROM app.transactions
       WHERE kind = 'expense' AND category = $1 ORDER BY occurred_at DESC LIMIT 2000`,
      [ZAKAT_CATEGORY],
    ),
  ]);
  return { years: years.rows, payments: payments.rows };
}

export async function saveZakatYear(v: Omit<ZakatYearRow, "assessed_on"> & { assessed_on: string }) {
  await q(
    `INSERT INTO app.zakat_years (hijri_year, assessed_on, basis, wealth_paisa, nisab_paisa, due_paisa)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (hijri_year) DO UPDATE SET assessed_on = EXCLUDED.assessed_on, basis = EXCLUDED.basis,
       wealth_paisa = EXCLUDED.wealth_paisa, nisab_paisa = EXCLUDED.nisab_paisa, due_paisa = EXCLUDED.due_paisa, updated_at = now()`,
    [v.hijri_year, v.assessed_on, v.basis, v.wealth_paisa, v.nisab_paisa, v.due_paisa],
  );
}

export async function deleteZakatYear(hijriYear: number) {
  const { rowCount } = await q(`DELETE FROM app.zakat_years WHERE hijri_year = $1`, [hijriYear]);
  return (rowCount ?? 0) > 0;
}
