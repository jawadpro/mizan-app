import "server-only";
import { z } from "zod";
import { q } from "./db";
import { TAX_DEDUCTED } from "./charges";
import { TREATMENTS, taxYearOf, type IncomeGroup, type Rule } from "./tax";
import { todayPkt } from "./time";

const paisa = z.number().int().min(0).max(99_999_999_999_999);
const rule = z.object({ t: z.enum(TREATMENTS), ratePct: z.number().min(0).max(50).optional() }).strict();
const yearFigures = z.object({ grossSalary: paisa.nullable().optional(), employerTax: paisa.nullable().optional() }).strict();

export const taxSettingsSchema = z.object({
  rules: z.record(z.string().max(80), rule).default({}),
  years: z.record(z.string().regex(/^\d{4}$/), yearFigures).default({}),
});
export type TaxSettings = z.infer<typeof taxSettingsSchema>;

export const taxPatch = z.object({
  rules: z.record(z.string().regex(/^(income|remittance):.{1,60}$/), rule.nullable()).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  grossSalary: paisa.nullable().optional(),
  employerTax: paisa.nullable().optional(),
}).strict();

export async function readTaxSettings(): Promise<TaxSettings> {
  const { rows } = await q<{ value: unknown }>(`SELECT value FROM app.tax_settings WHERE id = 1`);
  const parsed = taxSettingsSchema.safeParse(rows[0]?.value ?? {});
  return parsed.success ? parsed.data : { rules: {}, years: {} };
}

export async function saveTaxSettings(s: TaxSettings) {
  await q(
    `INSERT INTO app.tax_settings (id, value) VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(s)],
  );
}

const bounds = (taxYear: number) => [`${taxYear - 1}-07-01T00:00:00+05:00`, `${taxYear}-07-01T00:00:00+05:00`];

export type IncomeRow = IncomeGroup & { months: number; last_month: string };
export type YearTotals = { incomes: IncomeRow[]; bankTax: number; zakat: number; charity: number };

export async function yearTotals(taxYear: number): Promise<YearTotals> {
  const [from, to] = bounds(taxYear);
  const [inc, out] = await Promise.all([
    q<IncomeRow>(
      `SELECT kind, category, sum(amount_paisa)::float8 AS total, count(*)::int AS count,
              count(DISTINCT to_char(occurred_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM'))::int AS months,
              max(to_char(occurred_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM')) AS last_month
       FROM app.transactions
       WHERE kind IN ('income', 'remittance') AND occurred_at >= $1 AND occurred_at < $2
       GROUP BY kind, category ORDER BY total DESC`,
      [from, to],
    ),
    q<{ category: string; total: number }>(
      `SELECT category, sum(amount_paisa)::float8 AS total FROM app.transactions
       WHERE kind = 'expense' AND category IN ($3, 'Zakat', 'Charity') AND occurred_at >= $1 AND occurred_at < $2
       GROUP BY category`,
      [from, to, TAX_DEDUCTED],
    ),
  ]);
  const sum = (c: string) => out.rows.find((r) => r.category === c)?.total ?? 0;
  return { incomes: inc.rows, bankTax: sum(TAX_DEDUCTED), zakat: sum("Zakat"), charity: sum("Charity") };
}

/** Tax years from the first transaction up to the current one, newest first. */
export async function availableTaxYears(): Promise<number[]> {
  const { rows } = await q<{ first: string | null }>(`SELECT min(occurred_at) AS first FROM app.transactions`);
  const now = taxYearOf(todayPkt());
  const first = rows[0]?.first ? taxYearOf(todayPkt(new Date(rows[0].first))) : now;
  const out: number[] = [];
  for (let y = now; y >= Math.max(first, now - 10); y--) out.push(y);
  return out;
}

export type { Rule };
