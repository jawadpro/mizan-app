import { describe, expect, it } from "vitest";
import { currentOrNextRamadan, ramadanStart, toHijri, zakatYearOf } from "@/lib/ramadan";
import { addDays } from "@/lib/time";

describe("ramadan", () => {
  it("reads Hijri dates", () => {
    expect(toHijri("2026-10-19")).toEqual({ y: 1448, m: 5, d: 8 });
  });
  it("finds the next Ramadan from before it", () => {
    const r = currentOrNextRamadan("2026-10-19");
    expect(r.hijriYear).toBe(1448);
    expect(toHijri(r.start)).toEqual({ y: 1448, m: 9, d: 1 });
    expect(toHijri(r.end).m).toBe(9);
    expect(toHijri(addDays(r.end, 1)).m).toBe(10);
    expect(r.now).toBe(false);
    expect(r.daysUntil).toBeGreaterThan(100);
  });
  it("reports the current Ramadan while inside it", () => {
    const start = ramadanStart(1448);
    const mid = new Date(Date.parse(start) + 10 * 864e5).toISOString().slice(0, 10);
    const r = currentOrNextRamadan(mid);
    expect(r).toMatchObject({ hijriYear: 1448, start, now: true, daysUntil: 0 });
  });
  it("moves on to next year once Ramadan has ended", () => {
    const r = currentOrNextRamadan(new Date(Date.parse(ramadanStart(1448)) + 40 * 864e5).toISOString().slice(0, 10));
    expect(r.hijriYear).toBe(1449);
  });
  it("places Ramadan for any nearby year", () => {
    for (const y of [1447, 1448, 1449, 1455]) expect(toHijri(ramadanStart(y))).toEqual({ y, m: 9, d: 1 });
  });
  it("counts payments towards this Ramadan, or the next one once Eid has passed", () => {
    const start = ramadanStart(1448);
    expect(zakatYearOf("2026-10-19")).toBe(1448); // paid early, before Ramadan 1448
    expect(zakatYearOf(start)).toBe(1448);
    expect(zakatYearOf(addDays(start, 28))).toBe(1448);
    expect(zakatYearOf(addDays(currentOrNextRamadan(start).end, 1))).toBe(1449); // Eid ul-Fitr
  });
});
