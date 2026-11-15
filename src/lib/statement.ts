/**
 * Reads a bank statement exported as CSV. Banks lay their statements out differently, so nothing here is tied to
 * one bank: the header row is found by its column names, and the amount can come as separate debit and credit
 * columns, one amount column with a Cr/Dr column next to it, or one signed amount. Pure, so it runs in the browser
 * (the statement never leaves the device) and in tests.
 */

export type Direction = "out" | "in";

export type StatementRow = {
  /** Line number in the file, counted from 1. */
  line: number;
  /** YYYY-MM-DD, as printed on the statement. */
  date: string;
  description: string;
  reference: string;
  amountPaisa: number;
  direction: Direction;
};

export type StatementColumns = {
  date: number;
  description: number | null;
  reference: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  /** A column holding "Cr" or "Dr" for each row. */
  drcr: number | null;
};

export type Statement = {
  rows: StatementRow[];
  /** The header row's cells, so the page can say which columns it read. */
  header: string[];
  columns: StatementColumns;
  /** Rows under the header that have a date but no amount Mizan could read. */
  skipped: { line: number; reason: string }[];
  /** From the lines above the table, when the bank prints them. */
  openingBalancePaisa: number | null;
  closingBalancePaisa: number | null;
  from: string | null;
  to: string | null;
};

export class StatementError extends Error {}

/** Splits CSV text into rows of cells: quoted cells, doubled quotes, CRLF, and comma, semicolon or tab separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const sep = detectSeparator(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((s) => s.trim()));
}

function detectSeparator(src: string): string {
  const sample = src.split(/\r?\n/).slice(0, 30).join("\n").replace(/"[^"]*"/g, "");
  const count = (ch: string) => sample.split(ch).length - 1;
  const [best] = [",", ";", "\t"].sort((a, b) => count(b) - count(a));
  return count(best) > 0 ? best : ",";
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** 1–12 for "Nov", "November" or "Sept"; 0 for anything else. */
const monthOf = (s: string) => {
  const w = s.toLowerCase();
  return w.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(w)) + 1 : 0;
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (!m || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Reads a statement date: "15 Nov 2026", "15-Nov-26", "Nov 15, 2026", "2026-11-15", "15/11/2026". For all-number
 * dates like 03/04/2026, `dayFirst` says which part is the day (Pakistani banks print the day first).
 */
export function parseStatementDate(raw: string, dayFirst = true): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  let m = /^(\d{1,2})[\s\-/.]([A-Za-z]{3,9})[\s\-/.,]+(\d{2}|\d{4})\b/.exec(s);
  if (m && monthOf(m[2])) return iso(+m[3], monthOf(m[2]), +m[1]);
  m = /^([A-Za-z]{3,9})[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-/.]+(\d{4})\b/.exec(s);
  if (m && monthOf(m[1])) return iso(+m[3], monthOf(m[1]), +m[2]);
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(s);
  if (m) return dayFirst ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  return null;
}

/**
 * Reads a statement amount into paisa, with its sign: "5,000.00", "PKR 1,00,000", "-23.40", "(23.40)", "23.40 Dr",
 * "23.40CR". Returns null for an empty or unreadable cell; `sign` is set when the cell itself says which way.
 */
