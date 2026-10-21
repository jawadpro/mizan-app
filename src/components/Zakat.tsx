"use client";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { useToast } from "./Toast";
import "@/app/zakat.css";
import { formatPaisa, parseAmountToPaisa } from "@/lib/money";
import { formatDatePkt, formatTimePkt, isIsoDate, todayPkt } from "@/lib/time";
import { computeZakat, NISAB_TOLA, type NisabBasis } from "@/lib/zakat";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import type { BalanceSummary } from "./types";

type Live = { ok: true; goldPerTola: number; silverPerTola: number; pkrPerUsd: number; pricesAt: string; fxAt: string; source: string };

type Saved = { basis: NisabBasis; price: string; other: string; debts: string };
const KEY = "mizan.zakat.v1";
const DEFAULTS: Saved = { basis: "silver", price: "", other: "", debts: "" };

type Ramadan = { hijriYear: number; start: string; end: string; now: boolean; daysUntil: number };
type Year = {
  hijriYear: number;
  ramadanStart: string;
  assessment: { assessed_on: string; basis: NisabBasis; wealth_paisa: number; nisab_paisa: number; due_paisa: number } | null;
  paid: number;
  remaining: number | null;
};
type Payment = { id: string; amount_paisa: number; occurred_at: string; counterparty: string | null; hijriYear: number };
type Records = { ok: true; today: string; ramadan: Ramadan; currentYear: number; history: Year[]; payments: Payment[] };

const day = (iso: string) => formatDatePkt(`${iso}T12:00:00+05:00`);

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Empty means zero; anything else must be a valid amount. */
function amt(s: string): number | null {
  return s.trim() === "" ? 0 : parseAmountToPaisa(s);
}

