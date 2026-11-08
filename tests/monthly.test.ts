import { describe, expect, it } from "vitest";
import { addMonths, dueDate, isComplete, isMonth, matchScore, rankMatches, suggestFor } from "@/lib/monthly";

const tx = (id: string, rupees: number, date: string, category: string, counterparty: string | null, note: string | null = null) => ({
  id, amount_paisa: rupees * 100, occurred_at: `${date}T07:00:00Z`, category, counterparty, note,
});
const rent = { id: "rent", name: "Rent", amount_paisa: 85_000_00, category: "Rent", payee: "Landlord", due_day: 2 };
const power = { id: "power", name: "Electricity", amount_paisa: null, category: "Utilities", payee: "K-Electric", due_day: 5 };
const school = { id: "school", name: "School fees", amount_paisa: 18_500_00, category: "Education", payee: null, due_day: 10 };

describe("months", () => {
  it("steps across years both ways", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-03", -14)).toBe("2025-01");
  });
  it("validates YYYY-MM", () => {
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(isMonth(null)).toBe(false);
  });
  it("puts a due day past the month's end on its last day", () => {
    expect(dueDate("2026-02", 31)).toBe("2026-02-28");
    expect(dueDate("2028-02", 30)).toBe("2028-02-29");
    expect(dueDate("2026-11", 5)).toBe("2026-11-05");
    expect(dueDate("2026-11", null)).toBeNull();
  });
});

describe("spotting the payment", () => {
  it("scores the right payee and exact amount highest", () => {
    const right = matchScore(rent, tx("a", 85_000, "2026-11-02", "Rent", "Landlord"), "2026-11");
    const other = matchScore(rent, tx("b", 85_000, "2026-11-12", "Shopping", "Daraz"), "2026-11");
    expect(right).toBeGreaterThanOrEqual(90);
    expect(other).toBeLessThan(50);
  });
  it("finds a bill by its name in the note when there is no payee", () => {
    expect(matchScore(school, tx("a", 18_500, "2026-11-09", "Transfers", "1Link", "School fees Nov"), "2026-11")).toBeGreaterThanOrEqual(50);
  });
  it("matches a bill whose amount changes by payee and category", () => {
    expect(matchScore(power, tx("a", 9_870, "2026-11-05", "Utilities", "K-Electric"), "2026-11")).toBeGreaterThanOrEqual(60);
  });
  it("ranks candidates best first and drops unrelated ones", () => {
    const list = rankMatches(rent, [
      tx("x", 1_200, "2026-11-06", "Food & dining", "Foodpanda"),
      tx("y", 80_000, "2026-11-03", "Rent", "Landlord"),
      tx("z", 85_000, "2026-11-02", "Rent", "Landlord"),
    ], "2026-11");
    expect(list.map((t) => t.id)).toEqual(["z", "y"]);
  });
  it("never suggests one transaction for two items", () => {
    const water = { id: "water", name: "Water", amount_paisa: 2_000_00, category: "Utilities", payee: "K-Electric", due_day: 5 };
    const s = suggestFor([power, water], [tx("ke", 9_870, "2026-11-05", "Utilities", "K-Electric")], "2026-11");
    expect(s.size).toBe(1);
  });
  it("suggests nothing when nothing looks right", () => {
    expect(suggestFor([rent], [tx("a", 3_000, "2026-11-04", "Groceries", "Imtiaz")], "2026-11").size).toBe(0);
  });
});

describe("paid in parts", () => {
  it("counts parts that reach the usual amount as paid, allowing a small shortfall", () => {
    expect(isComplete(18_500_00, false, 9_250_00)).toBe(false);
    expect(isComplete(18_500_00, false, 18_500_00)).toBe(true);
    expect(isComplete(85_000_00, false, 84_000_00)).toBe(true);
    expect(isComplete(85_000_00, false, 80_000_00)).toBe(false);
  });
  it("treats a bill with no usual amount, or one marked fully paid, as paid", () => {
    expect(isComplete(null, false, 5_000_00)).toBe(true);
    expect(isComplete(18_500_00, true, 0)).toBe(true);
  });
});
