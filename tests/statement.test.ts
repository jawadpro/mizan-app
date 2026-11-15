import { describe, expect, it } from "vitest";
import { balancesAddUp, parseStatement, parseStatementAmount, parseStatementDate, StatementError } from "@/lib/statement";
import { reconcile, suggestEntry, type BookEntry } from "@/lib/reconcile";

// Laid out like an MCB statement export: account lines, then the table with a second Currency column and Cr/Dr.
const MCB = [
  "Account No,0000123456789,MUHAMMAD TEST",
  "Opening Balance,\"50,000.00\"",
  "Closing Balance,\"39,853.23\"",
  "Date,Description,Reference Number,Currency,Amount,Cr/Dr,Currency,Balance",
  "11 Nov 2026,REMITANCE RECEIVED-IBFT,FT2611110001,PKR,\"10,000.00\",Cr,PKR,\"60,000.00\"",
  "12 Nov 2026,P2P SENDING VIA RAAST,RA2611120002,PKR,\"15,000.00\",Dr,PKR,\"45,000.00\"",
  "12 Nov 2026,IBFT SENDING FEE-MCB LIVE,FE2611120003,PKR,23.40,Dr,PKR,\"44,976.60\"",
  "13 Nov 2026,VISA DR POS LOCAL TRAN,PS2611130004,PKR,\"5,000.00\",Dr,PKR,\"39,976.60\"",
  "14 Nov 2026,ATM CASH WITHDRAWAL-LNK,AT2611140005,PKR,100.00,Dr,PKR,\"39,876.60\"",
  "14 Nov 2026,INTRA SWITCH ATM CW FEE,AT2611140006,PKR,23.37,Dr,PKR,\"39,853.23\"",
  "",
].join("\r\n");

describe("reading statements", () => {
  it("reads an MCB-style export, header lines and all", () => {
    const s = parseStatement(MCB);
    expect(s.rows).toHaveLength(6);
    expect(s.rows[0]).toMatchObject({ date: "2026-11-11", description: "REMITANCE RECEIVED-IBFT", reference: "FT2611110001", amountPaisa: 1000000, direction: "in" });
    expect(s.rows[2]).toMatchObject({ date: "2026-11-12", amountPaisa: 2340, direction: "out" });
    expect(s.from).toBe("2026-11-11");
    expect(s.to).toBe("2026-11-14");
    expect(s.openingBalancePaisa).toBe(5000000);
    expect(s.closingBalancePaisa).toBe(3985323);
    expect(balancesAddUp(s)).toEqual({ ok: true, differencePaisa: 0 });
  });

  it("reads separate Debit and Credit columns, day-first dates and a BOM", () => {
    const csv = "﻿Transaction Date,Value Date,Narration,Cheque No,Debit,Credit,Balance\n03/11/2026,04/11/2026,Grocery POS,,\"1,250.50\",,1000\n15/11/2026,15/11/2026,Salary,,,\"1,00,000.00\",2000\nTotal,,,,1250.50,100000,\n";
    const s = parseStatement(csv);
    expect(s.rows).toEqual([
      { line: 2, date: "2026-11-03", description: "Grocery POS", reference: "", amountPaisa: 125050, direction: "out" },
      { line: 3, date: "2026-11-15", description: "Salary", reference: "", amountPaisa: 10000000, direction: "in" },
    ]);
    expect(balancesAddUp(s)).toBeNull();
  });

  it("reads a signed amount column, semicolons and month-first dates", () => {
    const s = parseStatement("Date;Details;Amount\n11/15/2026;Coffee;-4.50\n11/16/2026;Refund;12.00\n");
    expect(s.rows.map((r) => [r.date, r.direction, r.amountPaisa])).toEqual([
      ["2026-11-15", "out", 450],
      ["2026-11-16", "in", 1200],
    ]);
  });

  it("says plainly when there's no table", () => {
    expect(() => parseStatement("hello,world\n1,2\n")).toThrow(StatementError);
    expect(() => parseStatement("")).toThrow(/empty/);
  });

  it("parses dates and amounts in common bank formats", () => {
    expect(parseStatementDate("15 Nov 2026")).toBe("2026-11-15");
    expect(parseStatementDate("15-Nov-26")).toBe("2026-11-15");
    expect(parseStatementDate("Nov 15, 2026")).toBe("2026-11-15");
    expect(parseStatementDate("2026-11-15 14:02")).toBe("2026-11-15");
    expect(parseStatementDate("31 Feb 2026")).toBeNull();
    expect(parseStatementAmount("(23.40)")).toEqual({ paisa: 2340, sign: -1 });
    expect(parseStatementAmount("5,000.00 Dr")).toEqual({ paisa: 500000, sign: -1 });
    expect(parseStatementAmount("PKR 1,00,000")).toEqual({ paisa: 10000000, sign: null });
    expect(parseStatementAmount("")).toBeNull();
  });
});

