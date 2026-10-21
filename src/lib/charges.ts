import { HttpError } from "./http";
import { parseAmountToPaisa } from "./money";

/** Reads the optional bank charge or tax typed next to a transfer. Empty means none. */
export function readCharges(body: unknown): number {
  const raw = (body as { charges?: unknown } | null)?.charges;
  if (typeof raw !== "string" || !raw.trim()) return 0;
  const c = raw.length <= 20 ? parseAmountToPaisa(raw) : null;
  if (c === null) throw new HttpError(400, "Please fix the highlighted fields", { fields: { charges: ["Enter charges like 150 or 150.50"] } });
  return c;
}
