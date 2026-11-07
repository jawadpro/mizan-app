import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileTemplate, matchTemplates, readWithTemplate, senderMatches, type SmsTemplate } from "@/lib/sms/templates";
import { MCB_DEFAULT_TEMPLATES } from "@/lib/sms/mcb-defaults";

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

describe("MCB's message types", () => {
  const recv = new Date("2026-10-20T10:00:00Z");
  const read = (sender: string, text: string) => matchTemplates(MCB_DEFAULT_TEMPLATES, { sender, text, receivedAt: recv });

  it("every default compiles and reads its own example", () => {
    for (const t of MCB_DEFAULT_TEMPLATES) {
      expect(compileTemplate(t).ok).toBe(true);
      expect(readWithTemplate(t, { sender: "6222", text: t.example, receivedAt: recv }) ?? readWithTemplate(t, { sender: "8222", text: t.example, receivedAt: recv })).not.toBeNull();
    }
  });

  it("reads new MCB alerts with changed amounts, names and dates", () => {
    const card = read("MCB Card", "PKR 1,250.00 was charged at KFC DHA PHASE 5, LAHORE PAK via MCB Debit Card 4321 on 19-10-2026 at 13:05. Helpline: 042111000622")!;
    expect(card.reading).toMatchObject({ kind: "expense", amountPaisa: 125000, counterparty: "KFC Dha Phase 5, Lahore Pak", category: "Food & dining" });
    const raast = read("6222", "PKR 7,000.00 received from Usman Tariq NayaPay in your MCB A/C*1234 via RAAST on 19-10-2026 09:10 Tx ID:998877665")!;
    expect(raast.reading).toMatchObject({ kind: "income", amountPaisa: 700000, counterparty: "Usman Tariq", bankRef: "998877665" });
    const sent = read("8222", "PKR3,500.00 sent to HINA MALIK Meezan Bank from A/C *1234 via RAAST on 19-10-2026 08:00 Tx ID PC1100000000000009")!;
    expect(sent.template.hold).toBe(true);
    expect(sent.reading).toMatchObject({ kind: "expense", amountPaisa: 350000, counterparty: "Hina Malik", category: "Transfers", bankRef: "PC1100000000000009" });
  });

  it("only trusts MCB senders", () => {
    const t = MCB_DEFAULT_TEMPLATES[0];
    expect(read("+923001234567", t.example)).toBeNull();
    expect(senderMatches("MCB*, 6222", "mcb transfers")).toBe(true);
    expect(senderMatches("MCB*, 6222", "62220")).toBe(false);
    expect(senderMatches("", "anyone")).toBe(true);
  });

  it("matches the rows migration 010 seeds", () => {
    const sql = readFileSync(new URL("../migrations/010_mcb_templates.sql", import.meta.url), "utf8");
    for (const t of MCB_DEFAULT_TEMPLATES) {
      expect(sql).toContain(`'${t.example.replace(/'/g, "''")}'`);
      expect(sql).toContain(`'${t.sender}', '${t.kind}'`);
    }
    expect(sql.match(/^\s*\(-\d+, 'MCB'/gm)).toHaveLength(MCB_DEFAULT_TEMPLATES.length);
  });
});
