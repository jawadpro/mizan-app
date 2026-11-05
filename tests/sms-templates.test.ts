import { describe, expect, it } from "vitest";
import { compileTemplate, matchTemplates, readWithTemplate, type SmsTemplate } from "@/lib/sms/templates";

const hbl: SmsTemplate = {
  bank: "HBL", sender: "HBL", kind: "expense", category: null, payee: "FOODPANDA",
  example: "Dear Customer, PKR 2,450.00 has been debited from your HBL A/C ****1234 at FOODPANDA on 15-Oct-2026 14:22. Avl Bal PKR 85,301.17",
};
const at = new Date("2026-11-05T10:00:00Z");

describe("message templates", () => {
  it("reads the example itself", () => {
    const r = readWithTemplate(hbl, { sender: "HBL", text: hbl.example, receivedAt: at })!;
    expect(r).toMatchObject({ kind: "expense", amountPaisa: 245000, counterparty: "Foodpanda", category: "Food & dining", accountHint: "1234", dateSource: "message" });
    expect(r.occurredAt.toISOString()).toBe("2026-10-15T09:22:00.000Z");
  });

  it("reads a new alert with a different amount, payee, date and balance", () => {
    const text = "Dear Customer, PKR 18,000 has been debited from your HBL A/C ****1234 at IMTIAZ SUPER MARKET on 3-Nov-2026 09:05. Avl Bal PKR 61,020.50";
    const r = readWithTemplate(hbl, { sender: "hbl", text, receivedAt: at })!;
    expect(r).toMatchObject({ amountPaisa: 1800000, counterparty: "Imtiaz Super Market" });
    expect(r.occurredAt.toISOString()).toBe("2026-11-03T04:05:00.000Z");
  });

  it("ignores other senders, other wording and OTPs", () => {
    expect(readWithTemplate(hbl, { sender: "UBL", text: hbl.example, receivedAt: at })).toBeNull();
    expect(readWithTemplate(hbl, { sender: "HBL", text: "PKR 2,450.00 credited to your HBL A/C ****1234 from ALI on 15-Oct-2026", receivedAt: at })).toBeNull();
    expect(matchTemplates([hbl], { sender: "HBL", text: "Your OTP is 123456. Do not share.", receivedAt: at })).toBeNull();
  });

  it("explains why an example can't be used", () => {
    expect(compileTemplate({ example: "Your account was debited today, thank you", payee: "" })).toMatchObject({ ok: false });
    expect(compileTemplate({ example: hbl.example, payee: "KFC" })).toMatchObject({ ok: false });
  });

  it("treats regex characters in the example as plain text", () => {
    const t: SmsTemplate = { bank: "X", sender: "", kind: "income", category: null, payee: "", example: "(Alert) Rs.5,000 received [IBFT] + thanks?" };
    expect(readWithTemplate(t, { sender: "any", text: "(Alert) Rs.7,500 received [IBFT] + thanks?", receivedAt: at })).toMatchObject({ amountPaisa: 750000, kind: "income", category: "Uncategorized" });
    expect(readWithTemplate(t, { sender: "any", text: "Alert Rs.7,500 received IBFT thanks", receivedAt: at })).toBeNull();
  });
});
