// Zakat arithmetic in integer paisa. Nisab is 7.5 tola of gold or 52.5 tola of silver
// (87.48 g / 612.36 g); the user supplies today's price per tola because market prices move daily.

export type NisabBasis = "silver" | "gold";

/** Nisab in tola, kept as a fraction (numerator / 2) so the maths stays integral. */
const NISAB_HALF_TOLA: Record<NisabBasis, number> = { silver: 105, gold: 15 };
export const NISAB_TOLA: Record<NisabBasis, number> = { silver: 52.5, gold: 7.5 };

/** Lunar (Hijri) year used for hawl, in days. */
export const HAWL_DAYS = 354;

export function nisabPaisa(basis: NisabBasis, pricePerTolaPaisa: number): number {
  return Math.floor((pricePerTolaPaisa * NISAB_HALF_TOLA[basis]) / 2);
}

export type ZakatInput = {
  basis: NisabBasis;
  pricePerTolaPaisa: number;
  bankPaisa: number;
  otherAssetsPaisa: number;
  debtsPaisa: number;
};

export type ZakatResult = {
  nisab: number;
  wealth: number;
  eligible: boolean;
  due: number;
  shortBy: number;
};

/** 2.5% of net zakatable wealth, rounded up to the paisa, once wealth reaches nisab. */
export function computeZakat(i: ZakatInput): ZakatResult {
  const nisab = nisabPaisa(i.basis, i.pricePerTolaPaisa);
  const wealth = Math.max(0, i.bankPaisa + i.otherAssetsPaisa - i.debtsPaisa);
  const eligible = nisab > 0 && wealth >= nisab;
  return { nisab, wealth, eligible, due: eligible ? Math.ceil(wealth / 40) : 0, shortBy: eligible ? 0 : Math.max(0, nisab - wealth) };
}

const GRAMS_PER_TROY_OUNCE = 31.1034768;
const GRAMS_PER_TOLA = 11.6638038;

/** Converts an international spot price (USD per troy ounce) to paisa per tola. Null for nonsense input. */
export function tolaPricePaisa(usdPerOunce: number, pkrPerUsd: number): number | null {
  if (!Number.isFinite(usdPerOunce) || !Number.isFinite(pkrPerUsd) || usdPerOunce <= 0 || pkrPerUsd <= 0) return null;
  const paisa = Math.round(usdPerOunce * pkrPerUsd * (GRAMS_PER_TOLA / GRAMS_PER_TROY_OUNCE) * 100);
  return Number.isSafeInteger(paisa) && paisa > 0 ? paisa : null;
}
