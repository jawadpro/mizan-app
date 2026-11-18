"use client";
// Draws a share's receipt as a PNG, in the browser, so it can be shared to WhatsApp or saved like a photo.
import { formatPaisa } from "@/lib/money";
import { formatDatePkt } from "@/lib/time";
import { receiptRef } from "@/lib/splits";
import { C, FONT, HEAD_H, M, P, W, dashed, drawPaper, pill, probe as newProbe, toPng, wrap } from "./paper";

export type ReceiptShare = {
  id: string;
  person: string;
  amount_paisa: number;
  note: string | null;
  paid: number;
  state: "open" | "settled";
  settled_on: string | null;
  settled_note: string | null;
  shares_on_bill: number;
  shared_total: number;
  bill: { amount_paisa: number; occurred_at: string; category: string; counterparty: string | null; note: string | null };
};

/** What the bill was: the share's note, else the bill's note, recipient or category. */
export function billTitle(s: ReceiptShare) {
  return s.note || s.bill.note || s.bill.counterparty || s.bill.category;
}

/** Everyone on the bill: each share, plus the owner when they kept a part for themselves. */
export function peopleOnBill(s: ReceiptShare) {
  return s.shares_on_bill + (s.bill.amount_paisa - s.shared_total > 0 ? 1 : 0);
}

/** Renders the receipt and returns it as a PNG. */
export async function receiptPng(s: ReceiptShare, owner: string | null, scale = 2): Promise<Blob> {
  const left = Math.max(0, s.amount_paisa - s.paid);
  const paidBack = s.state === "settled";
  const partly = !paidBack && s.paid > 0;
  const people = peopleOnBill(s);

  // Measure first so the card fits its content.
  const probe = newProbe();
  probe.font = `700 30px ${FONT}`;
  const titleLines = wrap(probe, billTitle(s), W - 2 * 28 - 2 * 32);
  const rows: [string, string][] = [
    ["Bill total", formatPaisa(s.bill.amount_paisa)],
    ["Split between", `${people} ${people === 1 ? "person" : "people"}`],
  ];
  if (owner) rows.push(["Paid by", owner]);
  if (partly) rows.push(["Paid back so far", formatPaisa(s.paid)]);

  let bodyH = 0;
  bodyH += 34 + 26; // greeting + "here's your share"
  bodyH += 14 + titleLines.length * 38 + 28; // title + date
  bodyH += 28; // divider
  bodyH += rows.length * 40;
  bodyH += 28; // divider
  bodyH += 96; // share amount + status
  bodyH += 70; // footer
  const H = M + HEAD_H + bodyH + P + M + 14;

  const { canvas, ctx, x, xr, top } = await drawPaper(H, "RECEIPT", receiptRef(s.id), scale);

  let y = top + 44;
  ctx.fillStyle = C.ink;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText(`Hi ${s.person},`, x, y);
  y += 28;
  ctx.fillStyle = C.muted;
  ctx.font = `400 17px ${FONT}`;
  ctx.fillText("Here's your share of", x, y);
  y += 14;
  ctx.fillStyle = C.ink;
  ctx.font = `700 30px ${FONT}`;
  for (const l of titleLines) {
    y += 38;
    ctx.fillText(l, x, y);
  }
  y += 28;
  ctx.fillStyle = C.muted;
  ctx.font = `400 16px ${FONT}`;
  ctx.fillText(formatDatePkt(s.bill.occurred_at), x, y);

  y += 28;
  dashed(ctx, x, xr, y);
  for (const [k, v] of rows) {
    y += 40;
    ctx.fillStyle = C.muted;
    ctx.font = `400 17px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(k, x, y);
    ctx.fillStyle = C.ink;
    ctx.font = `600 17px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(v, xr, y);
  }
  ctx.textAlign = "left";
  y += 28;
  dashed(ctx, x, xr, y);

  // Share amount and status
  y += 34;
  ctx.fillStyle = C.muted;
  ctx.font = `600 14px ${FONT}`;
  ctx.fillText(paidBack ? "YOUR SHARE" : partly ? "STILL TO PAY" : "YOUR SHARE", x, y);
  y += 46;
  ctx.fillStyle = paidBack ? C.accentInk : C.ink;
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText(formatPaisa(partly ? left : s.amount_paisa), x, y);

  const label = paidBack ? `PAID${s.settled_on ? ` · ${formatDatePkt(s.settled_on)}` : ""}` : "DUE";
  pill(ctx, label, xr, y, paidBack ? C.accentSoft : C.dueSoft, paidBack ? C.accentInk : C.due);

  y += 50;
  ctx.fillStyle = C.muted;
  ctx.font = `500 15px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(paidBack ? "Thank you!" : "Thanks! Please send it when you can.", W / 2, y);
  y += 22;
  ctx.fillStyle = C.faint;
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText("Made with Mizan", W / 2, y);

  return toPng(canvas, "receipt");
}

/** A plain-text version to go with the image, for apps that drop the picture. */
export function receiptText(s: ReceiptShare, owner: string | null) {
  const left = Math.max(0, s.amount_paisa - s.paid);
  const head = `Hi ${s.person}, your share of ${billTitle(s)} (${formatDatePkt(s.bill.occurred_at)})`;
  if (s.state === "settled") return `${head} was ${formatPaisa(s.amount_paisa)}. Paid, thank you!`;
  return `${head} is ${formatPaisa(s.amount_paisa)}${s.paid > 0 ? `, ${formatPaisa(left)} still to pay` : ""}.${owner ? ` Paid by ${owner}.` : ""}`;
}
