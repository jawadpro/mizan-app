"use client";
import PasswordInput from "@/components/PasswordInput";
import { CURRENCIES, DEFAULT_CURRENCY, type CurrencyCode } from "@/lib/money";
import { useEffect, useState } from "react";
import { apiFetch } from "@/components/api";
import BankList from "@/components/BankList";
import BankMessages from "@/components/BankMessages";
import MessageTester from "@/components/MessageTester";
import PushToggle from "@/components/PushToggle";
import ShortcutSteps from "@/components/ShortcutSteps";
import SmsToken from "@/components/SmsToken";
import { useToast } from "@/components/Toast";
import { useData } from "@/components/useData";
import type { BankItem } from "@/components/useBanks";
import type { DbState } from "@/lib/config";
import BrandMark from "@/components/BrandMark";

const STEPS = ["Database", "Passphrase", "Banks", "Your name", "iPhone", "Finish"] as const;
const MIN_PASSPHRASE = 12;

function Stepper({ at }: { at: number }) {
  return (
    <ol className="setup-steps" aria-label="Setup steps">
      {STEPS.map((s, i) => (
        <li key={s} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="setup-dot">{i < at ? "✓" : i + 1}</span>
          <span className="setup-label">{s}</span>
        </li>
      ))}
    </ol>
  );
}

function DatabaseStep({ db, next }: { db: DbState; next: () => void }) {
  return (
    <>
      <h1>Welcome to Mizan</h1>
      <p className="muted">A few steps and your private expense tracker is ready. First, Mizan checks that it can store your data.</p>
      <ul className="setup-checks">
        <li className={db === "ok" ? "ok" : "bad"}>
          <strong>Database</strong>
          {db === "ok" && <span>Connected, tables ready ✓</span>}
          {db === "missing" && <span>Not connected. In your Vercel project, open <b>Storage</b>, add a <b>Neon Postgres</b> database and connect it to this project (it sets <code>DATABASE_URL</code>). Then redeploy and reload this page.</span>}
          {db === "not-migrated" && <span>Connected, but the tables aren&apos;t created yet. Redeploy the project (Deployments, then Redeploy) so the setup script runs, then reload this page.</span>}
          {db === "unreachable" && <span>Mizan can&apos;t reach the database. Check that <code>DATABASE_URL</code> is a working Postgres connection string (with <code>sslmode=require</code>), redeploy, then reload.</span>}
        </li>
      </ul>
      <div className="setup-actions">
        {db === "ok" ? <button className="btn primary" onClick={next}>Continue</button> : <button className="btn" onClick={() => window.location.reload()}>Check again</button>}
      </div>
    </>
  );
}

function PassphraseStep({ next }: { next: () => void }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const short = pw.length > 0 && pw.length < MIN_PASSPHRASE;
  const mismatch = again.length > 0 && again !== pw;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/setup", { method: "POST", body: JSON.stringify({ action: "claim", password: pw, remember: true }) });
      next();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <h1>Choose a passphrase</h1>
      <p className="muted">This is the only way into your Mizan. Use a few words you&apos;ll remember, at least {MIN_PASSPHRASE} characters. It can&apos;t be recovered, so keep it somewhere safe.</p>
      <div className="setup-form">
        <label className="field">Passphrase
          <PasswordInput autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
          {short && <span className="hint">{MIN_PASSPHRASE - pw.length} more characters</span>}
        </label>
        <label className="field">Type it again
          <PasswordInput autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          {mismatch && <span className="hint">Doesn&apos;t match yet</span>}
        </label>
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      <div className="setup-actions">
        <button className="btn primary" disabled={busy || pw.length < MIN_PASSPHRASE || again !== pw}>{busy ? "Saving…" : "Save and continue"}</button>
      </div>
    </form>
  );
}

function BanksStep({ next }: { next: () => void }) {
  const banks = useData<{ items: BankItem[] }>("/api/banks");
  const count = banks.data?.items.length ?? 0;
  return (
    <>
      <h1>Add your banks</h1>
      <p className="muted">Add each bank account you get SMS alerts from. <b>Senders</b> is the name or short code the alerts come from, as it shows in Messages (for example a bank&apos;s 4-digit code). Mizan only trusts alerts from these senders.</p>
      <div className="setup-panel"><BankList onSaved={banks.reload} /></div>
      <div className="setup-actions">
        <button className="btn primary" onClick={next} disabled={count === 0}>{count === 0 ? "Save a bank to continue" : "Continue"}</button>
      </div>
    </>
  );
}

