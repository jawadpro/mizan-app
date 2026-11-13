import { z } from "zod";
import { KINDS } from "./categories";
import { parseAmountToPaisa } from "./money";
import { isIsoDate, pktLocalToDate } from "./time";
import { isMonth } from "./monthly";

const trimmed = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => s.normalize("NFKC").replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

export const transactionInput = z.object({
  kind: z.enum(KINDS),
  amount: z
    .string()
    .max(20)
    .transform((s, ctx) => {
      const v = parseAmountToPaisa(s);
      if (v === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter an amount like 1,250 or 1250.50" });
      return v ?? 0;
    }),
  occurredAt: z
    .string()
    .max(20)
    .transform((s, ctx) => {
      const d = pktLocalToDate(s);
      if (!d) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date and time" });
      return d ?? new Date(0);
    }),
  category: trimmed(60).pipe(z.string().min(1, "Choose a category")),
  counterparty: trimmed(120).transform((s) => s || null).nullable().optional(),
  note: trimmed(500).transform((s) => s || null).nullable().optional(),
  setAsideId: z.string().uuid().nullable().optional(),
  /** The bank it went through; left out, an edit keeps the bank it had. */
  bankId: z.string().uuid().nullable().optional(),
});
export type TransactionInput = z.infer<typeof transactionInput>;

export const smsInput = z.object({
  sender: z.string().min(1).max(64),
  text: z.string().min(1).max(1000),
  receivedAt: z
    .string()
    .max(40)
    .refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), "receivedAt must be ISO 8601 with a timezone, e.g. 2026-10-15T14:30:00+05:00"),
}).strict();

