import { describe, expect, it } from "vitest";
import { banksInput, pickBank, senderMatches, type Bank } from "@/lib/banks";
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
  const ubl: Bank & { id: string } = { id: "b-ubl", name: "UBL", senders: "UBL", account_hint: "4248", auto_import: true, hold_transfers: true };
  const pasted = "Your A/c XX4248 is debited by PKR 7,800.00 via Mobile IBFT to XX8373-MUHAMMAD JAWAD ILYAS on 31-08-2026 at 12:21 FT26243CK86C Helpline:111-654-321";
  const at = new Date("2026-08-31T07:22:00Z");

  it("reads another bank's alert once its sender is added", () => {
    expect(readAlert({ sender: "UBL", text: pasted, receivedAt: at }, { banks: [mcb] }).result).toMatchObject({ status: "review", reason: "Sender isn't one of your banks in Settings" });
    const { result, bank } = readAlert({ sender: "UBL", text: pasted, receivedAt: at }, { banks: [mcb, ubl], ownNames: ["Muhammad Jawad Ilyas"] });
    expect(bank?.name).toBe("UBL");
    expect(result).toMatchObject({ status: "parsed", fields: { kind: "expense", amountPaisa: 780000, counterparty: "Muhammad Jawad Ilyas", ownAccount: true, category: "Own accounts", accountHint: "4248", bankRef: "FT26243CK86C" } });
  });
  it("auto-import off and transfer holds are per bank", () => {
    const off = readAlert({ sender: "UBL", text: pasted, receivedAt: at }, { banks: [{ ...ubl, auto_import: false }] });
    expect(off.result).toMatchObject({ status: "review", reason: "Automatic import is off for UBL" });
    const transfer = ALERTS[5];
    expect(readAlert({ sender: transfer[0], text: transfer[1], receivedAt }, { banks: [mcb] }).result.status).toBe("review");
    expect(readAlert({ sender: transfer[0], text: transfer[1], receivedAt }, { banks: [{ ...mcb, hold_transfers: false }] }).result.status).toBe("parsed");
  });
  it("two accounts at one bank are told apart by their digits", () => {
    const a = { ...mcb, id: "a", name: "MCB current", account_hint: "1234" };
    const b = { ...mcb, id: "b", name: "MCB savings", account_hint: "5678" };
    expect(pickBank([a, b], "6222", "5678")?.name).toBe("MCB savings");
    expect(pickBank([a, b], "6222", "1234")?.name).toBe("MCB current");
    expect(pickBank([a, b], "6222", null)?.name).toBe("MCB current");
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
  });
});
