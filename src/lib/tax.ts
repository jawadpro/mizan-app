// Pakistan income tax estimate for one FBR tax year (1 July to 30 June), in integer paisa.
// "Tax Year 2027" is the year that ends on 30 June 2027. Slabs are data: a new budget is a new entry here.
// This is an estimate to help with filing, not tax advice.

export type Slab = { from: number; fixed: number; rate: number }; // rupees, rupees, fraction
export type SlabTable = { salaried: Slab[]; other: Slab[]; surchargeOver?: number; salariedSurcharge?: number; otherSurcharge?: number; source: string };

// Non-salaried individuals: unchanged since the Finance Act 2024.
const OTHER_SINCE_2025: Slab[] = [
  { from: 0, fixed: 0, rate: 0 },
  { from: 600_000, fixed: 0, rate: 0.15 },
  { from: 1_200_000, fixed: 90_000, rate: 0.2 },
  { from: 1_600_000, fixed: 170_000, rate: 0.3 },
  { from: 3_200_000, fixed: 650_000, rate: 0.4 },
  { from: 5_600_000, fixed: 1_610_000, rate: 0.45 },
];

export const SLABS: Record<number, SlabTable> = {
  2026: {
    source: "Finance Act 2025",
    salaried: [
      { from: 0, fixed: 0, rate: 0 },
      { from: 600_000, fixed: 0, rate: 0.01 },
      { from: 1_200_000, fixed: 6_000, rate: 0.11 },
      { from: 2_200_000, fixed: 116_000, rate: 0.23 },
      { from: 3_200_000, fixed: 346_000, rate: 0.3 },
      { from: 4_100_000, fixed: 616_000, rate: 0.35 },
    ],
    other: OTHER_SINCE_2025,
    surchargeOver: 10_000_000,
    salariedSurcharge: 0.09,
    otherSurcharge: 0.1,
  },
  2027: {
    source: "Finance Act 2026",
    salaried: [
      { from: 0, fixed: 0, rate: 0 },
      { from: 600_000, fixed: 0, rate: 0.01 },
      { from: 1_200_000, fixed: 6_000, rate: 0.11 },
      { from: 2_200_000, fixed: 116_000, rate: 0.2 },
      { from: 3_200_000, fixed: 316_000, rate: 0.25 },
      { from: 4_100_000, fixed: 541_000, rate: 0.29 },
      { from: 5_600_000, fixed: 976_000, rate: 0.32 },
      { from: 7_000_000, fixed: 1_424_000, rate: 0.35 },
    ],
    other: OTHER_SINCE_2025,
  },
};

const KNOWN = Object.keys(SLABS).map(Number).sort((a, b) => a - b);

/** The slabs for a tax year; years without published slabs use the nearest known year and say so. */
export function slabsFor(taxYear: number): { table: SlabTable; year: number; assumed: boolean } {
  if (SLABS[taxYear]) return { table: SLABS[taxYear], year: taxYear, assumed: false };
  const year = taxYear > KNOWN[KNOWN.length - 1] ? KNOWN[KNOWN.length - 1] : KNOWN[0];
  return { table: SLABS[year], year, assumed: true };
}

/** Tax year that a PKT calendar date (YYYY-MM-DD) falls in: July onwards belongs to next year's tax year. */
export function taxYearOf(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return m >= 7 ? y + 1 : y;
}

export function taxYearRange(taxYear: number): { start: string; end: string } {
  return { start: `${taxYear - 1}-07-01`, end: `${taxYear}-06-30` };
}

export function taxYearLabel(taxYear: number): string {
  return `July ${taxYear - 1} to June ${taxYear}`;
}

/** Tax on an annual income using one slab list, in paisa. */
export function slabTax(incomePaisa: number, slabs: Slab[], surchargeOver?: number, surcharge?: number): number {
  if (incomePaisa <= 0) return 0;
  let s = slabs[0];
  for (const x of slabs) if (incomePaisa > x.from * 100) s = x;
  let tax = s.fixed * 100 + (incomePaisa - s.from * 100) * s.rate;
  if (surchargeOver && surcharge && incomePaisa > surchargeOver * 100) tax *= 1 + surcharge;
  return Math.round(tax);
}