describe("finding what's missing", () => {
  const e = (id: string, kind: BookEntry["kind"], amount: number, day: string): BookEntry => ({ id, kind, amount_paisa: amount, day });

  it("lists the rows Mizan doesn't have, matching a day either side", () => {
    const s = parseStatement(MCB);
    const book = [
      e("a", "income", 1000000, "2026-11-11"),
      e("b", "expense", 1500000, "2026-11-11"), // logged a day early
      e("c", "expense", 10000, "2026-11-14"),
      e("cash", "expense", 50000, "2026-11-13"), // cash, not on the statement
    ];
    const r = reconcile(s.rows, book);
    expect(r.matched.map((m) => m.entry.id).sort()).toEqual(["a", "b", "c"]);
    expect(r.missing.map((m) => m.description)).toEqual(["IBFT SENDING FEE-MCB LIVE", "VISA DR POS LOCAL TRAN", "INTRA SWITCH ATM CW FEE"]);
    expect(r.extra.map((x) => x.id)).toEqual(["cash"]);
  });

  it("doesn't match across directions or beyond a day", () => {
    const s = parseStatement(MCB);
    const r = reconcile(s.rows, [e("x", "expense", 1000000, "2026-11-11"), e("y", "expense", 500000, "2026-11-15"), e("z", "expense", 500000, "2026-11-16")]);
    expect(r.missing).toHaveLength(6);
    expect(r.extra.map((x) => x.id)).toEqual(["x"]);
  });

  it("counts identical small fees one for one", () => {
    const row = (date: string) => ({ line: 1, date, description: "IBFT SENDING FEE", reference: "", amountPaisa: 2340, direction: "out" as const });
    // Three fees on the statement, two logged; the one logged on the 3rd can only be the fee of the 2nd or 3rd.
    const rows = [row("2026-11-01"), row("2026-11-02"), row("2026-11-03")];
    const r = reconcile(rows, [e("f1", "expense", 2340, "2026-11-01"), e("f2", "expense", 2340, "2026-11-02")]);
    expect(r.matched).toHaveLength(2);
    expect(r.missing.map((m) => m.date)).toEqual(["2026-11-03"]);
    // Finds the largest set of pairs even when the closest-first choice would block one.
    const r2 = reconcile([row("2026-11-02"), row("2026-11-01")], [e("p", "expense", 2340, "2026-11-02"), e("q", "expense", 2340, "2026-11-03")]);
    expect(r2.missing).toHaveLength(0);
  });

  it("suggests a category from the description", () => {
    const s = parseStatement(MCB);
    const by = (d: string) => suggestEntry(s.rows.find((r) => r.description === d)!, "MCB");
    expect(by("IBFT SENDING FEE-MCB LIVE")).toMatchObject({ kind: "expense", category: "Bank charges", counterparty: "MCB" });
    expect(by("INTRA SWITCH ATM CW FEE")).toMatchObject({ category: "Bank charges" });
    expect(by("ATM CASH WITHDRAWAL-LNK")).toMatchObject({ category: "Cash withdrawal", counterparty: null });
    expect(by("VISA DR POS LOCAL TRAN")).toMatchObject({ category: "Shopping" });
    expect(by("P2P SENDING VIA RAAST")).toMatchObject({ category: "Transfers" });
    expect(by("REMITANCE RECEIVED-IBFT")).toMatchObject({ kind: "income", category: "Uncategorized" });
    expect(by("VISA DR POS LOCAL TRAN").note).toBe("From bank statement: VISA DR POS LOCAL TRAN (ref PS2611130004)");
  });
});
