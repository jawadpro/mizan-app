import { describe, expect, it } from "vitest";
import { canShareInvoice, invoiceRef, invoiceText, type InvoiceTx } from "@/components/invoice";

const tx: InvoiceTx = {
  id: "3f9a1c22-0000-4000-8000-000000000000",
  kind: "expense",
  amount_paisa: 1250000,
  occurred_at: "2026-11-17T09:42:00Z",
  category: "Transfers",
  counterparty: "Ahmed Raza",
  note: null,
  account_hint: null,
  bank_ref: null,
  charge_fee_paisa: 2500,
  charge_tax_paisa: null,
};

describe("transaction invoice", () => {
  it("is offered for payments and incoming money, not for bank charges or tax", () => {
    expect(canShareInvoice({ category: "Transfers" })).toBe(true);
    expect(canShareInvoice({ category: "Salary" })).toBe(true);
    expect(canShareInvoice({ category: "Bank charges" })).toBe(false);
    expect(canShareInvoice({ category: "Tax deducted" })).toBe(false);
  });

  it("has a short reference from the id", () => {
    expect(invoiceRef(tx.id)).toBe("TXN-3F9A1C");
  });

  it("keeps bank charges out of the amount in the text", () => {
    expect(invoiceText(tx)).toContain("12,500.00 paid to Ahmed Raza");
    expect(invoiceText(tx)).toContain("Bank charges, not included: bank charge Rs 25.00.");
    expect(invoiceText({ ...tx, kind: "income", counterparty: null, charge_fee_paisa: null })).toContain("12,500.00 received on");
  });
});
