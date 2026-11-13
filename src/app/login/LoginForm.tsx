"use client";
import PasswordInput from "@/components/PasswordInput";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiFetch, type ApiError } from "@/components/api";

type Code = { challenge: string; email: string; sent: boolean; recoveryLeft: number };

export default function LoginForm() {
  const expired = useSearchParams().get("expired");
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Signing in on a device that isn't remembered: a code was emailed and is asked for next.
  const [code, setCode] = useState<Code | null>(null);
  const [typed, setTyped] = useState("");
  const [recovery, setRecovery] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<{ needCode?: boolean } & Partial<Code>>("/api/auth/login", { method: "POST", body: JSON.stringify({ password: pw, remember }) });
      if (r.needCode && r.challenge) {
        setCode({ challenge: r.challenge, email: r.email ?? "your email", sent: !!r.sent, recoveryLeft: r.recoveryLeft ?? 0 });
        setRecovery(!r.sent);
        setTyped("");
        setBusy(false);
        return;
      }
      window.location.href = "/app";
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!code) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/auth/verify", { method: "POST", body: JSON.stringify({ challenge: code.challenge, code: typed }) });
      window.location.href = "/app";
    } catch (ex) {
      const a = ex as ApiError & { status: number };
      setErr(a.message);
      setBusy(false);
      // An expired code (or too many tries) needs a fresh one: start again from the passphrase.
      if (/expired|too many times/i.test(a.message)) setCode(null);
    }
  }

  if (code) {
    return (
      <form onSubmit={verify} style={{ display: "grid", gap: 14, marginTop: 18 }}>
        {code.sent ? (
          <div className="alert ok">This device is new to Mizan. We emailed a 6-digit code to <strong>{code.email}</strong>. It works for 10 minutes.</div>
        ) : (
          <div className="alert warn">This device is new to Mizan, but the email with the code couldn&apos;t be sent. Use one of your recovery codes instead.</div>
        )}
        <label className="field">{recovery ? "Recovery code" : "Code from the email"}
          {recovery ? (
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX" maxLength={20} required autoFocus />
          ) : (
            <input className="code-input" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
          )}
        </label>
        {err && <div className="alert error" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy || (recovery ? typed.trim().length < 10 : typed.length !== 6)} style={{ justifyContent: "center" }}>{busy ? "Checking…" : "Sign in"}</button>
        <div className="small muted" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          {code.recoveryLeft > 0 && code.sent && (
            <button type="button" className="link-btn" onClick={() => { setRecovery(!recovery); setTyped(""); setErr(null); }}>
              {recovery ? "Use the emailed code" : "Can't get the email? Use a recovery code"}
            </button>
          )}
          <button type="button" className="link-btn" onClick={() => { setCode(null); setErr(null); }}>Start again</button>
        </div>
        {remember && <div className="small muted">Once you&apos;re in, this device is remembered and won&apos;t be asked for a code again.</div>}
      </form>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 18 }}>
      {expired && !err && <div className="alert warn">Your session ended. Please sign in again.</div>}
      <label className="field">Passphrase
        <PasswordInput autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
      </label>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember me on this device
      </label>
      {err && <div className="alert error" role="alert">{err}</div>}
      <button className="btn primary" disabled={busy || !pw} style={{ justifyContent: "center" }}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
