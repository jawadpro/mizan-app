import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { currentOrNextRamadan, ramadanStart, zakatYearOf } from "@/lib/ramadan";
import { deleteZakatYear, saveZakatYear, zakatRecords } from "@/lib/zakat-repo";
import { todayPkt } from "@/lib/time";

export const dynamic = "force-dynamic";

const paisa = z.number().int().min(0).max(99_999_999_999_999);
const saveInput = z.object({
  hijriYear: z.number().int().min(1400).max(1600),
  basis: z.enum(["silver", "gold"]),
  wealthPaisa: paisa,
  nisabPaisa: paisa,
}).strict();

export const GET = handle(async (req: Request) => {
  requireSession(req);
  const today = todayPkt();
  const ramadan = currentOrNextRamadan(today);
  const { years, payments } = await zakatRecords();

  const paid = new Map<number, number>();
  const withYear = payments.map((p) => {
    const year = zakatYearOf(todayPkt(new Date(p.occurred_at)));
    paid.set(year, (paid.get(year) ?? 0) + p.amount_paisa);
    return { ...p, hijriYear: year };
  });
  const yearNums = new Set<number>([...years.map((y) => y.hijri_year), ...paid.keys()]);
  // Payments made now count towards the Ramadan that is running or coming next.
  const current = ramadan.hijriYear;
  yearNums.add(current);
  const history = [...yearNums].sort((a, b) => b - a).map((y) => {
    const row = years.find((r) => r.hijri_year === y) ?? null;
    const p = paid.get(y) ?? 0;
    return { hijriYear: y, ramadanStart: ramadanStart(y), assessment: row, paid: p, remaining: row ? Math.max(0, row.due_paisa - p) : null };
  });
  return json({ ok: true, today, ramadan, currentYear: current, history, payments: withYear.slice(0, 50) });
});

export const PUT = handle(async (req: Request) => {
  requireSession(req);
  const parsed = saveInput.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, "Please check the Zakat figures", { fields: parsed.error.flatten().fieldErrors });
  const v = parsed.data;
  // The due amount is recomputed here from the figures, never taken from the browser.
  const eligible = v.nisabPaisa > 0 && v.wealthPaisa >= v.nisabPaisa;
  const due = eligible ? Math.ceil(v.wealthPaisa / 40) : 0;
  await saveZakatYear({ hijri_year: v.hijriYear, assessed_on: todayPkt(), basis: v.basis, wealth_paisa: v.wealthPaisa, nisab_paisa: v.nisabPaisa, due_paisa: due });
  return json({ ok: true, due });
});

export const DELETE = handle(async (req: Request) => {
  requireSession(req);
  const year = Number(new URL(req.url).searchParams.get("year"));
  if (!Number.isInteger(year) || year < 1400 || year > 1600) throw new HttpError(400, "Unknown year");
  if (!(await deleteZakatYear(year))) throw new HttpError(404, "Nothing saved for that year");
  return json({ ok: true });
});
