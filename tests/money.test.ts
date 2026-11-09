import { describe, expect, it } from "vitest";
import { formatPaisa, getDisplayCurrency, paisaToDecimal, parseAmountToPaisa, setDisplayCurrency } from "@/lib/money";
import { pktLocalToDate, dateToPktLocal } from "@/lib/time";

describe("money", () => {
  it("parses exact paisa without float error", () => {
    expect(parseAmountToPaisa("0.29")).toBe(29);
    expect(parseAmountToPaisa("1,234.5")).toBe(123450);
    expect(parseAmountToPaisa("1,00,000")).toBe(10000000);
    expect(parseAmountToPaisa("19.99")).toBe(1999);
  });
  it("rejects bad input", () => {
    for (const s of ["", "-5", "1.234", "abc", "0", "1e5", "12,34"]) expect(parseAmountToPaisa(s)).toBeNull();
  });
  it("formats with South Asian grouping", () => {
    expect(formatPaisa(12345678901)).toBe("Rs 12,34,56,789.01");
    expect(formatPaisa(50)).toBe("Rs 0.50");
    expect(paisaToDecimal(123450)).toBe("1234.50");
    expect(formatPaisa(28500000, { compact: true })).toBe("Rs 2.9 L");
  });
  it("formats in another currency with thousands grouping", () => {
    expect(formatPaisa(12345678901, { currency: "USD" })).toBe("$ 123,456,789.01");
    expect(formatPaisa(-150000, { currency: "GBP", compact: true })).toBe("−£ 1.5k");
    expect(formatPaisa(250000000, { currency: "AED", compact: true })).toBe("AED 2.5M");
    expect(formatPaisa(12345678, { currency: "INR" })).toBe("₹ 1,23,456.78");
    expect(formatPaisa(28500000, { compact: true, symbol: false })).toBe("2.9 L");
  });
  it("uses the chosen display currency and ignores unknown codes", () => {
    try {
      setDisplayCurrency("EUR");
      expect(formatPaisa(100050)).toBe("€ 1,000.50");
      setDisplayCurrency("XYZ");
      expect(getDisplayCurrency()).toBe("PKR");
    } finally {
      setDisplayCurrency("PKR");
    }
  });
});

describe("time", () => {
  it("round-trips Karachi wall-clock time", () => {
    const d = pktLocalToDate("2026-10-15T14:22")!;
    expect(d.toISOString()).toBe("2026-10-15T09:22:00.000Z");
    expect(dateToPktLocal(d)).toBe("2026-10-15T14:22");
    expect(pktLocalToDate("2026-02-30")).toBeNull();
  });
});
