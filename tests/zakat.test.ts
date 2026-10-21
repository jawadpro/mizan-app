import { describe, expect, it } from "vitest";
import { computeZakat, nisabPaisa, tolaPricePaisa } from "@/lib/zakat";

describe("zakat", () => {
  it("computes nisab from the price per tola", () => {
    expect(nisabPaisa("silver", 300000)).toBe(15750000); // Rs 3,000/tola x 52.5
    expect(nisabPaisa("gold", 40000000)).toBe(300000000); // Rs 400,000/tola x 7.5
    expect(nisabPaisa("silver", 333)).toBe(17482); // floors the half paisa
  });
  it("is due at 2.5% once net wealth reaches nisab", () => {
    const r = computeZakat({ basis: "silver", pricePerTolaPaisa: 300000, bankPaisa: 20000000, otherAssetsPaisa: 0, debtsPaisa: 0 });
    expect(r.eligible).toBe(true);
    expect(r.due).toBe(500000);
  });
  it("subtracts debts and reports the shortfall", () => {
    const r = computeZakat({ basis: "silver", pricePerTolaPaisa: 300000, bankPaisa: 20000000, otherAssetsPaisa: 0, debtsPaisa: 5000000 });
    expect(r.eligible).toBe(false);
    expect(r.due).toBe(0);
    expect(r.shortBy).toBe(750000);
  });
  it("rounds the due amount up to the paisa and never goes negative", () => {
    expect(computeZakat({ basis: "silver", pricePerTolaPaisa: 1, bankPaisa: 101, otherAssetsPaisa: 0, debtsPaisa: 0 }).due).toBe(3);
    expect(computeZakat({ basis: "gold", pricePerTolaPaisa: 100, bankPaisa: -500, otherAssetsPaisa: 0, debtsPaisa: 0 }).wealth).toBe(0);
  });
  it("needs a price before anyone counts as eligible", () => {
    expect(computeZakat({ basis: "gold", pricePerTolaPaisa: 0, bankPaisa: 100, otherAssetsPaisa: 0, debtsPaisa: 0 }).eligible).toBe(false);
  });
});

describe("spot price conversion", () => {
  it("converts USD per troy ounce to paisa per tola", () => {
    // 4,166.10 USD/oz at 276.99 PKR/USD is about Rs 432,738 per tola
    expect(tolaPricePaisa(4166.100098, 276.990158)).toBeGreaterThan(43273000);
    expect(tolaPricePaisa(4166.100098, 276.990158)).toBeLessThan(43275000);
  });
  it("rejects bad numbers", () => {
    for (const [a, b] of [[0, 280], [-1, 280], [NaN, 280], [4000, Infinity]]) expect(tolaPricePaisa(a, b)).toBeNull();
  });
});
