import { describe, expect, it } from "vitest";
import { estimateTaxYear, grossFromNet, monthsLeftIn, salaryTax, slabsFor, taxYearOf } from "@/lib/tax";

const rs = (n: number) => n * 100;

describe("tax year", () => {
  it("runs July to June and is named by the year it ends", () => {
    expect(taxYearOf("2026-07-01")).toBe(2027);
    expect(taxYearOf("2027-06-30")).toBe(2027);
    expect(taxYearOf("2026-06-30")).toBe(2026);
  });
  it("counts the months left after the current one", () => {
    expect(monthsLeftIn(2027, "2026-07-15")).toBe(11);
    expect(monthsLeftIn(2027, "2026-11-07")).toBe(7);
    expect(monthsLeftIn(2027, "2027-06-01")).toBe(0);
    expect(monthsLeftIn(2026, "2026-11-07")).toBe(0);
  });
  it("falls back to the latest slabs for a year not published yet", () => {
    expect(slabsFor(2030)).toMatchObject({ year: 2027, assumed: true });
    expect(slabsFor(2027).assumed).toBe(false);
  });
});

describe("salary slabs", () => {
  it("matches the Finance Act 2026 table", () => {
    expect(salaryTax(rs(600_000), 2027)).toBe(0);
    expect(salaryTax(rs(1_200_000), 2027)).toBe(rs(6_000));
    expect(salaryTax(rs(2_400_000), 2027)).toBe(rs(156_000));
    expect(salaryTax(rs(8_000_000), 2027)).toBe(rs(1_774_000));
  });
  it("applies the 2025-26 surcharge above 10 million", () => {
    expect(salaryTax(rs(12_000_000), 2026)).toBe(Math.round(rs(616_000 + 0.35 * 7_900_000) * 1.09));
  });
  it("works back from take-home pay to gross pay", () => {
    for (const gross of [500_000, 1_800_000, 2_400_000, 6_000_000]) {
      const net = rs(gross) - salaryTax(rs(gross), 2027);
      const back = grossFromNet(net, 2027);
      expect(Math.abs(back.gross - rs(gross))).toBeLessThanOrEqual(1);
      expect(back.gross - back.tax).toBeGreaterThanOrEqual(net);
    }
  });
});

describe("year estimate", () => {
  const base = { taxYear: 2027, rules: {}, bankTaxDeducted: 0, zakatPaid: 0, charityPaid: 0 };

  it("projects salary to June and finds nothing due when the employer deducts by the slabs", () => {
    const monthlyNet = rs(200_000) - salaryTax(rs(2_400_000), 2027) / 12;
    const r = estimateTaxYear({ ...base, today: "2026-11-07", salaryMonths: 4, salaryThisMonth: false, incomes: [{ kind: "income", category: "Salary", total: monthlyNet * 4, count: 4 }] });
    expect(r.salary.projected).toBe(true);
    expect(Math.abs(r.salary.gross - rs(2_400_000))).toBeLessThanOrEqual(2);
    expect(Math.abs(r.balance)).toBeLessThanOrEqual(2);
  });

  it("gives a refund for Zakat paid and counts bank tax as already paid", () => {
    const net = rs(2_400_000) - salaryTax(rs(2_400_000), 2027);
    const r = estimateTaxYear({ ...base, today: "2027-08-01", salaryMonths: 12, zakatPaid: rs(100_000), bankTaxDeducted: rs(5_000),
      incomes: [{ kind: "income", category: "Salary", total: net, count: 12 }] });
    expect(r.inProgress).toBe(false);
    expect(r.taxableIncome).toBe(r.salary.gross - rs(100_000));
    expect(r.balance).toBeLessThan(-rs(20_000));
  });

  it("taxes freelance at a fixed rate, leaves family remittances out and flags unknown income", () => {
    const r = estimateTaxYear({ ...base, today: "2027-08-01", salaryMonths: 0, incomes: [
      { kind: "income", category: "Freelance", total: rs(1_000_000), count: 5 },
      { kind: "remittance", category: "Family support", total: rs(300_000), count: 3 },
      { kind: "income", category: "Uncategorized", total: rs(50_000), count: 1 },
    ] });
    expect(r.fixedTax).toBe(rs(10_000));
    expect(r.balance).toBe(0); // deducted by the bank at source
    expect(r.exemptIncome).toBe(rs(300_000));
    expect(r.needsAnswer).toBe(1);
    expect(r.taxableIncome).toBe(0);
  });

  it("uses salary slip figures when given", () => {
    const r = estimateTaxYear({ ...base, today: "2027-08-01", salaryMonths: 12, grossSalaryOverride: rs(3_000_000), employerTaxOverride: rs(200_000),
      incomes: [{ kind: "income", category: "Salary", total: rs(2_000_000), count: 12 }] });
    expect(r.salary.gross).toBe(rs(3_000_000));
    expect(r.estimatedTax).toBe(rs(276_000));
    expect(r.balance).toBe(rs(76_000));
  });
});
