import { HttpError } from "./http";
import { parseAmountToPaisa } from "./money";

/** Expense category for tax a bank cut from a payment, which can be claimed against income tax. */
export const TAX_DEDUCTED = "Tax deducted";
export const BANK_CHARGES = "Bank charges";

/** Whether the box held a bank fee (not claimable) or tax deducted (claimable). Defaults to a fee. */
export function readChargesCategory(body: unknown): string {
  return (body as { chargesKind?: unknown } | null)?.chargesKind === "tax" ? TAX_DEDUCTED : BANK_CHARGES;
}

/** Reads the optional bank charge or tax typed next to a transfer. Empty means none. */
export function readCharges(body: unknown): number {
  const raw = (body as { charges?: unknown } | null)?.charges;
  if (typeof raw !== "string" || !raw.trim()) return 0;
  const c = raw.length <= 20 ? parseAmountToPaisa(raw) : null;
  if (c === null) throw new HttpError(400, "Please fix the highlighted fields", { fields: { charges: ["Enter charges like 150 or 150.50"] } });
  return c;
}

/** New amounts for the bank charge and tax on a transfer being edited; a missing kind is left as it is, 0 removes it. */
export type ChargeEdits = { fee?: number; tax?: number };

/** Reads the edit form's charge boxes: `{ fee?: string, tax?: string }`, where an empty box means none. */
export function readChargeEdits(body: unknown): ChargeEdits {
  const raw = (body as { chargeEdits?: unknown } | null)?.chargeEdits;
  if (!raw || typeof raw !== "object") return {};
  const out: ChargeEdits = {};
  for (const k of ["fee", "tax"] as const) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] = readCharges({ charges: typeof v === "string" ? v : "x" });
  }
  return out;
}
