// Money is always integer paisa (1 PKR = 100 paisa). Never round-trip through floats.

const AMOUNT_RE = /^(\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d+)(?:\.(\d{1,2}))?$/;

/** Parses "1,234.50" / "1234" / "1,00,000" into paisa. Returns null for anything else. */
export function parseAmountToPaisa(input: string): number | null {
  const s = input.trim();
  const m = AMOUNT_RE.exec(s);
  if (!m) return null;
  const whole = m[1].replace(/,/g, "");
  if (whole.length > 12) return null;
  const frac = (m[2] ?? "").padEnd(2, "0");
  const paisa = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(paisa) || paisa <= 0) return null;
  return paisa;
}

/** Formats paisa as "Rs 1,234.50" using South Asian digit grouping. */
export function formatPaisa(paisa: number | bigint | string, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const n = BigInt(paisa);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const rupees = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  if (opts.compact) {
    const r = Number(rupees);
    const fmt = (v: number, u: string) => `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${u}`;
    const body = r >= 1e7 ? fmt(r / 1e7, " Cr") : r >= 1e5 ? fmt(r / 1e5, " L") : r >= 1e3 ? fmt(r / 1e3, "k") : String(r);
    return `${neg ? "−" : opts.sign ? "+" : ""}Rs ${body}`;
  }
  const grouped = groupIndian(rupees.toString());
  return `${neg ? "−" : opts.sign ? "+" : ""}Rs ${grouped}.${fraction}`;
}

/** Plain decimal string for inputs and CSV, e.g. "1234.50". */
export function paisaToDecimal(paisa: number | bigint | string): string {
  const n = BigInt(paisa);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  return `${neg ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}