export default function Zakat() {
  const { data, error, loading, reload } = useData<BalanceSummary & { ok: true }>("/api/balance");
  const live = useData<Live>("/api/metal-prices");
  const rec = useData<Records>("/api/zakat");
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [pay, setPay] = useState({ amount: "", date: "", to: "" });
  const [payErr, setPayErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [s, setS] = useState<Saved>(DEFAULTS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setS(load());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable: values just aren't remembered */
    }
  }, [s, ready]);

  const set = (k: keyof Saved, v: string) => setS((x) => ({ ...x, [k]: v }));
  const livePrice = live.data ? (s.basis === "silver" ? live.data.silverPerTola : live.data.goldPerTola) : null;
  const manual = s.price.trim() !== "";
  const price = manual ? parseAmountToPaisa(s.price) : livePrice;
  const other = amt(s.other);
  const debts = amt(s.debts);
  const bank = data?.balance?.balance ?? null;
  const r = price !== null && other !== null && debts !== null && bank !== null
    ? computeZakat({ basis: s.basis, pricePerTolaPaisa: price, bankPaisa: bank, otherAssetsPaisa: other, debtsPaisa: debts })
    : null;
  const ramadan = rec.data?.ramadan ?? null;
  const thisYear = rec.data ? rec.data.history.find((y) => y.hijriYear === rec.data!.currentYear) ?? null : null;
  const saveYear = ramadan?.hijriYear ?? null;

  async function saveAssessment() {
    if (!r || saveYear === null) return;
    setSaving(true);
    try {
      await apiFetch("/api/zakat", { method: "PUT", body: JSON.stringify({ hijriYear: saveYear, basis: s.basis, wealthPaisa: r.wealth, nisabPaisa: r.nisab }) });
      toast(`Saved as your Zakat for Ramadan ${saveYear}`, "ok");
      rec.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmountToPaisa(pay.amount);
    const date = pay.date || todayPkt();
    if (amount === null || amount <= 0) return setPayErr("Enter an amount like 5,000");
    if (!isIsoDate(date) || date > todayPkt()) return setPayErr("Choose today or an earlier date");
    setPayErr(null);
    setPaying(true);
    try {
      await apiFetch("/api/transactions", {
        method: "POST",
        body: JSON.stringify({ kind: "expense", amount: pay.amount, occurredAt: `${date}T12:00`, category: "Zakat", counterparty: pay.to.trim() || null }),
      });
      toast("Zakat payment recorded", "ok");
      setPay({ amount: "", date: "", to: "" });
      rec.reload();
      reload();
    } catch (err) {
      setPayErr(err instanceof ApiError ? err.message : "Could not record the payment");
    } finally {
      setPaying(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Zakat</h1>
          <p className="muted">Checks your MCB balance and other savings against the nisab and works out 2.5% if Zakat is due.</p>
        </div>
      </div>

      {ramadan && (
        <div className={`card ramadan-card${ramadan.now ? " now" : ""}`} style={{ marginBottom: 16 }}>
          <div className="ramadan-head">
            <div>
              <div className="small muted">{ramadan.now ? "Ramadan is here" : "Next Ramadan"}</div>
              <h2 style={{ marginTop: 2 }}>Ramadan {ramadan.hijriYear}</h2>
              <div className="muted small">
                {ramadan.now ? `Until around ${day(ramadan.end)}` : `Starts around ${day(ramadan.start)}`}. Pakistan may start or end a day later, depending on the moon sighting.
              </div>
            </div>
            {!ramadan.now && (
              <div className="ramadan-count" aria-label={`${ramadan.daysUntil} days to go`}>
                <strong>{ramadan.daysUntil}</strong>
                <span>{ramadan.daysUntil === 1 ? "day to go" : "days to go"}</span>
              </div>
            )}
          </div>
          {thisYear?.assessment ? (
            <div className="ramadan-stats">
              <div><span className="small muted">Zakat due</span><strong>{formatPaisa(thisYear.assessment.due_paisa)}</strong></div>
              <div><span className="small muted">Paid</span><strong>{formatPaisa(thisYear.paid)}</strong></div>
              <div><span className="small muted">Left to pay</span><strong style={{ color: thisYear.remaining ? undefined : "var(--green)" }}>{thisYear.remaining ? formatPaisa(thisYear.remaining) : "All paid"}</strong></div>
            </div>
          ) : (
            <p className="small" style={{ marginTop: 10 }}>
              {ramadan.now
                ? "Work out your Zakat below with today's balance and prices, then save it as this Ramadan's Zakat."
                : ramadan.daysUntil <= 30
                  ? "Ramadan is close. On the first day, work out your Zakat below with that day's balance and prices, then save it."
                  : "On the first day of Ramadan, work out your Zakat below with that day's balance and prices, then save it."}
            </p>
          )}
        </div>
      )}
      {rec.error && <ErrorBox message={rec.error} onRetry={rec.reload} />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? <div className="card"><Loading /></div> : (
        <div className="grid two">
          <div className="card">
            <h2>Your details</h2>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label className="field">Nisab based on
                <select value={s.basis} onChange={(e) => set("basis", e.target.value)}>
                  <option value="silver">Silver ({NISAB_TOLA.silver} tola)</option>
                  <option value="gold">Gold ({NISAB_TOLA.gold} tola)</option>
                </select>
              </label>
              <label className="field">Your own {s.basis} price per tola (optional)
                <input inputMode="decimal" placeholder={livePrice ? `Live: ${formatPaisa(livePrice)}` : s.basis === "silver" ? "e.g. 6,175" : "e.g. 4,39,036"} value={s.price} onChange={(e) => set("price", e.target.value)} />
                {manual && price === null && <span className="err">Enter a price like 6,175</span>}
                {manual && live.data && <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => set("price", "")}>Use live price instead</button>}
              </label>
              <label className="field">Other savings (cash, gold, other accounts)
                <input inputMode="decimal" placeholder="0" value={s.other} onChange={(e) => set("other", e.target.value)} />
                {other === null && <span className="err">Enter an amount like 25,000</span>}
              </label>
              <label className="field">Debts due now
                <input inputMode="decimal" placeholder="0" value={s.debts} onChange={(e) => set("debts", e.target.value)} />
                {debts === null && <span className="err">Enter an amount like 10,000</span>}
              </label>
            </div>
            <div className="small muted" style={{ marginTop: 12 }}>
              {live.loading && !live.data ? "Fetching live gold and silver prices…" : live.data ? (
                <>
                  Live prices: gold {formatPaisa(live.data.goldPerTola)} and silver {formatPaisa(live.data.silverPerTola)} per tola, updated {formatDatePkt(live.data.pricesAt)} {formatTimePkt(live.data.pricesAt)} (1 USD = Rs {live.data.pkrPerUsd.toFixed(2)}).
                  {" "}These come from international spot rates via {live.data.source}. Local sarafa rates are usually a little higher, so type your own price above if you prefer them.
                </>
              ) : (
                <>Live prices are unavailable right now, so enter today&apos;s price per tola above. <button type="button" className="btn ghost sm" onClick={live.reload}>Try again</button></>
              )}
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              Many scholars recommend the silver nisab because it is lower and benefits more people. These details are remembered on this device only.
            </p>
          </div>

          <div className="card">
            <h2>Result</h2>
            {bank === null ? (
              <p className="muted" style={{ marginTop: 12 }}>Set your MCB balance on the dashboard first, then come back here.</p>
            ) : price === null ? (
              <p className="muted" style={{ marginTop: 12 }}>{live.loading ? "Fetching live prices…" : `Enter today's ${s.basis} price per tola to check.`}</p>
            ) : !r ? (
              <p className="muted" style={{ marginTop: 12 }}>Fix the highlighted amounts to see the result.</p>
            ) : (
              <>
                <div style={{ fontSize: "1.6rem", fontWeight: 650, marginTop: 12, color: r.eligible ? "var(--green)" : undefined }}>
                  {r.eligible ? `Zakat due: ${formatPaisa(r.due)}` : "Below nisab"}
                </div>
                <p className="small muted" style={{ marginTop: 4 }}>
                  {r.eligible
                    ? `Your zakatable wealth is above the ${s.basis} nisab, so 2.5% of it is due this Ramadan.`
                    : `You need ${formatPaisa(r.shortBy)} more to reach the ${s.basis} nisab, so no Zakat is due on this wealth.`}
                </p>
                <table className="tx" style={{ marginTop: 14 }}>
                  <tbody>
                    <tr><td>MCB balance</td><td className="amt">{formatPaisa(bank)}</td></tr>
                    <tr><td>Other savings</td><td className="amt">+{formatPaisa(other ?? 0)}</td></tr>
                    <tr><td>Debts due now</td><td className="amt">−{formatPaisa(debts ?? 0)}</td></tr>
                    <tr><td><strong>Zakatable wealth</strong></td><td className="amt"><strong>{formatPaisa(r.wealth)}</strong></td></tr>
                    <tr><td>Nisab ({NISAB_TOLA[s.basis]} tola of {s.basis} at {formatPaisa(price)}{manual ? ", your price" : ", live"})</td><td className="amt">{formatPaisa(r.nisab)}</td></tr>
                  </tbody>
                </table>
                {saveYear !== null && (
                  <div style={{ marginTop: 14 }}>
                    <button type="button" className="btn primary" disabled={saving} onClick={saveAssessment}>
                      {saving ? "Saving…" : `Save as Zakat for Ramadan ${saveYear}`}
                    </button>
                    {!ramadan?.now && <p className="small muted" style={{ marginTop: 6 }}>Best done on the first day of Ramadan, so the balance and prices are that day&apos;s. You can save again to update it.</p>}
                  </div>
                )}
              </>
            )}
            <p className="small muted" style={{ marginTop: 14 }}>
              This is a guide based on the numbers above, not a fatwa. For unusual cases such as business stock or long-term loans, ask a scholar you trust.
            </p>
          </div>
        </div>
      )}

      {rec.data && (
        <div className="grid two" style={{ marginTop: 16 }}>
          <form className="card" onSubmit={recordPayment} noValidate>
            <h2>Record a Zakat payment</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Saved as a Zakat expense, so it also comes off your MCB balance.</p>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label className="field">Amount
                <input inputMode="decimal" placeholder="e.g. 5,000" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
              </label>
              <label className="field">Date
                <input type="date" value={pay.date || todayPkt()} max={todayPkt()} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
              </label>
              <label className="field full">Paid to (optional)
                <input placeholder="Person or organisation" maxLength={120} value={pay.to} onChange={(e) => setPay({ ...pay, to: e.target.value })} />
              </label>
            </div>
            {payErr && <div className="err" style={{ marginTop: 8 }}>{payErr}</div>}
            <button className="btn primary" style={{ marginTop: 12 }} disabled={paying}>{paying ? "Saving…" : "Record payment"}</button>
          </form>

          <div className="card">
            <h2>Zakat by year</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Payments count towards the Ramadan they are made in. Anything paid after Eid counts in advance for the next Ramadan.</p>
            <div className="zakat-years">
              {rec.data.history.map((y) => (
                <div key={y.hijriYear} className="zy-row">
                  <div className="zy-head"><strong>Ramadan {y.hijriYear}</strong> <span className="small muted">{day(y.ramadanStart)}</span></div>
                  <div className="ramadan-stats compact">
                    <div><span className="small muted">Due</span><span>{y.assessment ? formatPaisa(y.assessment.due_paisa) : <span className="muted">Not saved</span>}</span></div>
                    <div><span className="small muted">Paid</span><span>{formatPaisa(y.paid)}</span></div>
                    <div><span className="small muted">Left</span><span>{y.remaining === null ? "—" : y.remaining === 0 ? <span style={{ color: "var(--green)" }}>All paid</span> : formatPaisa(y.remaining)}</span></div>
                  </div>
                </div>
              ))}
            </div>
            {rec.data.payments.length > 0 && (
              <>
                <h3 style={{ marginTop: 16, fontSize: "0.95rem" }}>Recent payments</h3>
                <ul className="plain-list small" style={{ marginTop: 6 }}>
                  {rec.data.payments.slice(0, 8).map((p) => (
                    <li key={p.id}>{formatDatePkt(p.occurred_at)}: {formatPaisa(p.amount_paisa)}{p.counterparty ? ` to ${p.counterparty}` : ""}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
