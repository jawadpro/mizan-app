import { z } from "zod";
import { CURRENCY_CODES, DEFAULT_CURRENCY, type CurrencyCode } from "./money";

/** Feature switches from the Settings page. Unknown or missing keys fall back to these defaults. */
export const DEFAULT_PREFS = {
  spendingCheck: true,
  limitWarnPercent: 80,
  ramadanNotice: true,
  defaultRange: "30d" as "7d" | "30d" | "month" | "12m" | "year",
  /** The owner's name(s) as banks print them, comma-separated, so transfers between their own accounts are recognised. */
  ownNames: "",
  /** Currency every amount is shown in. Display only: stored amounts are never converted. */
  currency: DEFAULT_CURRENCY as CurrencyCode,
  /** A notification for every payment imported from a bank message, not only those needing review. */
  notifyImports: true,
  /** Show the amount and who it was with in notifications (they can appear on the lock screen). */
  notifyDetails: true,
  /** Monthly savings target in paisa; 0 means follow the savings plan's suggestion. */
  savingsTarget: 0,
  /** Monthly savings targets for one bank ("none" for cash) at a time, by bank id; a bank not listed follows the suggestion. */
  savingsTargets: {} as Record<string, number>,
};
export type Prefs = typeof DEFAULT_PREFS;

export const prefsPatch = z
  .object({
    spendingCheck: z.boolean(),
    limitWarnPercent: z.union([z.literal(70), z.literal(80), z.literal(90)]),
    ramadanNotice: z.boolean(),
    defaultRange: z.enum(["7d", "30d", "month", "12m", "year"]),
    currency: z.enum(CURRENCY_CODES),
    notifyImports: z.boolean(),
    notifyDetails: z.boolean(),
    savingsTarget: z.number().int().min(0).max(1e14),
    savingsTargets: z.record(z.string().regex(/^(none|[0-9a-f-]{36})$/), z.number().int().min(1).max(1e14)).refine((r) => Object.keys(r).length <= 40),
    ownNames: z.string().max(300).transform((s) => s.split(",").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ")),
  })
  .partial()
  .strict();

/** Reads stored settings leniently: a bad or old value for one key never breaks the others. */
export function normalizePrefs(raw: unknown): Prefs {
  const out = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    const one = prefsPatch.safeParse({ [k]: v });
    if (one.success) Object.assign(out, one.data);
  }
  return out;
}