export function salaryTax(grossPaisa: number, taxYear: number): number {
  const { table } = slabsFor(taxYear);
  return slabTax(grossPaisa, table.salaried, table.surchargeOver, table.salariedSurcharge);
}

/**
 * Works back from take-home salary to gross salary, assuming the employer deducted tax by the slabs.
 * Take-home rises with gross at every income (no slab takes 100%), so a binary search finds it.
 */
export function grossFromNet(netPaisa: number, taxYear: number): { gross: number; tax: number } {
  if (netPaisa <= 0) return { gross: 0, tax: 0 };
  let lo = netPaisa;
  let hi = netPaisa * 3;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid - salaryTax(mid, taxYear) < netPaisa) lo = mid;
    else hi = mid;
  }
  return { gross: hi, tax: salaryTax(hi, taxYear) };
}

// ---- How each income category is taxed ----

export const TREATMENTS = ["salary", "slab", "fixed", "at_source", "exempt", "ignore", "ask"] as const;
export type Treatment = (typeof TREATMENTS)[number];

export const TREATMENT_LABEL: Record<Treatment, string> = {
  salary: "Salary (taxed by slabs, employer deducts)",
  slab: "Other taxable income (added to slabs)",
  fixed: "Fixed rate, deducted by the bank",
  at_source: "Already taxed by the bank",
  exempt: "Not taxed",
  ignore: "Not income (leave out)",
  ask: "Not sure yet",
};

export type Rule = { t: Treatment; ratePct?: number };

/** Sensible starting rules. Foreign freelance payments through a bank are usually taxed at 1% (0.25% if PSEB registered). */
export function defaultRule(kind: string, category: string): Rule {
  if (kind === "remittance") return category === "Uncategorized" ? { t: "ask" } : { t: "exempt" };
  switch (category) {
    case "Salary": return { t: "salary" };
    case "Freelance": return { t: "fixed", ratePct: 1 };
    case "Business": return { t: "slab" };
    case "Profit": return { t: "at_source" };
    case "Refund":
    case "Own accounts": return { t: "ignore" };
    default: return { t: "ask" };
  }
}

export const ruleKey = (kind: string, category: string) => `${kind}:${category}`;

// ---- The year's estimate ----

export type IncomeGroup = { kind: string; category: string; total: number; count: number };

export type TaxInput = {
  taxYear: number;
  today: string;
  incomes: IncomeGroup[];
  /** Months that had any salary credit so far. */
  salaryMonths: number;
  /** Whether this month's salary has already arrived, so it isn't counted again in the projection. */
  salaryThisMonth?: boolean;
  rules: Record<string, Rule>;
  /** Tax the bank cut and the owner logged as "Tax deducted". */
  bankTaxDeducted: number;
  zakatPaid: number;
  charityPaid: number;
  /** Owner's own figures from the salary slip or employer certificate, for the whole year. */
  grossSalaryOverride?: number | null;
  employerTaxOverride?: number | null;
};

export type TaxLine = IncomeGroup & { rule: Rule; tax: number; note: string };

export type TaxResult = {
  taxYear: number;
  label: string;
  slabsYear: number;
  slabsAssumed: boolean;
  slabsSource: string;
  inProgress: boolean;
  monthsLeft: number;
  lines: TaxLine[];
  needsAnswer: number;
  salary: { netSoFar: number; netYear: number; months: number; projected: boolean; gross: number; employerTax: number; fromSlip: boolean };
  otherSlabIncome: number;
  zakatDeduction: number;
  taxableIncome: number;
  slabsUsed: "salaried" | "other";
  slabTax: number;
  fixedTax: number;
  estimatedTax: number;
  paid: { employer: number; bank: number; fixedAtSource: number; total: number };
  balance: number; // positive: left to pay, negative: refund
  monthlySetAside: number;
  charityPaid: number;
  exemptIncome: number;
};

/** Whole months of the tax year still to come after the current month. */
export function monthsLeftIn(taxYear: number, today: string): number {
  const ty = taxYearOf(today);
  if (ty < taxYear) return 12;
  if (ty > taxYear) return 0;
  const m = Number(today.slice(5, 7));
  const index = m >= 7 ? m - 7 : m + 5; // July = 0 ... June = 11
  return 11 - index;
}

