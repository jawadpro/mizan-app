/**
 * Lines up a bank statement against what Mizan has recorded, to find what's missing. Bank reference numbers
 * on statements don't match the ones in SMS alerts, so rows are matched on amount, direction and date: the same
 * amount going the same way within a day either side (a card payment can post the day after it was made).
 * Pure, so it runs in the browser and in tests.
 */
import type { Kind } from "./categories";
import type { Direction, StatementRow } from "./statement";

export type BookEntry = { id: string; kind: Kind; amount_paisa: number; /** Karachi day, YYYY-MM-DD. */ day: string };

export type Reconciliation<E extends BookEntry = BookEntry> = {
  matched: { row: StatementRow; entry: E; dayDiff: number }[];
  /** On the statement, not in Mizan. */
  missing: StatementRow[];
  /** In Mizan within the statement's dates, not on the statement. */
  extra: E[];
};

export const directionOf = (kind: Kind): Direction => (kind === "expense" ? "out" : "in");

const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

/**
 * Pairs each statement row with at most one Mizan entry and the other way round. Within each amount and direction
 * it finds the largest set of pairs (so a run of identical Rs 23.40 fees is counted right), trying the closest
 * dates first.
 */
export function reconcile<E extends BookEntry>(rows: StatementRow[], entries: E[], opts: { toleranceDays?: number; from?: string; to?: string } = {}): Reconciliation<E> {
  const tol = opts.toleranceDays ?? 1;
  const groups = new Map<string, { rows: number[]; entries: number[] }>();
  const key = (amount: number, dir: Direction) => `${dir}:${amount}`;
  rows.forEach((r, i) => {
    const k = key(r.amountPaisa, r.direction);
    if (!groups.has(k)) groups.set(k, { rows: [], entries: [] });
    groups.get(k)!.rows.push(i);
  });
  entries.forEach((e, j) => {
    const g = groups.get(key(e.amount_paisa, directionOf(e.kind)));
    if (g) g.entries.push(j);
  });

  const rowMatch = new Map<number, number>();
  const entryMatch = new Map<number, number>();
  for (const g of groups.values()) {
    const adj = new Map<number, number[]>();
    for (const i of g.rows) {
      const d = dayNum(rows[i].date);
      adj.set(
        i,
        g.entries
          .filter((j) => Math.abs(dayNum(entries[j].day) - d) <= tol)
          .sort((a, b) => Math.abs(dayNum(entries[a].day) - d) - Math.abs(dayNum(entries[b].day) - d)),
      );
    }
    // Same-day pairs first, then augmenting paths (Kuhn's algorithm) for the largest matching.
    for (const i of g.rows) {
      const j = adj.get(i)!.find((x) => !entryMatch.has(x) && entries[x].day === rows[i].date);
      if (j !== undefined) {
        rowMatch.set(i, j);
        entryMatch.set(j, i);
      }
    }
    const augment = (i: number, seen: Set<number>): boolean => {
      for (const j of adj.get(i)!) {
        if (seen.has(j)) continue;
        seen.add(j);
        const other = entryMatch.get(j);
        if (other === undefined || augment(other, seen)) {
          rowMatch.set(i, j);
          entryMatch.set(j, i);
          return true;
        }
      }
      return false;
    };
    for (const i of g.rows) if (!rowMatch.has(i)) augment(i, new Set());
  }

  const from = opts.from ?? rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0]?.date ?? "");
  const to = opts.to ?? rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0]?.date ?? "");
  return {
    matched: rows.flatMap((row, i) => {
      const j = rowMatch.get(i);
      return j === undefined ? [] : [{ row, entry: entries[j], dayDiff: dayNum(entries[j].day) - dayNum(row.date) }];
    }),
    missing: rows.filter((_, i) => !rowMatch.has(i)),
    extra: entries.filter((e, j) => !entryMatch.has(j) && e.day >= from && e.day <= to),
  };
}

export type Suggestion = { kind: Kind; category: string; counterparty: string | null; note: string };

const has = (re: RegExp, s: string) => re.test(s);

/**
 * What a missing statement row most likely is, from its description, so it can be added in one tap: fees and
 * tax go under Bank charges and Tax deducted (paid to the bank, as Mizan files charges on transfers), ATM
 * withdrawals under Cash withdrawal, card payments under Shopping, and so on. Anything unclear is Uncategorized.
 */
export function suggestEntry(row: StatementRow, bankName: string | null): Suggestion {
  const d = row.description.toUpperCase();
  const note = `From bank statement: ${row.description || "no description"}${row.reference ? ` (ref ${row.reference})` : ""}`.slice(0, 500);
  const base = { counterparty: null as string | null, note };
  if (row.direction === "out") {
    if (has(/\bW\.?H\.?T\b|WITHHOLDING|\bFED\b|EXCISE|\bTAX\b|ZAKAT DED/, d)) return { ...base, kind: "expense", category: d.includes("ZAKAT") ? "Zakat" : "Tax deducted", counterparty: bankName };
    if (has(/\bFEES?\b|CHARGES?\b|\bCHGS?\b|COMMISSION|SMS ALERT|ANNUAL|SERVICE CHG|PENALTY|CARD ISSUANCE|CARD RENEWAL/, d)) return { ...base, kind: "expense", category: "Bank charges", counterparty: bankName };
    if (has(/\bATM\b|CASH WITHDRAWAL|\bCW\b|CASH WDL/, d)) return { ...base, kind: "expense", category: "Cash withdrawal" };
    if (has(/BILL PAY|UTILITY|ELECTRIC|\bGAS\b|SNGPL|SSGC|PTCL|WATER|LESCO|IESCO|MEPCO|FESCO|K-?ELECTRIC/, d)) return { ...base, kind: "expense", category: "Utilities" };
    if (has(/\bPOS\b|\bVISA\b|MASTERCARD|\bMASTER\b|PAYPAK|PURCHASE|E-?COM|ONLINE SHOPPING|DEBIT CARD/, d)) return { ...base, kind: "expense", category: "Shopping" };
    if (has(/IBFT|RAAST|\bP2P\b|TRANSFER|\bFT\b|SENDING|FUNDS? TRF|\bTRF\b/, d)) return { ...base, kind: "expense", category: "Transfers" };
    return { ...base, kind: "expense", category: "Uncategorized" };
  }
  if (has(/HOME REMITTANCE|FOREIGN REMIT|INWARD REMIT|WESTERN UNION|MONEYGRAM|REMITLY|XPRESS MONEY|RIA\b/, d)) return { ...base, kind: "remittance", category: "Remittance" };
  if (has(/SALARY|PAYROLL/, d)) return { ...base, kind: "income", category: "Salary" };
  if (has(/PROFIT|INTEREST|DIVIDEND/, d)) return { ...base, kind: "income", category: "Profit" };
  if (has(/REFUND|REVERSAL|REVERSED|CASHBACK|CHARGEBACK/, d)) return { ...base, kind: "income", category: "Refund" };
  return { ...base, kind: "income", category: "Uncategorized" };
}
