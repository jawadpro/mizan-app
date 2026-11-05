"use client";
import "@/app/settings.css";
import Link from "next/link";
import { useState } from "react";
import { formatPaisa, paisaToDecimal } from "@/lib/money";
import { DUA } from "@/lib/dua";
import type { Prefs } from "@/lib/preferences";
import { apiFetch } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";
import { THEME_LABEL, useTheme, type ThemePref } from "./theme";
import PushToggle from "./PushToggle";
import BankMessages from "./BankMessages";
import { LimitModal, type LimitEdit } from "./SpendingCheck";

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
  const toast = useToast();
  const p = data ? { ...data.prefs, ...local } : null;

  async function save(patch: Partial<Prefs>) {
    setLocal((l) => ({ ...l, ...patch }));
    try {
      await apiFetch("/api/preferences", { method: "PATCH", body: JSON.stringify(patch) });
      toast("Saved", "ok");
    } catch (e) {
      setLocal((l) => {
        const next = { ...l };
        for (const k of Object.keys(patch)) delete next[k as keyof Prefs];
        return next;
      });
      toast((e as Error).message, "error");
    }
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
            <Row title="Spending check" hint="Tips when spending runs ahead of usual, plus your monthly category limits.">
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

          <Section id="ayah" title="Quranic ayah">
            <Row title="Dua for provision" hint={<>Al-Qasas {DUA.ref}, shown beside your balance.</>}>
              <Switch label="Show the dua for provision" on={p.dua} onChange={(v) => save({ dua: v })} />
            </Row>
            <Row title="Urdu translation" hint={DUA.source} dim={!p.dua}>
              <Switch label="Show the Urdu translation" on={p.duaUrdu} disabled={!p.dua} onChange={(v) => save({ duaUrdu: v })} />
            </Row>
            <Row title="English translation" dim={!p.dua}>
              <Switch label="Show the English translation" on={p.duaEnglish} disabled={!p.dua} onChange={(v) => save({ duaEnglish: v })} />
            </Row>
            {p.dua && (
              <div className="set-preview">
                <p className="arabic" dir="rtl" lang="ar">{DUA.arabic}</p>
                {p.duaUrdu && <p className="urdu" dir="rtl" lang="ur">{DUA.urdu}</p>}
                {p.duaEnglish && <p className="english">{DUA.english}</p>}
              </div>
            )}
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
            <BankMessages p={p} save={save} />
          </Section>

          <Section id="appearance" title="Appearance">
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
          </Section>

          <Section id="data" title="Data and setup">
            <Link className="set-link" href="/app/sms"><span><span className="set-title">SMS setup</span><span className="set-hint">Forward MCB alerts from your iPhone.</span></span><span aria-hidden>›</span></Link>
            <Link className="set-link" href="/app/backup"><span><span className="set-title">Backups</span><span className="set-hint">Nightly copies to your Google Drive.</span></span><span aria-hidden>›</span></Link>
            <a className="set-link" href="/api/transactions/export"><span><span className="set-title">Download all transactions</span><span className="set-hint">A CSV file you can open in Excel or Sheets.</span></span><span aria-hidden>↓</span></a>
          </Section>
        </div>
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
