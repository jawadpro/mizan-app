"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiError, setConfirmPrompt } from "./api";
import CloseButton from "./CloseButton";
import PasswordInput from "./PasswordInput";

/**
 * Asks for the passphrase before a sensitive action. Mounted once in the page shell; apiFetch opens it when the
 * server says the action needs the passphrase, and retries the action once it is accepted.
 */
export default function ConfirmPassphrase() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setConfirmPrompt(
      () =>
        new Promise<boolean>((resolve) => {
          // A second request asking while the prompt is open waits on the same answer.
          const prev = resolver.current;
          resolver.current = (ok) => {
            prev?.(ok);
            resolve(ok);
          };
          setPw("");
          setErr(null);
          setOpen(true);
        }),
    );
    return () => setConfirmPrompt(null);
  }, []);

  function finish(ok: boolean) {
    setOpen(false);
    setBusy(false);
    setPw("");
    const r = resolver.current;
    resolver.current = null;
    r?.(ok);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && finish(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/auth/confirm", { method: "POST", body: JSON.stringify({ password: pw }) });
      finish(true);
    } catch (ex) {
      setErr((ex as ApiError).message);
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="modal-back confirm-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && finish(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" style={{ maxWidth: 400 }}>
        <div className="modal-head">
          <h2 id="confirm-title">Enter your passphrase</h2>
          <CloseButton onClick={() => finish(false)} disabled={busy} />
        </div>
        <form onSubmit={submit} className="pass-form">
          <input type="text" name="username" autoComplete="username" value="mizan" readOnly hidden />
          <p className="small muted" style={{ margin: 0 }}>
            This change is protected. Enter your passphrase to go ahead. You won&apos;t be asked again on this device for the next 5 minutes.
          </p>
          <label className="field">Passphrase
            <PasswordInput autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required maxLength={256} />
          </label>
          {err && <div className="alert error" role="alert">{err}</div>}
          <div className="modal-foot">
            <button type="button" className="btn" onClick={() => finish(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || !pw}>{busy ? "Checking…" : "Continue"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
