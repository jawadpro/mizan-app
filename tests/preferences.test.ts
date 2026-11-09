import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, normalizePrefs, prefsPatch } from "@/lib/preferences";
import { buildInsights } from "@/lib/insights";

describe("settings", () => {
  it("fills in defaults and keeps good values when one is bad", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ spendingCheck: false, limitWarnPercent: 55, nonsense: 1, dua: true })).toEqual({ ...DEFAULT_PREFS, spendingCheck: false });
  });
  it("rejects unknown keys and wrong types on save", () => {
    expect(prefsPatch.safeParse({ spendingCheck: "no" }).success).toBe(false);
    expect(prefsPatch.safeParse({ other: true }).success).toBe(false);
    expect(prefsPatch.safeParse({ limitWarnPercent: 90 }).success).toBe(true);
    expect(prefsPatch.safeParse({ currency: "USD" }).success).toBe(true);
    expect(prefsPatch.safeParse({ currency: "usd" }).success).toBe(false);
    expect(normalizePrefs({ currency: "ZZZ" }).currency).toBe("PKR");
  });
  it("uses the chosen warning level for limits", () => {
    const input = { today: "2026-11-05", monthByCategory: { Groceries: 750_000 }, baselineSameDays: {}, baselineFull: {}, baselineMonths: 0, last30Expense: 0, freeToSpend: null, limits: [{ category: "Groceries", limit: 1_000_000 }], overspentFunds: [] };
    expect(buildInsights(input).tips).toEqual([]);
    expect(buildInsights({ ...input, warnAt: 0.7 }).tips[0].id).toBe("limit-near:Groceries");
  });
});
