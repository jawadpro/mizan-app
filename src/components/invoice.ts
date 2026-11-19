"use client";
// Draws one transaction as an invoice-style PNG, in the browser, so it can be shared or saved like a photo.
import { formatPaisa } from "@/lib/money";
import {
  canShareInvoice, invoiceCharges as charges, invoiceDetails as details, invoiceLead, invoiceRef, invoiceText, invoiceTitle, paidOut, type InvoiceTx,
} from "@/lib/invoice-data";
import { C, FONT, HEAD_H, M, P, W, dashed, drawPaper, fit, pill, probe, roundRect, toPng, wrap } from "./paper";

// The invoice's contents live in lib/invoice-data.ts, so the WhatsApp assistant can make the same invoice on the server.
export { canShareInvoice, invoiceRef, invoiceText, invoiceTitle, type InvoiceTx };

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
  ctx.fillText(invoiceLead(t), x, y);
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