export function estimateTaxYear(i: TaxInput): TaxResult {
  const { table, year: slabsYear, assumed } = slabsFor(i.taxYear);
  const monthsLeft = monthsLeftIn(i.taxYear, i.today);
  const inProgress = monthsLeft > 0 && taxYearOf(i.today) === i.taxYear;

  const lines: TaxLine[] = i.incomes.map((g) => {
    const rule = i.rules[ruleKey(g.kind, g.category)] ?? defaultRule(g.kind, g.category);
    let tax = 0;
    let note = "";
    if (rule.t === "fixed") {
      const pct = rule.ratePct ?? 1;
      tax = Math.round((g.total * pct) / 100);
      note = `${pct}% fixed tax`;
    } else if (rule.t === "at_source") note = "Bank deducts before paying";
    else if (rule.t === "salary") note = "See salary below";
    else if (rule.t === "slab") note = "Added to slab income";
    return { ...g, rule, tax, note };
  });

  // Salary: SMS only show take-home pay. While the year runs, assume the same pay until June.
  const netSoFar = lines.filter((l) => l.rule.t === "salary").reduce((s, l) => s + l.total, 0);
  const months = Math.max(0, i.salaryMonths);
  const projected = inProgress && months > 0;
  const toCome = monthsLeft + (i.salaryThisMonth ? 0 : 1);
  const netYear = projected ? netSoFar + Math.round((netSoFar / months) * toCome) : netSoFar;
  const fromSlip = !!i.grossSalaryOverride && i.grossSalaryOverride > 0;
  const back = grossFromNet(netYear, i.taxYear);
  const gross = fromSlip ? i.grossSalaryOverride! : back.gross;
  const employerTax = i.employerTaxOverride != null && i.employerTaxOverride >= 0 && fromSlip
    ? i.employerTaxOverride
    : fromSlip ? salaryTax(gross, i.taxYear) : back.tax;

  const otherSlabIncome = lines.filter((l) => l.rule.t === "slab").reduce((s, l) => s + l.total, 0);
  // Zakat paid in the year is deductible from taxable income.
  const zakatDeduction = Math.min(i.zakatPaid, gross + otherSlabIncome);
  const taxableIncome = Math.max(0, gross + otherSlabIncome - zakatDeduction);
  // Salaried rates apply when salary is more than 75% of taxable income.
  const slabsUsed = taxableIncome === 0 || gross / (gross + otherSlabIncome || 1) > 0.75 ? "salaried" : "other";
  const slabTaxAmt = slabsUsed === "salaried"
    ? slabTax(taxableIncome, table.salaried, table.surchargeOver, table.salariedSurcharge)
    : slabTax(taxableIncome, table.other, table.surchargeOver, table.otherSurcharge);
  const fixedTax = lines.reduce((s, l) => s + l.tax, 0);
  const estimatedTax = slabTaxAmt + fixedTax;

  const paid = { employer: employerTax, bank: i.bankTaxDeducted, fixedAtSource: fixedTax, total: employerTax + i.bankTaxDeducted + fixedTax };
  const balance = estimatedTax - paid.total;
  return {
    taxYear: i.taxYear,
    label: taxYearLabel(i.taxYear),
    slabsYear,
    slabsAssumed: assumed,
    slabsSource: table.source,
    inProgress,
    monthsLeft,
    lines,
    needsAnswer: lines.filter((l) => l.rule.t === "ask").length,
    salary: { netSoFar, netYear, months, projected, gross, employerTax, fromSlip },
    otherSlabIncome,
    zakatDeduction,
    taxableIncome,
    slabsUsed,
    slabTax: slabTaxAmt,
    fixedTax,
    estimatedTax,
    paid,
    balance,
    monthlySetAside: inProgress && balance > 0 ? Math.ceil(balance / (monthsLeft + 1)) : 0,
    charityPaid: i.charityPaid,
    exemptIncome: lines.filter((l) => l.rule.t === "exempt").reduce((s, l) => s + l.total, 0),
  };
}
