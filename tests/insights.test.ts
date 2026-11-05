import { describe, expect, it } from "vitest";
import { buildInsights, tidyLimit, type InsightInput } from "@/lib/insights";

const R = (rupees: number) => rupees * 100;
const base = (over: Partial<InsightInput> = {}): InsightInput => ({
  today: "2026-11-15",
  monthByCategory: {},
  baselineSameDays: {},
  baselineFull: {},
  baselineMonths: 3,
  last30Expense: 0,
  freeToSpend: null,
  limits: [],
  overspentFunds: [],
  ...over,
});
const ids = (i: InsightInput) => buildInsights(i).tips.map((t) => t.id);

describe("spending check", () => {
  it("stays quiet when spending matches the usual pace", () => {
    const out = buildInsights(base({ monthByCategory: { Groceries: R(20000) }, baselineSameDays: { Groceries: R(60000) }, baselineFull: { Groceries: R(120000) } }));
    expect(out.tips).toEqual([]);
    expect(out.usualSoFar).toBe(R(20000));
  });

  it("flags a faster pace and names the category behind it", () => {
    const out = buildInsights(base({
      monthByCategory: { Groceries: R(20000), "Food & dining": R(18000) },
      baselineSameDays: { Groceries: R(60000), "Food & dining": R(15000) },
      baselineFull: { Groceries: R(120000), "Food & dining": R(30000) },
    }));
    const pace = out.tips.find((t) => t.id === "pace")!;
    expect(pace.tone).toBe("bad");
    expect(pace.detail).toContain("by the 15th");
    expect(pace.detail).toContain("Food & dining");
    expect(pace.actions).toContainEqual({ kind: "limit", category: "Food & dining", suggested: R(10000) });
  });

  it("does not count giving or saving as overspending", () => {
    expect(ids(base({ monthByCategory: { Zakat: R(90000), Charity: R(10000) }, baselineSameDays: {}, baselineFull: {} }))).toEqual([]);
  });

  it("spots one category well above its usual level", () => {
    const t = ids(base({ monthByCategory: { Shopping: R(9000), Groceries: R(10000) }, baselineSameDays: { Shopping: R(9000), Groceries: R(60000) }, baselineFull: { Shopping: R(20000), Groceries: R(120000) } }));
    expect(t).toContain("spike:Shopping");
    expect(t).not.toContain("spike:Groceries");
  });

  it("ignores small swings", () => {
    expect(ids(base({ monthByCategory: { Transport: R(1500) }, baselineSameDays: { Transport: R(1500) }, baselineFull: { Transport: R(3000) } }))).toEqual([]);
  });

  it("skips pace and spikes until there is a full earlier month", () => {
    expect(ids(base({ baselineMonths: 0, monthByCategory: { Shopping: R(50000) } }))).toEqual([]);
  });

  it("warns near and over a limit, and on pace to pass it", () => {
    const over = buildInsights(base({ monthByCategory: { Groceries: R(16000) }, limits: [{ category: "Groceries", limit: R(15000) }] }));
    expect(over.tips[0]).toMatchObject({ id: "limit-over:Groceries", tone: "bad" });
    expect(ids(base({ monthByCategory: { Groceries: R(12500) }, limits: [{ category: "Groceries", limit: R(15000) }] }))).toContain("limit-near:Groceries");
    expect(ids(base({ today: "2026-11-10", monthByCategory: { Groceries: R(7000) }, limits: [{ category: "Groceries", limit: R(15000) }] }))).toContain("limit-pace:Groceries");
    expect(ids(base({ today: "2026-11-03", monthByCategory: { Groceries: R(7000) }, limits: [{ category: "Groceries", limit: R(15000) }] }))).toEqual([]);
  });

  it("does not offer a second spike tip for a category that has a limit", () => {
    const t = ids(base({ monthByCategory: { Shopping: R(9000) }, baselineSameDays: { Shopping: R(9000) }, baselineFull: { Shopping: R(20000) }, limits: [{ category: "Shopping", limit: R(20000) }] }));
    expect(t).not.toContain("spike:Shopping");
  });

  it("warns when free-to-spend money will not last the month", () => {
    const out = buildInsights(base({ last30Expense: R(60000), freeToSpend: R(20000) }));
    const tip = out.tips.find((t) => t.id === "runway")!;
    expect(tip.detail).toContain("lasts around 10 days, but 15 are left");
    expect(ids(base({ last30Expense: R(60000), freeToSpend: R(40000) }))).toEqual([]);
    expect(buildInsights(base({ freeToSpend: -R(500) })).tips[0]).toMatchObject({ id: "runway", tone: "bad" });
  });

  it("puts the most serious tips first", () => {
    const out = buildInsights(base({ monthByCategory: { Groceries: R(12500), Health: R(16000) }, limits: [{ category: "Groceries", limit: R(15000) }, { category: "Health", limit: R(15000) }] }));
    expect(out.tips.map((t) => t.tone)).toEqual(["bad", "warn"]);
  });

  it("rounds suggested limits to tidy figures", () => {
    expect(tidyLimit(R(8120))).toBe(R(8500));
    expect(tidyLimit(R(23100))).toBe(R(24000));
    expect(tidyLimit(0)).toBe(R(500));
  });
});

describe("spending check overlap", () => {
  it("does not repeat the pace tip's main category as a spike", () => {
    const t = ids(base({
      monthByCategory: { Groceries: R(20000), "Food & dining": R(18000) },
      baselineSameDays: { Groceries: R(60000), "Food & dining": R(15000) },
      baselineFull: { Groceries: R(120000), "Food & dining": R(30000) },
    }));
    expect(t).toContain("pace");
    expect(t).not.toContain("spike:Food & dining");
  });
});
