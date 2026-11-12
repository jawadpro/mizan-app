import { describe, expect, it } from "vitest";
import { equalShares, isPaidBack, nameHit, rankFor, receiptRef, shareScore, suggestShares } from "@/lib/splits";

const share = (id: string, person: string, rupees: number, paid = 0, bill = "2026-11-01") => ({
  id, person, amount_paisa: rupees * 100, paid: paid * 100, bill_at: `${bill}T14:00:00Z`,
});
const tx = (id: string, rupees: number, date: string, counterparty: string | null, note: string | null = null) => ({
  id, amount_paisa: rupees * 100, occurred_at: `${date}T09:00:00Z`, counterparty, note,
});

describe("equal shares", () => {
  it("keeps the rounding with the owner when they are one of the people", () => {
    expect(equalShares(1000_00, 3, true)).toEqual([333_00, 333_00]);
    expect(equalShares(1200_00, 4, true)).toEqual([300_00, 300_00, 300_00]);
  });
  it("hands the rounding to the others when the owner isn't splitting", () => {
    const s = equalShares(1000_00, 3, false);
    expect(s.reduce((a, b) => a + b, 0)).toBe(1000_00);
    expect(s).toEqual([334_00, 333_00, 333_00]);
  });
  it("has nobody else to split with when it's only the owner", () => {
    expect(equalShares(500_00, 1, true)).toEqual([]);
  });
});

describe("paid back", () => {
  it("counts a share paid back at 98% or more, or when settled by hand", () => {
    expect(isPaidBack(1000_00, 1000_00, false)).toBe(true);
    expect(isPaidBack(1000_00, 985_00, false)).toBe(true);
    expect(isPaidBack(1000_00, 500_00, false)).toBe(false);
    expect(isPaidBack(1000_00, 0, true)).toBe(true);
  });
});

describe("spotting the repayment", () => {
  it("matches names the way banks print them", () => {
    expect(nameHit("Ali", "ALI RAZA KHAN")).toBe(true);
    expect(nameHit("Ali Raza", "IBFT from ali raza")).toBe(true);
    expect(nameHit("Sara", "Bilal Ahmed")).toBe(false);
  });
  it("prefers the right person with the right amount", () => {
    const s = share("a", "Ali", 1500);
    const best = rankFor(s, [tx("1", 1500, "2026-11-03", "Bilal"), tx("2", 1500, "2026-11-04", "ALI RAZA"), tx("3", 200, "2026-11-04", "Ali")]);
    expect(best[0].id).toBe("2");
    expect(best[0].score).toBeGreaterThanOrEqual(90);
  });
  it("never offers money that came in before the bill", () => {
    expect(shareScore(share("a", "Ali", 1500), tx("1", 1500, "2026-10-20", "Ali"))).toBe(0);
    expect(rankFor(share("a", "Ali", 1500), [tx("1", 1500, "2026-10-20", "Ali")])).toEqual([]);
  });
  it("aims at what is still owed on a part-paid share", () => {
    const s = share("a", "Ali", 1500, 1000);
    expect(shareScore(s, tx("1", 500, "2026-11-05", "Ali"))).toBeGreaterThan(shareScore(s, tx("2", 1500, "2026-11-05", "Ali")));
  });
  it("gives each transfer to one share only", () => {
    const shares = [share("ali", "Ali", 1000), share("sara", "Sara", 1000)];
    const m = suggestShares(shares, [tx("1", 1000, "2026-11-02", "Ali Khan"), tx("2", 1000, "2026-11-02", "Sara B")]);
    expect(m.get("ali")?.id).toBe("1");
    expect(m.get("sara")?.id).toBe("2");
    const one = suggestShares(shares, [tx("1", 1000, "2026-11-02", "Ali Khan")]);
    expect(one.get("ali")?.id).toBe("1");
    expect(one.has("sara")).toBe(false);
  });
});

it("makes a short receipt reference", () => {
  expect(receiptRef("3f9a2c11-0000-4000-8000-000000000000")).toBe("SPL-3F9A2C");
});
