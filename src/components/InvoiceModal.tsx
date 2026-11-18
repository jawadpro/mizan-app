"use client";
import ImageShareModal from "./ImageShareModal";
import { invoicePng, invoiceRef, invoiceText, invoiceTitle, type InvoiceTx } from "./invoice";

/** Shows a transaction as an invoice image, with Share (phone share sheet), Save and Copy. */
export default function InvoiceModal({ tx, onClose }: { tx: InvoiceTx; onClose: () => void }) {
  const slug = (tx.counterparty ?? "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return (
    <ImageShareModal
      title="Share invoice"
      subtitle={invoiceTitle(tx)}
      what="invoice"
      fileName={`${invoiceRef(tx.id)}${slug ? `-${slug}` : ""}.png`}
      make={() => invoicePng(tx)}
      text={invoiceText(tx)}
      onClose={onClose}
    />
  );
}