function NameStep({ back, next }: { back: () => void; next: () => void }) {
  const toast = useToast();
  const prefs = useData<{ prefs: { ownNames: string; currency: CurrencyCode } }>("/api/preferences");
  const [name, setName] = useState<string | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode | null>(null);
  async function saveCurrency(code: CurrencyCode) {
    setCurrency(code);
    try {
      await apiFetch("/api/preferences", { method: "PATCH", body: JSON.stringify({ currency: code }) });
    } catch (e) {
      setCurrency(null);
      toast((e as Error).message, "error");
    }
  }
  const [version, setVersion] = useState(0);
  const value = name ?? prefs.data?.prefs.ownNames ?? "";
  async function save() {
    if (name === null || name === prefs.data?.prefs.ownNames) return true;
    try {
      await apiFetch("/api/preferences", { method: "PATCH", body: JSON.stringify({ ownNames: name }) });
      prefs.reload();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    }
  }
  return (
    <>
      <h1>Your currency, your name, and a test</h1>
      <p className="muted">Every amount in Mizan is shown in this currency. You can change it later in Settings.</p>
      <div className="setup-panel">
        <label className="field">Currency
          <select value={currency ?? prefs.data?.prefs.currency ?? DEFAULT_CURRENCY} onChange={(e) => saveCurrency(e.target.value as CurrencyCode)}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </label>
      </div>
      <p className="muted" style={{ marginTop: 18 }}>Banks print your name on transfers. With it, Mizan can tell a transfer between your own accounts from a payment to someone else. Add each spelling your banks use, separated by commas. Optional.</p>
      <div className="setup-panel">
        <label className="field">Your name as banks print it
          <input maxLength={300} placeholder="e.g. Muhammad Ali Khan" value={value} onChange={(e) => setName(e.target.value)} onBlur={() => save()} />
        </label>
      </div>
      <p className="muted" style={{ marginTop: 18 }}>Now paste a real alert from one of your banks to check that Mizan reads it correctly. If something&apos;s off, the words below decide whether an alert is spending or income, and you can add your bank&apos;s wording.</p>
      <div className="setup-panel">
        <MessageTester ownNames={value} version={version} />
        <details className="setup-more">
          <summary>Words that tell alerts apart</summary>
          <BankMessages onSaved={() => setVersion((v) => v + 1)} />
        </details>
      </div>
      <div className="setup-actions">
        <button className="btn ghost" onClick={back}>Back</button>
        <button className="btn primary" onClick={async () => { if (await save()) next(); }}>Continue</button>
      </div>
    </>
  );
}

function IphoneStep({ endpoint, back, next }: { endpoint: string; back: () => void; next: () => void }) {
  return (
    <>
      <h1>Forward alerts from your iPhone</h1>
      <p className="muted">Two ready-made Shortcuts send each bank SMS to Mizan as it arrives. Open this page on your iPhone to add them. You can also do this later from SMS setup in the menu.</p>
      <div className="setup-panel">
        <div className="setup-kv"><span>Token</span><SmsToken /></div>
      </div>
      <div className="setup-panel"><ShortcutSteps endpoint={endpoint} /></div>
      <div className="setup-actions">
        <button className="btn ghost" onClick={back}>Back</button>
        <button className="btn primary" onClick={next}>Continue</button>
      </div>
    </>
  );
}

function FinishStep({ back }: { back: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function finish() {
    setBusy(true);
    try {
      await apiFetch("/api/setup", { method: "POST", body: JSON.stringify({ action: "finish" }) });
      window.location.href = "/app";
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  }
  return (
    <>
      <h1>You&apos;re all set</h1>
      <p className="muted">Two optional extras, both also in Settings later:</p>
      <div className="setup-panel">
        <div className="set-row">
          <div className="set-text">
            <div className="set-title">Notifications</div>
            <div className="set-hint">Get a notification on this device when an alert needs your review. On iPhone, add Mizan to your Home Screen first (Share, then Add to Home Screen) and turn this on from there.</div>
          </div>
          <PushToggle />
        </div>
        <div className="set-row">
          <div className="set-text">
            <div className="set-title">Backups to Google Drive</div>
            <div className="set-hint">Nightly backups need a Google OAuth client: add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>CRON_SECRET</code> to your Vercel environment, then connect Drive from Backup. You can also download a backup any time.</div>
          </div>
        </div>
      </div>
      <div className="setup-actions">
        <button className="btn ghost" onClick={back}>Back</button>
        <button className="btn primary" onClick={finish} disabled={busy}>{busy ? "Opening…" : "Open Mizan"}</button>
      </div>
    </>
  );
}

export default function SetupWizard({ db, hasPassword, endpoint }: { db: DbState; hasPassword: boolean; endpoint: string }) {
  const [at, setAt] = useState(hasPassword ? 2 : 0);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [at]);
  const go = (n: number) => () => setAt(n);
  return (
    <div className="setup-wrap">
      <div className="brand setup-brand"><BrandMark /> Mizan</div>
      <Stepper at={at} />
      <div className="card setup-card">
        {at === 0 && <DatabaseStep db={db} next={go(1)} />}
        {at === 1 && <PassphraseStep next={go(2)} />}
        {at === 2 && <BanksStep next={go(3)} />}
        {at === 3 && <NameStep back={go(2)} next={go(4)} />}
        {at === 4 && <IphoneStep endpoint={endpoint} back={go(3)} next={go(5)} />}
        {at === 5 && <FinishStep back={go(4)} />}
      </div>
    </div>
  );
}
