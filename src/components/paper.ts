"use client";
// Shared drawing for the images Mizan shares: a white card with a green header band and a torn-paper edge.
// Always light colours: the image is seen on someone else's phone, whatever theme this one uses.
import { BRAND_SRC } from "@/lib/brand";

export const C = {
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
export const FONT = `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
export const W = 600;
/** Page margin, card padding and header height, in image pixels. */
export const M = 28;
export const P = 32;
export const HEAD_H = 96;

export function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines = 2): string[] {
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
    kept[lines - 1] = fit(ctx, `${kept[lines - 1]}…`, max);
    return kept;
  }
  return out.map((l) => fit(ctx, l, max));
}

/** Cuts text with an ellipsis so it fits in `max` pixels at the current font. */
export function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text.replace(/…$/, "");
  while (ctx.measureText(`${t}…`).width > max && t.length > 1) t = t.slice(0, -1);
  return `${t}…`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("logo"));
    img.src = src;
  });
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function dashed(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number) {
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

/** A rounded pill with centred text whose right edge sits at `xr`, its baseline matched to `y`. */
export function pill(ctx: CanvasRenderingContext2D, label: string, xr: number, y: number, bg: string, fg: string) {
  ctx.save();
  ctx.font = `700 14px ${FONT}`;
  const pw = ctx.measureText(label).width + 28;
  const py = y - 30;
  roundRect(ctx, xr - pw, py, pw, 32, 16);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.fillText(label, xr - pw / 2, py + 21);
  ctx.restore();
}

/** A probe context, for measuring text before the canvas size is known. */
export function probe(): CanvasRenderingContext2D {
  return document.createElement("canvas").getContext("2d")!;
}

/**
 * Makes a canvas `H` tall and draws the page, the card and its green header with the logo,
 * `label` (e.g. RECEIPT) and `ref` on the right. Returns the context and the card's text edges.
 */
export async function drawPaper(H: number, label: string, ref: string, scale: number) {
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
  const headH = HEAD_H;
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
  ctx.fillText(label, xr, cy + headH / 2 - 4);
  ctx.font = `500 15px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(ref, xr, cy + headH / 2 + 18);
  ctx.textAlign = "left";

  return { canvas, ctx, x, xr, top: cy + headH };
}

export function toPng(canvas: HTMLCanvasElement, what: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Could not draw the ${what}`))), "image/png"));
}
