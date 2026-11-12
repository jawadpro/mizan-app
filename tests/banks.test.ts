import { describe, expect, it } from "vitest";
import { ACCOUNT_UNCLEAR, banksInput, chooseBank, digitsLabel, pickBank, senderMatches, type Bank } from "@/lib/banks";
import { parseSms } from "@/lib/sms/parser";
import { readAlert } from "@/lib/sms/read";

// The bank migration 011 creates for an existing install.
const mcb: Bank & { id: string } = { id: "b-mcb", name: "MCB", senders: "MCB*, MCBBANK, MCB BANK, MCB-BANK, 6222, 8222", account_hint: "", auto_import: true, hold_transfers: true };
const receivedAt = new Date("2026-10-19T12:00:00Z");

// Every alert the parser tests use, including ones that must go to Review or be ignored.
const ALERTS: [string, string][] = [
  ["6222", "PKR 6,392.60 was charged at NANDOS - MAIN BLVD, LAHORE PAK via MCB Debit Card 4321 on 16-10-2026 at 19:49. Helpline: 042111000622"],
  ["6222", "PKR 250.00 plus tax has been deducted from your account as the monthly fee for SMS Alerts Service on branch transactions"],
  ["6222", "PKR 1,000.00 received via IBFT from ALI RAZA KHAN A/C*9012 on 18-10-2026 19:59. Tx ID 000000123456"],
  ["6222", "PKR 500.00 received from Ali Raza Khan SadaPay in your MCB A/C*1234 via RAAST on 19-10-2026 16:35 Tx ID:112233445"],
  ["8222", "PKR20,000.00 sent to ALI RAZA KHAN A/C *5678 from A/C *1234 via IBFT on 17-10-2026 03:59 Tx ID PC1100000000000001"],
  ["8222", "PKR12,000.00 sent to SARA AHMED UBL from A/C *1234 via RAAST on 17-10-2026 12:22 Tx ID PC1100000000000002"],
  ["6222", "Remittance of PKR 250,000.00 received via IBFT in A/C*1234 on 05-10-2026 20:32. Tx ID 261005000001"],
  ["MCB", "Dear Customer, PKR 2,450.00 has been debited from your A/C ****1234 on 15-Oct-2026 at 14:22 for POS purchase at FOODPANDA KARACHI. Avl Bal PKR 85,301.17"],
  ["MCB Transfers", "PKR 10,000 withdrawn from A/C ****1234 at ATM CLIFTON BR on 15-Oct-2026 12:01. Avl Bal: PKR 40,000"],
  ["MCB", "PKR 1,000 debit reversed and credited to your A/C ****1234"],
  ["MCB", "Your OTP is 123456. Do not share it."],
  ["MCB", "Your MCB A/C ****1234 available balance is PKR 85,301.17 as of 15-Oct-2026"],
];

describe("an existing install reads MCB alerts exactly as before", () => {
  it("the seeded MCB bank gives the same result as the built-in MCB rules", () => {
    for (const [sender, text] of ALERTS) {
      const before = parseSms({ sender, text, receivedAt, ownNames: ["Ali Raza Khan"] });
      const { result, bank } = readAlert({ sender, text, receivedAt }, { banks: [mcb], ownNames: ["Ali Raza Khan"] });
      expect(result).toEqual(before);
      if (result.status !== "ignored") expect(bank?.name).toBe("MCB");
    }
  });
  it("senders from SMS_TRUSTED_SENDERS still count, as the first bank", () => {
    const r = readAlert({ sender: "My Bank Alerts", text: ALERTS[0][1], receivedAt }, { banks: [mcb], extraTrusted: ["My Bank Alerts"] });
    expect(r.result.status).toBe("parsed");
    expect(r.bank?.name).toBe("MCB");
  });
});