export const listQuery = z.object({
  q: z.string().max(100).optional(),
  kind: z.enum(KINDS).optional(),
  category: z.string().max(60).optional(),
  counterparty: z.string().max(120).optional(),
  source: z.enum(["manual", "sms", "demo"]).optional(),
  bank: z.union([z.literal("none"), z.string().uuid()]).optional(),
  from: z.string().refine(isIsoDate).optional(),
  to: z.string().refine(isIsoDate).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuery>;

export const rangeQuery = z.object({
  from: z.string().refine(isIsoDate, "from must be YYYY-MM-DD"),
  to: z.string().refine(isIsoDate, "to must be YYYY-MM-DD"),
  granularity: z.enum(["day", "month", "year"]).default("day"),
  bank: z.union([z.literal("none"), z.string().uuid()]).optional(),
});

export function searchParamsObject(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  new URL(url).searchParams.forEach((v, k) => {
    if (v !== "") out[k] = v;
  });
  return out;
}

export const balanceInput = z.object({
  amount: z
    .string()
    .max(22)
    .transform((s, ctx) => {
      const t = s.trim();
      const neg = t.startsWith("-");
      const v = parseAmountToPaisa(neg ? t.slice(1).trim() : t);
      if (v === null && t.replace(/^-/, "").trim() !== "0") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter your balance like 85,301.17" });
        return 0;
      }
      return (v ?? 0) * (neg ? -1 : 1);
    }),
  /** The bank account the balance is for; needed once there are two or more. */
  bank: z.string().uuid().nullish(),
});

export const setAsideInput = z
  .object({
    name: trimmed(60).pipe(z.string().min(1, "Give it a name, e.g. Charity")),
    percent: z
      .string()
      .max(8)
      .transform((s, ctx) => {
        const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(s);
        const bp = m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : NaN;
        if (!(bp >= 1 && bp <= 10000)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a percentage between 0.01 and 100" });
        return bp;
      }),
    appliesTo: z.enum(["remittance", "income", "incoming"]),
    startsOn: z.string().refine(isIsoDate, "Choose a start date"),
    endedOn: z.string().refine(isIsoDate, "Choose a valid end date").nullable().optional(),
    purpose: z.enum(["giving", "saving"]).optional(),
    /** The bank whose incoming money fills it; null for all banks, left out to keep it as it is. */
    bankId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => !v.endedOn || v.endedOn >= v.startsOn, { message: "End date must be on or after the start date", path: ["endedOn"] })
  .transform(({ percent, ...rest }) => ({ ...rest, percentBp: percent }));
export type SetAsideInput = z.infer<typeof setAsideInput>;

export const limitInput = z.object({
  category: trimmed(60).pipe(z.string().min(1, "Choose a category")),
  amount: z
    .string()
    .max(20)
    .transform((s, ctx) => {
      const v = parseAmountToPaisa(s);
      if (v === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a monthly amount like 15,000" });
      return v ?? 0;
    }),
});

export const limitDelete = z.object({ category: trimmed(60).pipe(z.string().min(1)) });


const month = (msg: string) => z.string().refine(isMonth, msg);
const optionalAmount = (msg: string) =>
  z
    .string()
    .max(20)
    .nullable()
    .optional()
    .transform((s, ctx) => {
      if (s == null || s.trim() === "") return null;
      const v = parseAmountToPaisa(s);
      if (v === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
      return v;
    });

export const monthlyItemInput = z
  .object({
    name: trimmed(60).pipe(z.string().min(1, "Give it a name, e.g. Rent")),
    amount: optionalAmount("Enter an amount like 85,000, or leave it empty if it changes"),
    category: trimmed(60).pipe(z.string().min(1, "Choose a category")),
    payee: trimmed(120).transform((s) => s || null).nullable().optional().transform((s) => s ?? null),
    dueDay: z.number().int().min(1, "Pick a day from 1 to 31").max(31, "Pick a day from 1 to 31").nullable().optional().transform((n) => n ?? null),
    startsMonth: month("Choose the first month"),
    endedMonth: month("Choose a valid last month").nullable().optional().transform((s) => s ?? null),
  })
  .refine((v) => !v.endedMonth || v.endedMonth >= v.startsMonth, { message: "The last month can't be before the first", path: ["endedMonth"] });
export type MonthlyItemInput = z.infer<typeof monthlyItemInput>;

export const monthlyMarkInput = z.object({
  month: month("Choose a month"),
  status: z.enum(["paid", "skipped"]),
  transactionId: z.string().uuid().nullable().optional(),
  /** Marks it fully paid even if the parts add up to less than the usual amount. */
  full: z.boolean().optional(),
  // Left out, an existing amount or note stays as it is.
  amount: z.string().max(20).nullable().optional().transform((s, ctx) => {
    if (s === undefined) return undefined;
    if (s === null || s.trim() === "") return null;
    const v = parseAmountToPaisa(s);
    if (v === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter an amount like 85,000" });
    return v;
  }),
  note: trimmed(200).transform((s) => s || null).nullable().optional(),
});
export type MonthlyMarkInput = z.infer<typeof monthlyMarkInput>;

const shareAmount = z
  .string()
  .max(20)
  .transform((s, ctx) => {
    const v = parseAmountToPaisa(s);
    if (v === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter an amount like 1,500" });
    return v ?? 0;
  });

/** One person's share of a bill. */
export const shareInput = z.object({
  person: trimmed(60).pipe(z.string().min(1, "Who owes this share?")),
  amount: shareAmount,
  note: trimmed(200).transform((s) => s || null).nullable().optional().transform((s) => s ?? null),
});

/** Splitting a payment: one or more shares added at once. */
export const splitInput = z.object({
  transactionId: z.string().uuid(),
  shares: z.array(shareInput).min(1, "Add at least one person").max(30),
});

export const splitAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), transactionId: z.string().uuid() }),
  z.object({ action: z.literal("unlink"), transactionId: z.string().uuid() }),
  z.object({ action: z.literal("settle"), note: trimmed(200).transform((s) => s || null).nullable().optional() }),
  z.object({ action: z.literal("reopen") }),
]);
