"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useToast } from "./Toast";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { KIND_LABEL, type Kind } from "@/lib/categories";
import { formatPaisa, parseAmountToPaisa, paisaToDecimal } from "@/lib/money";
import { TREATMENTS, type TaxResult, type Treatment } from "@/lib/tax";
import "@/app/zakat.css";
import "@/app/tax.css";

type Data = {
  ok: true;
  today: string;
  years: number[];
  result: TaxResult;
  slip: { grossSalary: number | null; employerTax: number | null };
  treatments: Record<Treatment, string>;
};

const key = (kind: string, category: string) => `${kind}:${category}`;
const yearName = (y: number) => `${y - 1}-${String(y).slice(2)}`;

export default function Tax() {
  const toast = useToast();
  const [year, setYear] = useState<number | null>(null);
  const { data, error, loading, reload } = useData<Data>(year ? `/api/tax?year=${year}` : "/api/tax");
  const [gross, setGross] = useState("");
  const [empTax, setEmpTax] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setGross(data.slip.grossSalary ? paisaToDecimal(data.slip.grossSalary) : "");
    setEmpTax(data.slip.employerTax != null ? paisaToDecimal(data.slip.employerTax) : "");
  }, [data]);

  async function put(body: object, msg: string) {
    setSaving(true);
    try {
      await apiFetch("/api/tax", { method: "PUT", body: JSON.stringify(body) });
      toast(msg, "ok");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const r = data?.result;
  const grossP = gross.trim() ? parseAmountToPaisa(gross) : null;
  const empP = empTax.trim() ? parseAmountToPaisa(empTax) : null;
  const slipInvalid = (gross.trim() && grossP === null) || (empTax.trim() && empP === null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tax</h1>
          <p className="muted">Works out your income tax for the FBR tax year (July to June) from the income and tax in your bank messages.</p>
        </div>
        {data && (
          <label className="field tax-year-pick">Tax year
            <select value={r?.taxYear} onChange={(e) => setYear(Number(e.target.value))}>
              {data.years.map((y) => <option key={y} value={y}>{yearName(y)} (Tax Year {y})</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? <div className="card"><Loading /></div> : r && data && (
        <>
          <div className="card tax-hero">
            <div className="small muted">{r.label}{r.inProgress ? ` · estimate to 30 June, ${r.monthsLeft} month${r.monthsLeft === 1 ? "" : "s"} left` : ""}</div>
            <div className="ramadan-stats">
              <div><span className="small muted">Estimated tax for the year</span><strong>{formatPaisa(r.estimatedTax)}</strong></div>
              <div><span className="small muted">Already deducted</span><strong>{formatPaisa(r.paid.total)}</strong></div>
              <div>
                <span className="small muted">{r.balance > 0 ? "Left to pay" : r.balance < 0 ? "Likely refund" : "Balance"}</span>
                <strong style={{ color: r.balance < 0 ? "var(--green)" : r.balance > 0 ? "var(--danger)" : undefined }}>{r.balance === 0 ? "Nothing due" : formatPaisa(Math.abs(r.balance))}</strong>
              </div>
            </div>
            {r.monthlySetAside > 0 && (
              <p className="small" style={{ marginTop: 10 }}>Putting aside about <strong>{formatPaisa(r.monthlySetAside)}</strong> a month until June would cover it. You can make a set-aside for it.</p>
            )}
            {r.needsAnswer > 0 && (
              <p className="tax-ask small">Tell Mizan what {r.needsAnswer === 1 ? "one income type is" : `${r.needsAnswer} income types are`} below. Until then {r.needsAnswer === 1 ? "it is" : "they are"} left out of the estimate.</p>
            )}
          </div>

          <div className="grid two" style={{ marginTop: 16 }}>
            <div className="card">
              <h2>Income this year</h2>
              <p className="small muted" style={{ marginTop: 4 }}>Added up from your transactions. Choose once how each kind is taxed and Mizan remembers it for every year.</p>
              {r.lines.length === 0 ? <p className="muted" style={{ marginTop: 12 }}>No income recorded in this tax year yet.</p> : (
                <div className="tax-lines">
                  {r.lines.map((l) => (
                    <div key={key(l.kind, l.category)} className={`tax-line${l.rule.t === "ask" ? " ask" : ""}`}>
                      <div className="tax-line-head">
                        <div>
                          <strong>{l.category}</strong>
                          <span className="small muted"> · {KIND_LABEL[l.kind as Kind] ?? l.kind}, {l.count} payment{l.count === 1 ? "" : "s"}</span>
                        </div>
                        <span className="amt">{formatPaisa(l.total)}</span>
                      </div>
                      <div className="tax-line-rule">
                        <select aria-label={`How ${l.category} is taxed`} value={l.rule.t} disabled={saving}
                          onChange={(e) => {
                            const t = e.target.value as Treatment;
                            put({ rules: { [key(l.kind, l.category)]: t === "fixed" ? { t, ratePct: l.rule.ratePct ?? 1 } : { t } } }, "Saved. The estimate is updated.");
                          }}>
                          {TREATMENTS.map((t) => <option key={t} value={t}>{data.treatments[t]}</option>)}
                        </select>
                        {l.rule.t === "fixed" && (
                          <select aria-label="Fixed rate" value={String(l.rule.ratePct ?? 1)} disabled={saving}
                            onChange={(e) => put({ rules: { [key(l.kind, l.category)]: { t: "fixed", ratePct: Number(e.target.value) } } }, "Rate saved.")}>
                            {[0.25, 1, 2].map((p) => <option key={p} value={p}>{p}%{p === 0.25 ? " (PSEB registered)" : ""}</option>)}
                          </select>
                        )}
                        {l.tax > 0 && <span className="small muted">Tax {formatPaisa(l.tax)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2>Salary</h2>
              {r.salary.netSoFar === 0 && !r.salary.fromSlip ? (
                <p className="muted" style={{ marginTop: 12 }}>No salary in this tax year. If your salary comes under another category, set it to “Salary” on the left.</p>
              ) : (
                <table className="tx" style={{ marginTop: 12 }}>
                  <tbody>
                    <tr><td>Take-home received so far ({r.salary.months} month{r.salary.months === 1 ? "" : "s"})</td><td className="amt">{formatPaisa(r.salary.netSoFar)}</td></tr>
                    {r.salary.projected && <tr><td>Take-home expected for the full year</td><td className="amt">{formatPaisa(r.salary.netYear)}</td></tr>}
                    <tr><td>Gross salary {r.salary.fromSlip ? "(from your slip)" : "(worked out)"}</td><td className="amt">{formatPaisa(r.salary.gross)}</td></tr>
                    <tr><td>Tax your employer deducts {r.salary.fromSlip && data.slip.employerTax != null ? "(from your slip)" : "(worked out)"}</td><td className="amt">{formatPaisa(r.salary.employerTax)}</td></tr>
                  </tbody>
                </table>
              )}
              <p className="small muted" style={{ marginTop: 10 }}>
                Bank messages only show take-home pay, so Mizan works out gross salary and the tax your employer took using the salary slabs. If your salary slip or tax certificate says something different, enter those yearly figures instead.
              </p>
              <form className="form-grid" style={{ marginTop: 10 }} onSubmit={(e) => {
                e.preventDefault();
                if (slipInvalid) return;
                put({ year: r.taxYear, grossSalary: grossP, employerTax: empP }, grossP ? "Salary slip figures saved." : "Using worked-out figures again.");
              }}>
                <label className="field">Yearly gross salary (optional)
                  <input inputMode="decimal" placeholder="From your slip" value={gross} onChange={(e) => setGross(e.target.value)} />
                  {gross.trim() && grossP === null && <span className="err">Enter an amount like 24,00,000</span>}
                </label>
                <label className="field">Yearly tax deducted by employer (optional)
                  <input inputMode="decimal" placeholder="From your certificate" value={empTax} onChange={(e) => setEmpTax(e.target.value)} />
                  {empTax.trim() && empP === null && <span className="err">Enter an amount like 1,20,000</span>}
                </label>
                <div className="full" style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary sm" disabled={saving || !!slipInvalid}>Save</button>
                  {(data.slip.grossSalary || data.slip.employerTax != null) && (
                    <button type="button" className="btn ghost sm" disabled={saving} onClick={() => put({ year: r.taxYear, grossSalary: null, employerTax: null }, "Using worked-out figures again.")}>Clear</button>
                  )}
                </div>
              </form>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>How it&apos;s worked out</h2>
            <table className="tx" style={{ marginTop: 12 }}>
              <tbody>
                <tr><td>Gross salary</td><td className="amt">{formatPaisa(r.salary.gross)}</td></tr>
                {r.otherSlabIncome > 0 && <tr><td>Other taxable income</td><td className="amt">+{formatPaisa(r.otherSlabIncome)}</td></tr>}
                {r.zakatDeduction > 0 && <tr><td>Zakat paid this year (deductible)</td><td className="amt">−{formatPaisa(r.zakatDeduction)}</td></tr>}
                <tr><td><strong>Taxable income</strong></td><td className="amt"><strong>{formatPaisa(r.taxableIncome)}</strong></td></tr>
                <tr><td>Tax by {r.slabsUsed === "salaried" ? "salaried" : "non-salaried"} slabs</td><td className="amt">{formatPaisa(r.slabTax)}</td></tr>
                {r.fixedTax > 0 && <tr><td>Fixed-rate tax</td><td className="amt">+{formatPaisa(r.fixedTax)}</td></tr>}
                <tr><td><strong>Estimated tax</strong></td><td className="amt"><strong>{formatPaisa(r.estimatedTax)}</strong></td></tr>
                <tr><td>Deducted by employer</td><td className="amt">−{formatPaisa(r.paid.employer)}</td></tr>
                {r.paid.bank > 0 && <tr><td>Tax deducted by banks</td><td className="amt">−{formatPaisa(r.paid.bank)}</td></tr>}
                {r.paid.fixedAtSource > 0 && <tr><td>Fixed-rate tax deducted by the bank</td><td className="amt">−{formatPaisa(r.paid.fixedAtSource)}</td></tr>}
                <tr><td><strong>{r.balance >= 0 ? "Left to pay" : "Likely refund"}</strong></td><td className="amt"><strong>{formatPaisa(Math.abs(r.balance))}</strong></td></tr>
              </tbody>
            </table>
            <ul className="small muted tax-notes">
              {r.exemptIncome > 0 && <li>{formatPaisa(r.exemptIncome)} of income is marked as not taxed, such as remittances from family abroad. It still goes in your return.</li>}
              {r.charityPaid > 0 && <li>You gave {formatPaisa(r.charityPaid)} in charity. Donations to approved organisations can lower your tax; keep the receipts.</li>}
              <li>Tax deducted by banks counts once you log it as “Tax deducted”. Use the tax switch in the bank charges box on a transfer.</li>
              <li>Slabs from the {r.slabsSource}{r.slabsAssumed ? `. The slabs for Tax Year ${r.taxYear} aren't in Mizan yet, so Tax Year ${r.slabsYear} slabs are used` : ""}.</li>
              <li>This is an estimate to help you prepare your return on IRIS, not tax advice. Check it with a tax adviser for anything unusual.</li>
            </ul>
          </div>
        </>
      )}
    </>
  );
}