describe("banks from Settings", () => {
  // A JS Bank alert, with transfers set to import straight away.
  const ubl: Bank & { id: string } = { id: "b-js", name: "JS Bank", senders: "JS BANK", account_hint: "4248", auto_import: true, hold_transfers: false };
  const pasted = "Your A/c XX4248 is debited by PKR 7,800.00 via Mobile IBFT to XX8373-MUHAMMAD JAWAD ILYAS on 31-08-2026 at 12:21 FT26243CK86C Helpline:111-654-321";
  const at = new Date("2026-08-31T07:22:00Z");

  it("reads another bank's alert once its sender is added", () => {
    expect(readAlert({ sender: "JS BANK", text: pasted, receivedAt: at }, { banks: [mcb] }).result).toMatchObject({ status: "review", reason: "Sender isn't one of your banks in Settings" });
    const { result, bank } = readAlert({ sender: "JS BANK", text: pasted, receivedAt: at }, { banks: [mcb, ubl], ownNames: ["Muhammad Jawad Ilyas"] });
    expect(bank?.name).toBe("JS Bank");
    expect(result).toMatchObject({ status: "parsed", fields: { kind: "expense", amountPaisa: 780000, counterparty: "Muhammad Jawad Ilyas", ownAccount: true, category: "Own accounts", accountHint: "4248", bankRef: "FT26243CK86C" } });
    // With transfer holds on, a Mobile IBFT waits in Review for any bank charge.
    expect(readAlert({ sender: "JS BANK", text: pasted, receivedAt: at }, { banks: [{ ...ubl, hold_transfers: true }] }).result).toMatchObject({ status: "review", reason: "Transfer: add any bank charges, then confirm" });
  });
  it("a paused bank's alerts wait in Review, still filed under it", () => {
    const paused = readAlert({ sender: "JS BANK", text: pasted, receivedAt: at }, { banks: [{ ...ubl, active: false }] });
    expect(paused.bank?.name).toBe("JS Bank");
    expect(paused.result).toMatchObject({ status: "review", reason: "JS Bank is paused", fields: { amountPaisa: 780000 } });
  });
  it("auto-import off and transfer holds are per bank", () => {
    const off = readAlert({ sender: "JS BANK", text: pasted, receivedAt: at }, { banks: [{ ...ubl, auto_import: false }] });
    expect(off.result).toMatchObject({ status: "review", reason: "Automatic import is off for JS Bank" });
    const transfer = ALERTS[5];
    expect(readAlert({ sender: transfer[0], text: transfer[1], receivedAt }, { banks: [mcb] }).result.status).toBe("review");
    expect(readAlert({ sender: transfer[0], text: transfer[1], receivedAt }, { banks: [{ ...mcb, hold_transfers: false }] }).result.status).toBe("parsed");
  });
  it("two accounts at one bank are told apart by their digits", () => {
    const a = { ...mcb, id: "a", name: "MCB current", account_hint: "1234" };
    const b = { ...mcb, id: "b", name: "MCB savings", account_hint: "5678" };
    expect(pickBank([a, b], "6222", "5678")?.name).toBe("MCB savings");
    expect(pickBank([a, b], "6222", "1234")?.name).toBe("MCB current");
    // No digits in the alert: it isn't guessed.
    expect(pickBank([a, b], "6222", null)).toBeNull();
    expect(chooseBank([a, b], "6222", null).unclear).toBe(`${ACCOUNT_UNCLEAR}: the message shows no account number`);
  });
  it("matches senders exactly or by a starting * pattern", () => {
    expect(senderMatches("MCB*, 6222", "MCB Transfers")).toBe(true);
    expect(senderMatches("MCB*, 6222", " 6222 ")).toBe(true);
    expect(senderMatches("MCB*, 6222", "62220")).toBe(false);
    expect(senderMatches("*", "anything")).toBe(false);
    expect(senderMatches("", "MCB")).toBe(false);
  });
  it("checks the Settings form", () => {
    const ok = banksInput.safeParse({ items: [{ name: " HBL ", senders: "HBL,  4250 ,", account_hint: "", auto_import: true, hold_transfers: false }] });
    expect(ok.success && ok.data.items[0]).toMatchObject({ name: "HBL", senders: "HBL, 4250" });
    expect(banksInput.safeParse({ items: [{ name: "", senders: "", account_hint: "", auto_import: true, hold_transfers: true }] }).success).toBe(false);
    expect(banksInput.safeParse({ items: [{ name: "X", senders: "", account_hint: "12", auto_import: true, hold_transfers: true }] }).success).toBe(false);
    // An account and its cards, with commas or spaces between.
    const cards = banksInput.safeParse({ items: [{ name: "X", senders: "", account_hint: " 1234,4321  5678,1234", auto_import: true, hold_transfers: true }] });
    expect(cards.success && cards.data.items[0].account_hint).toBe("1234, 4321, 5678");
    expect(banksInput.safeParse({ items: [{ name: "X", senders: "", account_hint: "1234, 12a4", auto_import: true, hold_transfers: true }] }).success).toBe(false);
    expect(banksInput.safeParse({ items: [{ name: "X", senders: "", account_hint: "1111 2222 3333 4444 5555 6666 7777", auto_import: true, hold_transfers: true }] }).success).toBe(false);
    expect(digitsLabel("1234, 4321")).toBe("••1234 ••4321");
  });
});

