"use client";
// Draws one transaction as an invoice-style PNG, in the browser, so it can be shared or saved like a photo.
import { formatPaisa } from "@/lib/money";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { C, FONT, HEAD_H, M, P, W, dashed, drawPaper, fit, pill, probe, roundRect, toPng, wrap } from "./paper";
import type { Tx } from "./types";

/** What an invoice needs: the transaction, plus the bank's name when it is known. */
export type InvoiceTx = Pick<Tx, "id" | "kind" | "amount_paisa" | "occurred_at" | "category" | "counterparty" | "note" | "account_hint" | "bank_ref" | "charge_fee_paisa" | "charge_tax_paisa"> & {
  bank?: string | null;
};

/** Bank charges and tax are part of the transfer they were cut from, so they never get an invoice of their own. */
export const canShareInvoice = (t: Pick<Tx, "category">) => t.category !== "Bank charges" && t.category !== "Tax deducted";

/** A short reference printed on the invoice and used for the file name, e.g. TXN-3F9A1C. */
export function invoiceRef(id: string): string {
  return `TXN-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

const paidOut = (t: InvoiceTx) => t.kind === "expense";
/** Who the money went to or came from, else the note or category. */
export function invoiceTitle(t: InvoiceTx) {
  return t.counterparty || t.note || t.category;
}

/** Bank charge and tax the bank added on this transfer. They are listed on their own, never added to the total. */
function charges(t: InvoiceTx): [string, number][] {
  const out: [string, number][] = [];
  if (t.charge_fee_paisa) out.push(["Bank charge", t.charge_fee_paisa]);
  if (t.charge_tax_paisa) out.push(["Tax deducted", t.charge_tax_paisa]);
  return out;
}

function details(t: InvoiceTx): [string, string][] {
  const rows: [string, string][] = [["Date", `${formatDatePkt(t.occurred_at)}, ${formatTimePkt(t.occurred_at)}`]];
  if (t.category !== invoiceTitle(t)) rows.push(["Category", t.category]);
  if (t.bank) rows.push(["Bank", t.bank]);
  if (t.account_hint) rows.push(["Account", `•••• ${t.account_hint}`]);
  if (t.bank_ref) rows.push(["Reference", t.bank_ref]);
  if (t.note && t.note !== invoiceTitle(t)) rows.push(["Note", t.note]);
  return rows;
}

/** Renders the invoice and returns it as a PNG. */
export async function invoicePng(t: InvoiceTx, scale = 2): Promise<Blob> {
  const extra = charges(t);
  const rows = details(t);

  const pr = probe();
  pr.font = `700 30px ${FONT}`;
  const titleLines = wrap(pr, invoiceTitle(t), W - 2 * M - 2 * P);

  let bodyH = 0;
  bodyH += 34; // "Paid to"
  bodyH += titleLines.length * 38; // title
  bodyH += 28; // divider
  bodyH += rows.length * 36;
  bodyH += 28; // divider
  bodyH += 96; // amount + status
  const boxH = extra.length ? 40 + extra.length * 32 + 14 : 0;
  if (extra.length) bodyH += 26 + boxH; // charges box
  bodyH += 70; // footer
  const H = M + HEAD_H + bodyH + P + M + 14;

  const { canvas, ctx, x, xr, top } = await drawPaper(H, "INVOICE", invoiceRef(t.id), scale);

  let y = top + 44;
  ctx.fillStyle = C.muted;
  ctx.font = `600 14px ${FONT}`;
  ctx.fillText(t.counterparty ? (paidOut(t) ? "PAID TO" : "RECEIVED FROM") : paidOut(t) ? "PAYMENT" : "MONEY RECEIVED", x, y);
  y -= 4;
  ctx.fillStyle = C.ink;
  ctx.font = `700 30px ${FONT}`;
  for (const l of titleLines) {
    y += 38;
    ctx.fillText(l, x, y);
  }

  y += 28;
  dashed(ctx, x, xr, y);
  for (const [k, v] of rows) {
    y += 36;
    ctx.fillStyle = C.muted;
    ctx.font = `400 16px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(k, x, y);
    ctx.fillStyle = C.ink;
    ctx.font = `600 16px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(fit(ctx, v, xr - x - 130), xr, y);
  }
  ctx.textAlign = "left";
  y += 28;
  dashed(ctx, x, xr, y);

  // Amount and status
  y += 34;
  ctx.fillStyle = C.muted;
  ctx.font = `600 14px ${FONT}`;
  ctx.fillText(paidOut(t) ? "AMOUNT PAID" : "AMOUNT RECEIVED", x, y);
  y += 46;
  ctx.fillStyle = C.accentInk;
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText(formatPaisa(t.amount_paisa), x, y);
  pill(ctx, paidOut(t) ? "PAID" : "RECEIVED", xr, y, C.accentSoft, C.accentInk);

  // Bank charges, in their own box so they read as separate from the amount above.
  if (extra.length) {
    y += 26;
    const bx = x - 14, bw = xr - x + 28;
    roundRect(ctx, bx, y, bw, boxH, 12);
    ctx.fillStyle = C.page;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.muted;
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText("BANK CHARGES · NOT IN THE AMOUNT", x, y + 28);
    let by = y + 40;
    for (const [k, v] of extra) {
      by += 26;
      ctx.fillStyle = C.muted;
      ctx.font = `400 16px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(k, x, by);
      ctx.fillStyle = C.ink;
      ctx.font = `600 16px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(formatPaisa(v), xr, by);
      by += 6;
    }
    ctx.textAlign = "left";
    y += boxH;
  }

  y += 50;
  ctx.fillStyle = C.muted;
  ctx.font = `500 15px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("Thank you!", W / 2, y);
  y += 22;
  ctx.fillStyle = C.faint;
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText("Made with Mizan", W / 2, y);

  return toPng(canvas, "invoice");
}

/** A plain-text version to go with the image, for apps that drop the picture. */
export function invoiceText(t: InvoiceTx) {
  const who = t.counterparty ? `${paidOut(t) ? " to" : " from"} ${t.counterparty}` : "";
  const fees = charges(t).map(([k, v]) => `${k.toLowerCase()} ${formatPaisa(v)}`).join(", ");
  return `${invoiceRef(t.id)}: ${formatPaisa(t.amount_paisa)} ${paidOut(t) ? "paid" : "received"}${who} on ${formatDatePkt(t.occurred_at)}${t.note && t.note !== t.counterparty ? ` (${t.note})` : ""}.${fees ? ` Bank charges, not included: ${fees}.` : ""}`;
}
