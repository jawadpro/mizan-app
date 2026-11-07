import { describe, expect, it } from "vitest";
import { parseSms } from "@/lib/sms/parser";
import { DEFAULT_SMS_WORDS, normalizeWords, smsWordsInput, wordsRegex } from "@/lib/sms/keywords";

const receivedAt = new Date("2026-10-20T10:00:00Z");

describe("MCB word lists", () => {
  it("a new word sorts an alert the defaults don't know", () => {
    const text = "PKR 1,500.00 billed at KFC DHA via MCB Debit Card 4321 on 19-10-2026 at 13:05";
    expect(parseSms({ sender: "6222", text, receivedAt })).toMatchObject({ status: "review", reason: "Unfamiliar alert: no debit or credit wording" });
    const words = { ...DEFAULT_SMS_WORDS, expense: [...DEFAULT_SMS_WORDS.expense, "billed"] };
    expect(parseSms({ sender: "6222", text, receivedAt, words })).toMatchObject({ status: "parsed", fields: { kind: "expense", amountPaisa: 150000 } });
  });

  it("removing a word stops it counting", () => {
    const text = "PKR 1,000.00 received via IBFT from ALI RAZA KHAN A/C*9012 on 18-10-2026 19:59. Tx ID 000000123456";
    expect(parseSms({ sender: "6222", text, receivedAt }).status).toBe("parsed");
    const words = { ...DEFAULT_SMS_WORDS, income: DEFAULT_SMS_WORDS.income.filter((w) => w !== "received") };
    expect(parseSms({ sender: "6222", text, receivedAt, words }).status).toBe("review");
  });

  it("transfer words send outgoing transfers to review", () => {
    const text = "PKR20,000.00 sent to ALI RAZA KHAN A/C *5678 from A/C *1234 via IBFT on 17-10-2026 03:59 Tx ID PC1100000000000001";
    expect(parseSms({ sender: "8222", text, receivedAt })).toMatchObject({ status: "review", reason: "Transfer: add any bank charges, then confirm" });
    const words = { ...DEFAULT_SMS_WORDS, transfer: [] };
    expect(parseSms({ sender: "8222", text, receivedAt, words }).status).toBe("parsed");
  });

  it("matches whole words only, with any spacing and capitals, and treats symbols as text", () => {
    const re = wordsRegex(["sent to", "a+b"]);
    expect(re.test("SENT   TO Ali")).toBe(true);
    expect(re.test("resent today")).toBe(false);
    expect(re.test("paid a+b")).toBe(true);
    expect(re.test("paid aab")).toBe(false);
    expect(wordsRegex([]).test("anything")).toBe(false);
  });

  it("cleans saved lists and falls back to defaults for bad ones", () => {
    expect(smsWordsInput.parse({ expense: ["  Charged ", "charged", "paid"], income: ["received"], remittance: [], transfer: ["via  raast"] }))
      .toEqual({ expense: ["charged", "paid"], income: ["received"], remittance: [], transfer: ["via raast"] });
    expect(smsWordsInput.safeParse({ expense: ["x"], income: [], remittance: [], transfer: [] }).success).toBe(false);
    expect(normalizeWords({ expense: ["billed"], income: "oops" })).toEqual({ ...DEFAULT_SMS_WORDS, expense: ["billed"] });
    expect(normalizeWords(null)).toEqual(DEFAULT_SMS_WORDS);
  });
});