export function parseStatementAmount(raw: string): { paisa: number; sign: 1 | -1 | null } | null {
  let s = raw.trim();
  if (!s || s === "-") return null;
  let sign: 1 | -1 | null = null;
  const suffix = /\s*\b(cr|dr)\.?$/i.exec(s);
  if (suffix) {
    sign = suffix[1].toLowerCase() === "dr" ? -1 : 1;
    s = s.slice(0, suffix.index);
  }
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  s = s.replace(/^(pkr|rs\.?|usd|\$|₨)\s*/i, "").replace(/\s*(pkr)$/i, "");
  if (/^[-−]/.test(s)) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    sign = 1;
    s = s.slice(1);
  } else if (/-$/.test(s)) {
    sign = -1;
    s = s.slice(0, -1);
  }
  s = s.replace(/[,\s]/g, "");
  const m = /^(\d{1,13})(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(2, "0");
  // Round anything past two decimals to the nearest paisa.
  const paisa = Number(m[1]) * 100 + Math.round(Number(`${frac.slice(0, 2)}.${frac.slice(2) || "0"}`));
  if (!Number.isSafeInteger(paisa)) return null;
  return { paisa, sign };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function findColumns(header: string[]): StatementColumns | null {
  const cells = header.map(norm);
  const first = (test: (c: string) => boolean, skip: number[] = []) => {
    const i = cells.findIndex((c, idx) => !skip.includes(idx) && test(c));
    return i === -1 ? null : i;
  };
  const words = (c: string) => c.split(" ");
  const isDrCr = (c: string) => {
    const w = words(c);
    return (w.includes("cr") && w.includes("dr")) || ["debit credit", "credit debit", "type", "txn type", "d c", "c d"].includes(c);
  };
  // Prefer the date the money moved over the value date; take the value date only when it's the only one.
  const date = first((c) => /\bdate\b/.test(c) && !/value/.test(c)) ?? first((c) => /\bdate\b/.test(c));
  if (date === null) return null;
  const drcr = first(isDrCr);
  const taken = [date, ...(drcr !== null ? [drcr] : [])];
  const debit = first((c) => !isDrCr(c) && /^(debit|debits|dr|withdrawal|withdrawals|withdrawn|paid out|money out|out)( amount| amt| pkr| rs)?$|^(debit|withdrawal) amount|^amount (debit|dr|out)/.test(c), taken);
  const credit = first((c) => !isDrCr(c) && /^(credit|credits|cr|deposit|deposits|paid in|money in|in)( amount| amt| pkr| rs)?$|^(credit|deposit) amount|^amount (credit|cr|in)/.test(c), taken);
  const amount = debit !== null && credit !== null ? null : first((c) => /\b(amount|amt)\b|^(transaction )?value$/.test(c) && !/balance/.test(c), taken);
  if (amount === null && (debit === null || credit === null)) return null;
  const description = first((c) => /description|narration|particular|details|remarks|memo|transaction type|nature|payee|beneficiary/.test(c), taken);
  const reference = first((c) => /\b(ref|reference|cheque|chq|instrument|trace|txn id|transaction id|stan|rrn)\b/.test(c), taken);
  return { date, description, reference, amount, debit, credit, drcr };
}

/** The first number after a label like "Opening Balance" on the lines above the table. */
function balanceNear(rows: string[][], label: RegExp): number | null {
  for (const r of rows) {
    const i = r.findIndex((c) => label.test(c));
    if (i === -1) continue;
    // "Opening Balance: 12,345.00" in one cell, or the number in a later cell.
    const inline = r[i].split(/[:=]/)[1];
    const cands = [inline ?? "", ...r.slice(i + 1)];
    for (const c of cands) {
      const a = parseStatementAmount(c);
      if (a) return a.paisa * (a.sign ?? 1);
    }
  }
  return null;
}

/** Reads a statement's CSV text. Throws StatementError, in plain words, when it can't find the transactions table. */
export function parseStatement(text: string): Statement {
  const rows = parseCsv(text);
  if (!rows.some((r) => r.some(Boolean))) throw new StatementError("That file is empty.");
  let headerIdx = -1;
  let columns: StatementColumns | null = null;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cols = findColumns(rows[i]);
    if (cols) {
      headerIdx = i;
      columns = cols;
      break;
    }
  }
  if (!columns) {
    throw new StatementError("Couldn't find the transactions table. The statement needs a header row with a Date column, and either an Amount column or Debit and Credit columns. Export it as CSV from your bank's app or website and try again.");
  }
  const cols = columns;
  const body = rows.slice(headerIdx + 1).map((cells, i) => ({ cells, line: headerIdx + i + 2 }));

  // All-number dates: day first, unless a row only makes sense month first (e.g. 11/15/2026).
  let dayFirst = true;
  for (const { cells } of body) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(cells[cols.date] ?? "");
    if (m && +m[2] > 12 && +m[1] <= 12) dayFirst = false;
    if (m && +m[1] > 12) {
      dayFirst = true;
      break;
    }
  }

  const out: StatementRow[] = [];
  const skipped: Statement["skipped"] = [];
  const at = (cells: string[], i: number | null) => (i === null ? "" : cells[i] ?? "");
  for (const { cells, line } of body) {
    const date = parseStatementDate(at(cells, cols.date), dayFirst);
    // Totals, page footers and blank lines have no date: they aren't transactions.
    if (!date) continue;
    const description = at(cells, cols.description).replace(/\s+/g, " ");
    let amountPaisa = 0;
    let direction: Direction | null = null;
    if (cols.debit !== null && cols.credit !== null) {
      const dr = parseStatementAmount(at(cells, cols.debit));
      const cr = parseStatementAmount(at(cells, cols.credit));
      if (dr && dr.paisa > 0) {
        amountPaisa = dr.paisa;
        direction = "out";
      } else if (cr && cr.paisa > 0) {
        amountPaisa = cr.paisa;
        direction = "in";
      }
    } else {
      const a = parseStatementAmount(at(cells, cols.amount));
      if (a && a.paisa > 0) {
        amountPaisa = a.paisa;
        const flag = norm(at(cells, cols.drcr));
        if (/^(dr|d|debit|withdrawal)/.test(flag)) direction = "out";
        else if (/^(cr|c|credit|deposit)/.test(flag)) direction = "in";
        else if (a.sign === -1) direction = "out";
        else if (a.sign === 1) direction = "in";
        else if (cols.drcr === null) direction = "in";
      }
    }
    if (!amountPaisa) {
      // A dated "Opening balance" line inside the table carries no movement.
      if (!/balance|b\/f|brought forward|carried forward/i.test(description)) skipped.push({ line, reason: "no amount" });
      continue;
    }
    if (!direction) {
      skipped.push({ line, reason: "couldn't tell if money went out or came in" });
      continue;
    }
    out.push({ line, date, description, reference: at(cells, cols.reference), amountPaisa, direction });
  }
  if (!out.length) throw new StatementError("Found the table's columns, but no rows with a date and an amount under them.");

  const above = rows.slice(0, headerIdx);
  const dates = out.map((r) => r.date).sort();
  return {
    rows: out,
    header: rows[headerIdx],
    columns: cols,
    skipped,
    openingBalancePaisa: balanceNear(above, /opening\s*balance/i),
    closingBalancePaisa: balanceNear(above, /closing\s*balance/i),
    from: dates[0],
    to: dates[dates.length - 1],
  };
}

/** Whether opening balance + credits − debits comes to the closing balance, i.e. every row was read. Null when the statement doesn't print both. */
export function balancesAddUp(s: Statement): { ok: boolean; differencePaisa: number } | null {
  if (s.openingBalancePaisa === null || s.closingBalancePaisa === null) return null;
  const net = s.rows.reduce((n, r) => n + (r.direction === "in" ? r.amountPaisa : -r.amountPaisa), 0);
  const diff = s.openingBalancePaisa + net - s.closingBalancePaisa;
  return { ok: diff === 0, differencePaisa: diff };
}