describe("several accounts at the same banks", () => {
  // Two MCB accounts (the first with its debit card) and three Bank Alfalah accounts.
  const b = (id: string, name: string, senders: string, account_hint: string): Bank & { id: string } => ({ id, name, senders, account_hint, auto_import: true, hold_transfers: false });
  const banks = [
    b("m1", "MCB Current", "MCB*, 6222, 8222", "1234, 4321"),
    b("m2", "MCB Savings", "MCB*, 6222, 8222", "5678"),
    b("a1", "Alfalah Main", "BAFL, 8756", "6011"),
    b("a2", "Alfalah Business", "BAFL, 8756", "4436"),
    b("a3", "Alfalah Islamic", "BAFL, 8756", "9090"),
  ];
  const read = (sender: string, text: string) => readAlert({ sender, text, receivedAt: new Date("2026-11-08T12:00:00Z") }, { banks, ownNames: ["Ali Raza Khan"] });

  it("each alert lands on its own account", () => {
    expect(read("6222", "PKR 6,392.60 was charged at NANDOS via MCB Debit Card 4321 on 07-11-2026 at 19:49").bank?.name).toBe("MCB Current");
    expect(read("6222", "PKR 500.00 received from SARA in your MCB A/C*5678 via RAAST on 07-11-2026 16:35 Tx ID:112233445").bank?.name).toBe("MCB Savings");
    // The recipient's account (*9999) is not the owner's; the money left *1234.
    expect(read("8222", "PKR20,000.00 sent to BILAL A/C *9999 from A/C *1234 via IBFT on 07-11-2026 03:59 Tx ID PC1100000000000001").bank?.name).toBe("MCB Current");
    expect(read("8756", "Dear Customer,\r\nPKR 10,000.00 and Tax/Charges 5.00 Debited from your A/C: 8350-1***6011 on 7-Nov-26 at 21:44:25").bank?.name).toBe("Alfalah Main");
    expect(read("8756", "Dear Customer,\r\nPKR 1,501,777.07 Credited to your A/C: 8350-1***4436 on 5-Nov-26 at 17:53:56").bank?.name).toBe("Alfalah Business");
    expect(read("BAFL", "PKR 30,000.00 received from MUHAMMAD SAAD BAF in your BAF A/C **9090 on 6-Nov-26 21:34:24 via FT").bank?.name).toBe("Alfalah Islamic");
    expect(read("8756", "PKR 30,000.00 received from MUHAMMAD SAAD BAF in your BAF A/C **9090 on 6-Nov-26 21:34:24 via FT").result.status).toBe("parsed");
  });
  it("an alert whose account can't be told waits in Review with every account it could be", () => {
    const none = read("8756", "PKR 2,000.00 debited for bill payment K-ELECTRIC on 7-Nov-26");
    expect(none.bank).toBeNull();
    expect(none.result).toMatchObject({ status: "review", reason: `${ACCOUNT_UNCLEAR}: the message shows no account number` });
    expect(none.choices.map((x) => x.name)).toEqual(["Alfalah Main", "Alfalah Business", "Alfalah Islamic"]);
    const unknown = read("8756", "PKR 2,000.00 Debited from your A/C: 8350-1***7777 on 7-Nov-26 at 10:00:00");
    expect(unknown.result).toMatchObject({ status: "review", reason: `${ACCOUNT_UNCLEAR}: ••7777 isn't saved on any of your banks`, fields: { accountHint: "7777" } });
    // Only the other party's number: still unclear.
    expect(read("6222", "PKR 1,000.00 received via IBFT from ALI A/C*9012 on 07-11-2026 19:59").result.status).toBe("review");
  });
  it("a number saved on two banks is never guessed between", () => {
    const twice = [...banks, b("m3", "MCB Joint", "MCB*, 6222", "5678")];
    const r = readAlert({ sender: "6222", text: "PKR 500.00 received in your MCB A/C*5678 on 07-11-2026", receivedAt: new Date("2026-11-08T12:00:00Z") }, { banks: twice });
    expect(r.result).toMatchObject({ status: "review", reason: `${ACCOUNT_UNCLEAR}: ••5678 fits more than one of your banks` });
  });
  it("a bank with no digits saved takes the accounts the others don't", () => {
    const withOpen = [...banks, b("a4", "Alfalah other", "BAFL, 8756", "")];
    expect(chooseBank(withOpen, "8756", ["7777"]).bank?.name).toBe("Alfalah other");
    expect(chooseBank(withOpen, "8756", ["4436"]).bank?.name).toBe("Alfalah Business");
    // With no number at all, any of them could be meant.
    expect(chooseBank(withOpen, "8756", []).bank).toBeNull();
  });
  it("one account per bank needs no digits", () => {
    const one = [b("h", "HBL", "HBL", "")];
    expect(chooseBank(one, "HBL", []).bank?.name).toBe("HBL");
    expect(chooseBank(one, "HBL", ["1111"]).bank?.name).toBe("HBL");
    // With digits saved, another account's alert is not filed under it.
    const saved = [b("h", "HBL", "HBL", "5678")];
    expect(chooseBank(saved, "HBL", []).bank?.name).toBe("HBL");
    expect(chooseBank(saved, "HBL", ["1111"]).unclear).toContain("••1111");
  });
  it("a short visible tail still picks its account", () => {
    const js = [b("j1", "JS Main", "JS BANK", "4248"), b("j2", "JS Zindigi", "JS BANK", "1357")];
    expect(chooseBank(js, "JS BANK", ["8"]).bank?.name).toBe("JS Main");
  });
});
