"use client";
// Draws a share's receipt as a PNG, in the browser, so it can be shared to WhatsApp or saved like a photo.
// Always light colours: the image is seen on someone else's phone, whatever theme this one uses.
import { formatPaisa } from "@/lib/money";
import { formatDatePkt } from "@/lib/time";
import { receiptRef } from "@/lib/splits";
import { BRAND_SRC } from "@/lib/brand";

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

const C = {
  page: "#e7eae8",
  card: "#ffffff",
  ink: "#121614",
  muted: "#6b726e",
  faint: "#9aa19c",
  line: "#dce0dd",
  accent: "#1f8a5b",
  accentInk: "#146b45",
  accentSoft: "#e3f3ea",
  due: "#8a5d12",
  dueSoft: "#fbf1dc",
};
const FONT = `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const W = 600;

/** What the bill was: the share's note, else the bill's note, recipient or category. */
export function billTitle(s: ReceiptShare) {
  return s.note || s.bill.note || s.bill.counterparty || s.bill.category;
}

/** Everyone on the bill: each share, plus the owner when they kept a part for themselves. */
export function peopleOnBill(s: ReceiptShare) {
  return s.shares_on_bill + (s.bill.amount_paisa - s.shared_total > 0 ? 1 : 0);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines = 2): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= max || !cur) cur = next;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    let last = kept[lines - 1];
    while (ctx.measureText(`${last}…`).width > max && last.length > 1) last = last.slice(0, -1);
    kept[lines - 1] = `${last}…`;
    return kept;
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("logo"));
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function dashed(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number) {
  ctx.save();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

/** Renders the receipt and returns it as a PNG. */
export async function receiptPng(s: ReceiptShare, owner: string | null, scale = 2): Promise<Blob> {
  const left = Math.max(0, s.amount_paisa - s.paid);
  const paidBack = s.state === "settled";
  const partly = !paidBack && s.paid > 0;
  const people = peopleOnBill(s);

  // Measure first so the card fits its content.
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `700 30px ${FONT}`;
  const titleLines = wrap(probe, billTitle(s), W - 2 * 28 - 2 * 32);
  const rows: [string, string][] = [
    ["Bill total", formatPaisa(s.bill.amount_paisa)],
    ["Split between", `${people} ${people === 1 ? "person" : "people"}`],
  ];
  if (owner) rows.push(["Paid by", owner]);
  if (partly) rows.push(["Paid back so far", formatPaisa(s.paid)]);

  const M = 28; // page margin
  const P = 32; // card padding
  const headH = 96;
  let bodyH = 0;
  bodyH += 34 + 26; // greeting + "here's your share"
  bodyH += 14 + titleLines.length * 38 + 28; // title + date
  bodyH += 28; // divider
  bodyH += rows.length * 40;
  bodyH += 28; // divider
  bodyH += 96; // share amount + status
  bodyH += 70; // footer
  const H = M + headH + bodyH + P + M + 14;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, W, H);

  // Card, with a torn-paper edge at the bottom.
  const cx = M, cy = M, cw = W - 2 * M, ch = H - 2 * M;
  ctx.save();
  ctx.shadowColor = "rgba(16,22,19,0.12)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = C.card;
  ctx.beginPath();
  ctx.moveTo(cx + 20, cy);
  ctx.lineTo(cx + cw - 20, cy);
  ctx.quadraticCurveTo(cx + cw, cy, cx + cw, cy + 20);
  ctx.lineTo(cx + cw, cy + ch - 10);
  const teeth = 18;
  const tw = cw / teeth;
  for (let i = teeth; i > 0; i--) {
    ctx.lineTo(cx + (i - 0.5) * tw, cy + ch);
    ctx.lineTo(cx + (i - 1) * tw, cy + ch - 10);
  }
  ctx.lineTo(cx, cy + 20);
  ctx.quadraticCurveTo(cx, cy, cx + 20, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Header band
  ctx.save();
  roundRect(ctx, cx, cy, cw, headH, 20);
  ctx.clip();
  ctx.fillStyle = C.accent;
  ctx.fillRect(cx, cy, cw, headH);
  ctx.restore();
  ctx.fillStyle = C.accent;
  ctx.fillRect(cx, cy + headH - 20, cw, 20);

  const x = cx + P;
  const xr = cx + cw - P;
  const logo = await loadImage(BRAND_SRC).catch(() => null);
  if (logo) ctx.drawImage(logo, x, cy + headH / 2 - 22, 44, 44);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText("Mizan", x + 56, cy + headH / 2 + 8);
  ctx.textAlign = "right";
  ctx.font = `700 13px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText("RECEIPT", xr, cy + headH / 2 - 4);
  ctx.font = `500 15px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(receiptRef(s.id), xr, cy + headH / 2 + 18);
  ctx.textAlign = "left";

  let y = cy + headH + 44;
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
  ctx.font = `700 14px ${FONT}`;
  const pw = ctx.measureText(label).width + 28;
  const py = y - 30;
  roundRect(ctx, xr - pw, py, pw, 32, 16);
  ctx.fillStyle = paidBack ? C.accentSoft : C.dueSoft;
  ctx.fill();
  ctx.fillStyle = paidBack ? C.accentInk : C.due;
  ctx.textAlign = "center";
  ctx.fillText(label, xr - pw / 2, py + 21);
  ctx.textAlign = "left";

  y += 50;
  ctx.fillStyle = C.muted;
  ctx.font = `500 15px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(paidBack ? "Thank you!" : "Thanks! Please send it when you can.", W / 2, y);
  y += 22;
  ctx.fillStyle = C.faint;
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText("Made with Mizan", W / 2, y);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the receipt"))), "image/png"));
}

/** A plain-text version to go with the image, for apps that drop the picture. */
export function receiptText(s: ReceiptShare, owner: string | null) {
  const left = Math.max(0, s.amount_paisa - s.paid);
  const head = `Hi ${s.person}, your share of ${billTitle(s)} (${formatDatePkt(s.bill.occurred_at)})`;
  if (s.state === "settled") return `${head} was ${formatPaisa(s.amount_paisa)}. Paid, thank you!`;
  return `${head} is ${formatPaisa(s.amount_paisa)}${s.paid > 0 ? `, ${formatPaisa(left)} still to pay` : ""}.${owner ? ` Paid by ${owner}.` : ""}`;
}
