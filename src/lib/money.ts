// Money is always stored as integer hundredths of the currency ("paisa" for PKR, cents for USD).
// Never round-trip through floats. The currency is display only: amounts are never converted.

// scale: roughly how big one unit is next to a rupee, so "tidy" figures and noise thresholds in the
// spending check stay sensible (Rs 5,000 of noise is about $50).
export const CURRENCIES = [
  { code: "PKR", symbol: "Rs", name: "Pakistani rupee", grouping: "south-asian", scale: 1 },
  { code: "INR", symbol: "₹", name: "Indian rupee", grouping: "south-asian", scale: 1 },
  { code: "BDT", symbol: "Tk", name: "Bangladeshi taka", grouping: "south-asian", scale: 1 },
  { code: "USD", symbol: "$", name: "US dollar", grouping: "western", scale: 0.01 },
  { code: "EUR", symbol: "€", name: "Euro", grouping: "western", scale: 0.01 },
  { code: "GBP", symbol: "£", name: "British pound", grouping: "western", scale: 0.01 },
  { code: "AED", symbol: "AED", name: "UAE dirham", grouping: "western", scale: 0.01 },
  { code: "SAR", symbol: "SAR", name: "Saudi riyal", grouping: "western", scale: 0.01 },
  { code: "QAR", symbol: "QAR", name: "Qatari riyal", grouping: "western", scale: 0.01 },
  { code: "CAD", symbol: "C$", name: "Canadian dollar", grouping: "western", scale: 0.01 },
  { code: "AUD", symbol: "A$", name: "Australian dollar", grouping: "western", scale: 0.01 },
  { code: "MYR", symbol: "RM", name: "Malaysian ringgit", grouping: "western", scale: 0.01 },
  { code: "TRY", symbol: "₺", name: "Turkish lira", grouping: "western", scale: 0.1 },
] as const;
export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [CurrencyCode, ...CurrencyCode[]];
export const DEFAULT_CURRENCY: CurrencyCode = "PKR";

export function currencyInfo(code: string = displayCurrency) {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

// The owner picks one currency in Settings. The app layout sets it once per render (server and browser)
// so every formatPaisa call shows it without threading it through each component.
let displayCurrency: CurrencyCode = DEFAULT_CURRENCY;
export function setDisplayCurrency(code: string) {
  displayCurrency = currencyInfo(code).code;
}
export function getDisplayCurrency(): CurrencyCode {
  return displayCurrency;
}
/** The short sign shown before amounts, e.g. "Rs" or "$". */
export function currencySymbol(code?: string) {
  return currencyInfo(code).symbol;
}

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

/** Formats paisa as "Rs 1,234.50" (South Asian grouping) or "$ 1,234.50" (thousands), in the chosen currency. */
export function formatPaisa(paisa: number | bigint | string, opts: { sign?: boolean; compact?: boolean; currency?: string; symbol?: boolean } = {}): string {
  const cur = currencyInfo(opts.currency);
  const southAsian = cur.grouping === "south-asian";
  const sym = opts.symbol === false ? "" : `${cur.symbol} `;
  const n = BigInt(paisa);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const rupees = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  if (opts.compact) {
    const r = Number(rupees);
    const fmt = (v: number, u: string) => `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${u}`;
    const body = southAsian
      ? r >= 1e7 ? fmt(r / 1e7, " Cr") : r >= 1e5 ? fmt(r / 1e5, " L") : r >= 1e3 ? fmt(r / 1e3, "k") : String(r)
      : r >= 1e9 ? fmt(r / 1e9, "B") : r >= 1e6 ? fmt(r / 1e6, "M") : r >= 1e3 ? fmt(r / 1e3, "k") : String(r);
    return `${neg ? "−" : opts.sign ? "+" : ""}${sym}${body}`;
  }
  const grouped = southAsian ? groupIndian(rupees.toString()) : rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : opts.sign ? "+" : ""}${sym}${grouped}.${fraction}`;
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
