import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { estimateTaxYear, ruleKey, defaultRule, taxYearOf, TREATMENT_LABEL } from "@/lib/tax";
import { availableTaxYears, readTaxSettings, saveTaxSettings, taxPatch, yearTotals } from "@/lib/tax-repo";
import { todayPkt } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  requireSession(req);
  const today = todayPkt();
  const years = await availableTaxYears();
  const asked = Number(new URL(req.url).searchParams.get("year"));
  const taxYear = Number.isInteger(asked) && years.includes(asked) ? asked : taxYearOf(today);
  const [settings, totals] = await Promise.all([readTaxSettings(), yearTotals(taxYear)]);
  const rules = settings.rules;
  const salary = totals.incomes.filter((g) => (rules[ruleKey(g.kind, g.category)] ?? defaultRule(g.kind, g.category)).t === "salary");
  const salaryMonths = Math.max(0, ...salary.map((g) => g.months));
  const salaryThisMonth = salary.some((g) => g.last_month === today.slice(0, 7));
  const fig = settings.years[String(taxYear)] ?? {};
  const result = estimateTaxYear({
    taxYear,
    today,
    incomes: totals.incomes.map(({ kind, category, total, count }) => ({ kind, category, total, count })),
    salaryMonths,
    salaryThisMonth,
    rules,
    bankTaxDeducted: totals.bankTax,
    zakatPaid: totals.zakat,
    charityPaid: totals.charity,
    grossSalaryOverride: fig.grossSalary ?? null,
    employerTaxOverride: fig.employerTax ?? null,
  });
  return json({ ok: true, today, years, result, slip: { grossSalary: fig.grossSalary ?? null, employerTax: fig.employerTax ?? null }, treatments: TREATMENT_LABEL });
});

export const PUT = handle(async (req: Request) => {
  requireSession(req);
  const parsed = taxPatch.safeParse(await readJson(req, 4096));
  if (!parsed.success) throw new HttpError(400, "Please check the tax details", { fields: parsed.error.flatten().fieldErrors });
  const p = parsed.data;
  const s = await readTaxSettings();
  for (const [k, r] of Object.entries(p.rules ?? {})) {
    if (r) s.rules[k] = r;
    else delete s.rules[k];
  }
  if (p.year !== undefined && (p.grossSalary !== undefined || p.employerTax !== undefined)) {
    const key = String(p.year);
    const cur = { ...(s.years[key] ?? {}) };
    if (p.grossSalary !== undefined) cur.grossSalary = p.grossSalary;
    if (p.employerTax !== undefined) cur.employerTax = p.employerTax;
    if (!cur.grossSalary && cur.employerTax == null) delete s.years[key];
    else s.years[key] = cur;
  }
  await saveTaxSettings(s);
  return json({ ok: true });
});
