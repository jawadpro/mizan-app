// What goes on a transaction invoice, shared by the browser (components/invoice.ts draws it on a canvas) and the
// server (invoice-image.tsx renders it for the WhatsApp assistant). Pure: no canvas, no database.
import { formatPaisa } from "./money";
import { formatDatePkt, formatTimePkt } from "./time";

/** What an invoice needs: the transaction, plus the bank's name when it is known. */
export type InvoiceTx = {
  id: string;
  kind: "expense" | "income" | "remittance";
  amount_paisa: number;
  occurred_at: string;
  category: string;
  counterparty: string | null;
  note: string | null;
  account_hint: string | null;
  bank_ref: string | null;
  charge_fee_paisa?: number | null;
  charge_tax_paisa?: number | null;
  bank?: string | null;
};

/** Bank charges and tax are part of the transfer they were cut from, so they never get an invoice of their own. */
export const canShareInvoice = (t: { category: string }) => t.category !== "Bank charges" && t.category !== "Tax deducted";

/** A short reference printed on the invoice and used for the file name, e.g. TXN-3F9A1C. */
export function invoiceRef(id: string): string {
  return `TXN-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export const paidOut = (t: Pick<InvoiceTx, "kind">) => t.kind === "expense";

/** Who the money went to or came from, else the note or category. */
export function invoiceTitle(t: Pick<InvoiceTx, "counterparty" | "note" | "category">) {
  return t.counterparty || t.note || t.category;
}

/** The small label above the title. */
export function invoiceLead(t: InvoiceTx) {
  return t.counterparty ? (paidOut(t) ? "PAID TO" : "RECEIVED FROM") : paidOut(t) ? "PAYMENT" : "MONEY RECEIVED";
}

/** Bank charge and tax the bank added on this transfer. They are listed on their own, never added to the total. */
export function invoiceCharges(t: InvoiceTx): [string, number][] {
  const out: [string, number][] = [];
  if (t.charge_fee_paisa) out.push(["Bank charge", t.charge_fee_paisa]);
  if (t.charge_tax_paisa) out.push(["Tax deducted", t.charge_tax_paisa]);
  return out;
}

export function invoiceDetails(t: InvoiceTx): [string, string][] {
  const rows: [string, string][] = [["Date", `${formatDatePkt(t.occurred_at)}, ${formatTimePkt(t.occurred_at)}`]];
  if (t.category !== invoiceTitle(t)) rows.push(["Category", t.category]);
  if (t.bank) rows.push(["Bank", t.bank]);
  if (t.account_hint) rows.push(["Account", `•••• ${t.account_hint}`]);
  if (t.bank_ref) rows.push(["Reference", t.bank_ref]);
  if (t.note && t.note !== invoiceTitle(t)) rows.push(["Note", t.note]);
  return rows;
}

/** A plain-text version to go with the image, for apps that drop the picture. */
export function invoiceText(t: InvoiceTx) {
  const who = t.counterparty ? `${paidOut(t) ? " to" : " from"} ${t.counterparty}` : "";
  const fees = invoiceCharges(t).map(([k, v]) => `${k.toLowerCase()} ${formatPaisa(v)}`).join(", ");
  return `${invoiceRef(t.id)}: ${formatPaisa(t.amount_paisa)} ${paidOut(t) ? "paid" : "received"}${who} on ${formatDatePkt(t.occurred_at)}${t.note && t.note !== t.counterparty ? ` (${t.note})` : ""}.${fees ? ` Bank charges, not included: ${fees}.` : ""}`;
}
