import { z } from "zod";
import { KINDS } from "./categories";
import { parseAmountToPaisa } from "./money";
import { isIsoDate, pktLocalToDate } from "./time";

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
  })
  .refine((v) => !v.endedOn || v.endedOn >= v.startsOn, { message: "End date must be on or after the start date", path: ["endedOn"] })
  .transform(({ percent, ...rest }) => ({ ...rest, percentBp: percent }));
export type SetAsideInput = z.infer<typeof setAsideInput>;
