"use client";
import { useEffect, useState } from "react";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { apiFetch, CancelledError, type ApiError } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";
import CloseButton from "./CloseButton";

type Device = { id: string; label: string; ip: string | null; created_at: string; last_seen_at: string; remembered: boolean; trusted: boolean; current: boolean };
type State = { emailConfigured: boolean; email: string | null; emailCodesOn: boolean; recoveryLeft: number; devices: Device[] };

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return "active now";
  if (min < 60) return `active ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `active ${h} h ago`;
  return `last active ${formatDatePkt(iso)}`;
}

/** Settings → Sign-in: email codes for new devices, and every device that is signed in. */
export default function Security() {
  const { data, error, loading, reload } = useData<State & { ok: true }>("/api/security");
  const [local, setLocal] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const toast = useToast();
  const s = local ?? data;

  async function act(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    try {
      const r = await apiFetch<State & { recoveryCodes?: string[] }>("/api/security", { method: "POST", body: JSON.stringify(body) });
      setLocal(r);
      if (r.recoveryCodes) setCodes(r.recoveryCodes);
      toast(done, "ok");
    } catch (e) {
      if (!(e instanceof CancelledError)) toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !s) return <Loading rows={3} />;
  if (!s) return null;
  const others = s.devices.filter((d) => !d.current);

  return (
    <>
      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Email code on new devices</div>
          <div className="set-hint">
            {!s.emailConfigured
              ? "Needs email set up on the server first: add RESEND_API_KEY to your Vercel environment variables."
              : s.emailCodesOn
                ? <>On. A device signing in for the first time needs a code sent to <strong>{s.email}</strong>. {s.recoveryLeft} recovery code{s.recoveryLeft === 1 ? "" : "s"} left.</>
                : "When on, signing in on a device Mizan hasn't seen before also needs a code sent to your email. Remembered devices skip it."}
          </div>
        </div>
        <div className="set-control" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {s.emailCodesOn ? (
            <>
              <button className="btn sm" disabled={!!busy} onClick={() => act("recovery", { action: "new-recovery" }, "New recovery codes made. The old ones no longer work.")}>New recovery codes</button>
              <button className="btn sm danger" disabled={!!busy} onClick={() => act("off", { action: "turn-off" }, "Email codes turned off")}>Turn off</button>
            </>
          ) : (
            <button className="btn sm" disabled={!s.emailConfigured || !!busy} onClick={() => setEnabling(true)}>Turn on</button>
          )}
        </div>
      </div>

      <div className="set-row column">
        <div className="set-text">
          <div className="set-title">Signed-in devices</div>
          <div className="set-hint">Signing out a device also forgets it, so it needs your passphrase{s.emailCodesOn ? " and an email code" : ""} to get back in.</div>
        </div>
        <div className="dev-list">
          {s.devices.map((d) => (
            <div key={d.id} className="dev">
              <div className="dev-text">
                <div className="dev-name">
                  {d.label}
                  {d.current && <span className="dev-tag on">This device</span>}
                  {d.trusted && <span className="dev-tag">Remembered</span>}
                </div>
                <div className="dev-meta">
                  {d.current ? "active now" : ago(d.last_seen_at)} · signed in {formatDatePkt(d.created_at)} {formatTimePkt(d.created_at)}{d.ip ? ` · ${d.ip}` : ""}
                </div>
              </div>
              {!d.current && (
                <button className="btn sm danger" disabled={!!busy} onClick={() => act(d.id, { action: "sign-out", id: d.id }, `${d.label} signed out`)}>
                  {busy === d.id ? "Signing out…" : "Sign out"}
                </button>
              )}
            </div>
          ))}
          {others.length > 1 && (
            <div><button className="btn sm danger" disabled={!!busy} onClick={() => act("others", { action: "sign-out-others" }, "Every other device is signed out")}>Sign out all other devices</button></div>
          )}
        </div>
      </div>

      {enabling && (
        <EnableEmailModal
          onClose={() => setEnabling(false)}
          onDone={(r) => {
            setEnabling(false);
            setLocal(r);
            setCodes(r.recoveryCodes);
            toast("Email codes are on", "ok");
          }}
        />
      )}
      {codes && <RecoveryCodesModal codes={codes} onClose={() => setCodes(null)} />}
    </>
  );
}

function useEscape(onClose: () => void, busy: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
}

function EnableEmailModal({ onClose, onDone }: { onClose: () => void; onDone: (r: State & { recoveryCodes: string[] }) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ challenge: string; email: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEscape(onClose, busy);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<{ challenge: string; email: string }>("/api/security", { method: "POST", body: JSON.stringify({ action: "start-email", email }) });
      setSent(r);
      setCode("");
    } catch (ex) {
      if (!(ex instanceof CancelledError)) setErr((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!sent) return;
    setBusy(true);
    setErr(null);
    try {
      onDone(await apiFetch<State & { recoveryCodes: string[] }>("/api/security", { method: "POST", body: JSON.stringify({ action: "confirm-email", challenge: sent.challenge, code }) }));
    } catch (ex) {
      if (!(ex instanceof CancelledError)) setErr((ex as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="email-title" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 id="email-title">Turn on email codes</h2>
          <CloseButton onClick={onClose} disabled={busy} />
        </div>
        {!sent ? (
          <form onSubmit={send} className="pass-form">
            <p className="small muted" style={{ margin: 0 }}>Codes for new devices go to this address. We&apos;ll send one now to check it reaches you.</p>
            <label className="field">Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus maxLength={254} />
            </label>
            {err && <div className="alert error" role="alert">{err}</div>}
            <div className="modal-foot">
              <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Send code"}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={confirm} className="pass-form">
            <p className="small muted" style={{ margin: 0 }}>We sent a 6-digit code to <strong>{sent.email}</strong>. Check spam if it isn&apos;t there in a minute.</p>
            <label className="field">Code
              <input className="code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus />
            </label>
            {err && <div className="alert error" role="alert">{err}</div>}
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => { setSent(null); setErr(null); }} disabled={busy}>Back</button>
              <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Turn on"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function RecoveryCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEscape(onClose, false);
  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rec-title" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 id="rec-title">Save your recovery codes</h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="pass-form">
          <p className="small" style={{ margin: 0 }}>
            If the email with a code ever doesn&apos;t arrive, sign in with one of these instead. Each works once. Keep them somewhere safe, like your password manager. They won&apos;t be shown again.
          </p>
          <div className="recovery-codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true)).catch(() => {})}>{copied ? "Copied" : "Copy"}</button>
            <button type="button" className="btn primary" onClick={onClose}>I&apos;ve saved them</button>
          </div>
        </div>
      </div>
    </div>
  );
}
