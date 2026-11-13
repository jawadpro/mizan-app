import { describe, expect, it } from "vitest";
import { buildSavingsPlan, tidyDown, type SavingsInput } from "@/lib/savings";

const R = (rupees: number) => rupees * 100;
const month = (m: string, income: number, byCategory: Record<string, number>) => ({ month: m, income: R(income), byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, R(v)])) });
const base = (over: Partial<SavingsInput> = {}): SavingsInput => ({
  today: "2026-11-15",
  months: [
    month("2026-08", 200000, { Rent: 60000, Groceries: 30000, "Food & dining": 20000, Shopping: 15000 }),
    month("2026-09", 200000, { Rent: 60000, Groceries: 28000, "Food & dining": 14000, Shopping: 10000 }),
    month("2026-10", 200000, { Rent: 60000, Groceries: 32000, "Food & dining": 17000, Shopping: 20000 }),
  ],
  thisMonth: { income: R(200000), byCategory: { Rent: R(60000), Groceries: R(15000) } },
  recurring: [],
  savingFunds: [],
  target: 0,
  ...over,
});
const ready = (i: SavingsInput) => {
  const p = buildSavingsPlan(i);
  if (!p.ready) throw new Error("plan not ready");
  return p;
};

describe("savings plan", () => {
  it("waits for a full month of records", () => {
    expect(buildSavingsPlan(base({ months: [] })).ready).toBe(false);
  });

  it("suggests the usual surplus plus realistic cuts, less a cushion, rounded down", () => {
    const p = ready(base());
    // Spend 122,000 a month on average; cuts: Food & dining min(3,400, 3,000) = 3,000, Shopping min(3,750, 5,000) = 3,750,
    // Groceries min(3,000, 2,000) = 2,000. Rent is fixed. 200,000 - 122,000 + 8,750 - 10,000 = 76,750 -> 76,000.
    expect(p.usual.spend).toBe(R(122000));
    expect(p.suggested).toBe(R(76000));
    expect(p.target).toBe(p.suggested);
    expect(p.targetIsOwn).toBe(false);
    expect(p.rule20).toBe(R(40000));
  });

  it("never counts money moved to Savings as spending", () => {
    const withSavings = base();
    withSavings.months = withSavings.months.map((m) => ({ ...m, byCategory: { ...m.byCategory, Savings: R(30000) } }));
    expect(ready(withSavings).usual.spend).toBe(R(122000));
  });

  it("uses the owner's own target and works out this month's room", () => {
    const p = ready(base({ target: R(50000) }));
    expect(p.target).toBe(R(50000));
    expect(p.targetIsOwn).toBe(true);
    // 200,000 in, 75,000 spent, 50,000 to save: 75,000 of room left.
    expect(p.thisMonth.roomLeft).toBe(R(75000));
    expect(p.thisMonth.savedSoFar).toBe(R(125000));
  });

  it("plans from the leanest month when income swings a lot", () => {
    const p = ready(base({
      months: [
        month("2026-08", 300000, { Groceries: 30000 }),
        month("2026-09", 100000, { Groceries: 30000 }),
        month("2026-10", 250000, { Groceries: 30000 }),
      ],
    }));
    expect(p.uneven).toBe(true);
    expect(p.planIncome).toBe(15833333); // halfway between the usual 216,666.67 and the leanest 100,000
    expect(p.tips.map((t) => t.id)).toContain("uneven");
  });

  it("flags a category creeping up and offers a limit at the old level", () => {
    const p = ready(base({
      months: [
        month("2026-08", 200000, { "Food & dining": 10000 }),
        month("2026-09", 200000, { "Food & dining": 10000 }),
        month("2026-10", 200000, { "Food & dining": 18000 }),
      ],
      thisMonth: { income: 0, byCategory: {} },
    }));
    const t = p.tips.find((x) => x.id === "rising:Food & dining")!;
    expect(t.monthly).toBe(R(8000));
    expect(t.actions).toContainEqual({ kind: "limit", category: "Food & dining", suggested: R(10000) });
  });

  it("warns first when spending is more than income", () => {
    const p = ready(base({ months: [month("2026-10", 50000, { Rent: 40000, Shopping: 20000 })] }));
    expect(p.suggested).toBe(0);
    expect(p.tips[0].id).toBe("over");
  });

  it("suggests a saving set-aside, or raising one that is too small", () => {
    expect(ready(base()).tips.map((t) => t.id)).toContain("pay-first");
    const small = ready(base({ savingFunds: [{ id: "a", name: "Savings jar", percent_bp: 500, applies_to: "incoming", remaining: 0 }] }));
    expect(small.tips.find((t) => t.id === "pay-first")?.title).toBe("Raise Savings jar to 38%");
    const enough = ready(base({ savingFunds: [{ id: "a", name: "Savings jar", percent_bp: 5000, applies_to: "incoming", remaining: 0 }] }));
    expect(enough.tips.map((t) => t.id)).not.toContain("pay-first");
  });

  it("totals monthly payments into a tip", () => {
    const p = ready(base({ recurring: [{ name: "Internet", amount: R(5000), category: "Utilities" }, { name: "Gym", amount: R(4000), category: "Health" }, { name: "Electricity", amount: null, category: "Utilities" }] }));
    expect(p.recurringTotal).toBe(R(9000));
    expect(p.tips.find((t) => t.id === "recurring")?.detail).toContain("Internet");
  });

  it("rounds down to tidy figures", () => {
    expect(tidyDown(R(12345))).toBe(R(12000));
    expect(tidyDown(R(45678))).toBe(R(45000));
    expect(tidyDown(-5)).toBe(0);
  });
});
