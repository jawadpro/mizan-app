"use client";
import "@/app/settings.css";
import Link from "next/link";
import { useState } from "react";
import { CURRENCIES, formatPaisa, paisaToDecimal, setDisplayCurrency } from "@/lib/money";
import type { Prefs } from "@/lib/preferences";
import { apiFetch } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";
import { THEME_LABEL, useTheme, type ThemePref } from "./theme";
import PushToggle from "./PushToggle";
import BankMessages from "./BankMessages";
import BankList from "./BankList";
import MessageTester from "./MessageTester";
import { LimitModal, type LimitEdit } from "./SpendingCheck";
import { ChangePassphraseModal } from "./ChangePassphrase";

const rs = (p: number) => formatPaisa(Math.round(p)).replace(/\.\d\d$/, "");
const RANGES: { id: Prefs["defaultRange"]; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "month", label: "This month" },
  { id: "12m", label: "12 months" },
  { id: "year", label: "This year" },
];

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? " on" : ""}`} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="knob" aria-hidden />
    </button>
  );
}

function Row({ title, hint, children, dim }: { title: string; hint?: React.ReactNode; children: React.ReactNode; dim?: boolean }) {
  return (
    <div className={`set-row${dim ? " dim" : ""}`}>
      <div className="set-text">
        <div className="set-title">{title}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="card set-section" id={id}>
      <h2>{title}</h2>
      <div className="set-rows">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { data, error, loading, reload } = useData<{ prefs: Prefs }>("/api/preferences");
  const limits = useData<{ items: { category: string; limit: number }[] }>("/api/limits");
  const [local, setLocal] = useState<Partial<Prefs>>({});
  const [edit, setEdit] = useState<LimitEdit | null>(null);
  const [theme, setTheme] = useTheme();
  const [ownNames, setOwnNames] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [passOpen, setPassOpen] = useState(false);
  const bump = () => setVersion((v) => v + 1);
  const toast = useToast();
  const p = data ? { ...data.prefs, ...local } : null;

  async function save(patch: Partial<Prefs>) {
    setLocal((l) => ({ ...l, ...patch }));
    try {
      await apiFetch("/api/preferences", { method: "PATCH", body: JSON.stringify(patch) });
      toast("Saved", "ok");
      return true;
    } catch (e) {
      setLocal((l) => {
        const next = { ...l };
        for (const k of Object.keys(patch)) delete next[k as keyof Prefs];
        return next;
      });
      toast((e as Error).message, "error");
      return false;
    }
  }

  async function saveCurrency(code: Prefs["currency"]) {
    if (!(await save({ currency: code }))) return;
    setDisplayCurrency(code);
    // Every page formats amounts as it draws, so reload once to show the new currency everywhere.
    window.location.reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Choose what Mizan shows you. These settings apply on every device, except the theme.</p>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !p ? <div className="card"><Loading rows={6} /></div> : p && (
        <div className="set-grid">
          <Section id="home" title="Overview page">
            <Row title="Spending check" hint="A bell at the top shows a count when spending runs ahead of usual or a limit is near. Tap it for the tips and your monthly limits.">
              <Switch label="Spending check" on={p.spendingCheck} onChange={(v) => save({ spendingCheck: v })} />
            </Row>
            <Row title="Ramadan and Zakat reminder" hint="A note from 30 days before Ramadan until it ends, with a link to the Zakat page.">
              <Switch label="Ramadan and Zakat reminder" on={p.ramadanNotice} onChange={(v) => save({ ramadanNotice: v })} />
            </Row>
            <Row title="Date range when it opens" hint="You can still change it on the page each time.">
              <select value={p.defaultRange} onChange={(e) => save({ defaultRange: e.target.value as Prefs["defaultRange"] })} aria-label="Default date range">
                {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Row>
          </Section>

          <Section id="spending" title="Spending check">
            <Row title="Warn me when a limit reaches" hint="You're always told again once a limit is passed." dim={!p.spendingCheck}>
              <div className="seg" role="group" aria-label="Warn at">
                {([70, 80, 90] as const).map((n) => (
                  <button key={n} className={p.limitWarnPercent === n ? "on" : ""} disabled={!p.spendingCheck} onClick={() => save({ limitWarnPercent: n })}>{n}%</button>
                ))}
              </div>
            </Row>
            <div className="set-row column">
              <div className="set-text">
                <div className="set-title">Monthly limits</div>
                <div className="set-hint">A cap on what one category can cost each month.</div>
              </div>
              {limits.error ? <ErrorBox message={limits.error} onRetry={limits.reload} /> : (
                <div className="set-limits">
                  {(limits.data?.items ?? []).map((l) => (
                    <button key={l.category} className="set-limit" onClick={() => setEdit({ category: l.category, amount: paisaToDecimal(l.limit).replace(/\.00$/, ""), existing: true })}>
                      <span>{l.category}</span><span className="num">{rs(l.limit)} <span className="muted">a month ›</span></span>
                    </button>
                  ))}
                  {limits.data && limits.data.items.length === 0 && <div className="small muted">No limits yet.</div>}
                  <div><button className="btn sm" onClick={() => setEdit({ category: "", amount: "", existing: false })}>Add a limit</button></div>
                </div>
              )}
            </div>
          </Section>

          <Section id="bank" title="Bank messages">
            <BankList onSaved={bump} />
            <Row title="Your name" hint="As banks print it in alerts. Separate several with commas. Transfers to or from this name are filed under Own accounts, not spending.">
              <input className="set-name" aria-label="Your name as banks print it" maxLength={300} placeholder="e.g. Muhammad Ali Khan" value={ownNames ?? p.ownNames}
                onChange={(e) => setOwnNames(e.target.value)}
                onBlur={() => { if (ownNames !== null && ownNames !== p.ownNames) save({ ownNames }); setOwnNames(null); }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            </Row>
            <BankMessages onSaved={bump} />
            <MessageTester ownNames={ownNames ?? p.ownNames} version={version} />
          </Section>

          <Section id="appearance" title="Appearance">
            <Row title="Currency" hint="Every amount is shown in this currency, on every device. Amounts are not converted.">
              <select value={p.currency} onChange={(e) => saveCurrency(e.target.value as Prefs["currency"])} aria-label="Currency">
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
              </select>
            </Row>
            <Row title="Theme" hint="Saved on this device only.">
              <div className="seg" role="group" aria-label="Theme">
                {(["system", "light", "dark"] as ThemePref[]).map((t) => (
                  <button key={t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>{THEME_LABEL[t]}</button>
                ))}
              </div>
            </Row>
          </Section>

          <Section id="notifications" title="Notifications">
            <div className="set-push"><PushToggle /></div>
            <Row title="New payments" hint="A notification for every payment added from a bank message, not only the ones that need review.">
              <Switch label="Notify about new payments" on={p.notifyImports} onChange={(v) => save({ notifyImports: v })} />
            </Row>
            <Row title="Show amounts and names" hint="Shows the amount and who it was with, e.g. “Spent Rs 2,450 · Imtiaz”. Turn off if others can see your lock screen.">
              <Switch label="Show amounts and names in notifications" on={p.notifyDetails} onChange={(v) => save({ notifyDetails: v })} />
            </Row>
          </Section>

          <Section id="security" title="Sign-in">
            <Row title="Passphrase" hint="Change the passphrase you sign in with. Other devices are signed out when you do.">
              <button className="btn sm" onClick={() => setPassOpen(true)}>Change passphrase</button>
            </Row>
          </Section>

          <Section id="data" title="Data and setup">
            <Link className="set-link" href="/app/sms"><span><span className="set-title">SMS setup</span><span className="set-hint">Forward bank alerts from your iPhone.</span></span><span aria-hidden>›</span></Link>
            <Link className="set-link" href="/app/backup"><span><span className="set-title">Backups</span><span className="set-hint">Nightly copies to your Google Drive.</span></span><span aria-hidden>›</span></Link>
            <a className="set-link" href="/api/transactions/export"><span><span className="set-title">Download all transactions</span><span className="set-hint">A CSV file you can open in Excel or Sheets.</span></span><span aria-hidden>↓</span></a>
          </Section>
        </div>
      )}

      {passOpen && (
        <ChangePassphraseModal
          onClose={() => setPassOpen(false)}
          onDone={() => {
            setPassOpen(false);
            toast("Passphrase changed. Other devices are signed out.", "ok");
          }}
        />
      )}

      {edit && (
        <LimitModal
          edit={edit}
          taken={limits.data?.items.map((l) => l.category) ?? []}
          onClose={() => setEdit(null)}
          onSaved={(msg) => {
            setEdit(null);
            toast(msg, "ok");
            limits.reload();
          }}
        />
      )}
    </>
  );
}
