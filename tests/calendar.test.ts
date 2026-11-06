import { describe, expect, it } from "vitest";
import { addMonths, layoutDay, periodTitle, pktParts, shift, startOfWeek, visibleDays, weekdayIndex } from "@/lib/calendar";

describe("calendar dates", () => {
  it("starts weeks on Monday", () => {
    expect(weekdayIndex("2026-11-02")).toBe(0); // Monday
    expect(weekdayIndex("2026-11-08")).toBe(6); // Sunday
    expect(startOfWeek("2026-11-06")).toBe("2026-11-02");
  });
  it("shows six full weeks for a month", () => {
    const d = visibleDays("month", "2026-11-15");
    expect(d).toHaveLength(42);
    expect(d[0]).toBe("2026-10-26");
    expect(d).toContain("2026-11-30");
  });
  it("moves by month without overflowing short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(shift("week", "2026-11-06", -1)).toBe("2026-10-30");
  });
  it("titles periods", () => {
    expect(periodTitle("month", "2026-11-06")).toBe("November 2026");
    expect(periodTitle("week", "2026-11-06")).toBe("2 – 8 Nov 2026");
    expect(periodTitle("week", "2026-12-30")).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(periodTitle("day", "2026-11-06")).toBe("Friday, 6 November 2026");
  });
  it("reads timestamps in Karachi time", () => {
    expect(pktParts("2026-11-05T20:30:00Z")).toEqual({ day: "2026-11-06", minutes: 90 });
  });
  it("puts overlapping transactions side by side", () => {
    expect(layoutDay([600, 610, 700])).toEqual([{ col: 0, cols: 2 }, { col: 1, cols: 2 }, { col: 0, cols: 1 }]);
    expect(layoutDay([600, 600, 600]).map((p) => p.cols)).toEqual([3, 3, 3]);
  });
});
