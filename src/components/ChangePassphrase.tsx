"use client";
import { useEffect, useState } from "react";
import { apiFetch, type ApiError } from "./api";
import CloseButton from "./CloseButton";

const MIN = 12;

/** Settings: change the sign-in passphrase. Other devices are signed out; this one stays signed in. */
export function ChangePassphraseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ current?: string; next?: string; form?: string }>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const tooShort = next.length > 0 && next.trim().length < MIN;
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.trim().length < MIN) return setErr({ next: `Use at least ${MIN} characters` });
    if (next !== confirm) return setErr({ form: "The new passphrase and its confirmation don't match" });
    setBusy(true);
    setErr({});
    try {
      await apiFetch("/api/auth/passphrase", { method: "POST", body: JSON.stringify({ current, next }) });
      onDone();
    } catch (ex) {
      const a = ex as ApiError;
      setErr(a.fields?.current ? { current: a.fields.current[0] } : a.fields?.next ? { next: a.fields.next[0] } : { form: a.message });
      setBusy(false);
    }
  }

  const type = show ? "text" : "password";
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pass-title" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 id="pass-title">Change passphrase</h2>
          <CloseButton onClick={onClose} disabled={busy} />
        </div>
        <form onSubmit={submit} className="pass-form">
          {/* A hidden username helps password managers save the new passphrase against Mizan. */}
          <input type="text" name="username" autoComplete="username" value="mizan" readOnly hidden />
          <label className="field">Current passphrase
            <input type={type} name="current-password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus required maxLength={256} />
            {err.current && <span className="err">{err.current}</span>}
          </label>
          <label className="field">New passphrase
            <input type={type} name="new-password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required maxLength={256} aria-describedby="pass-hint" />
            {err.next ? <span className="err">{err.next}</span> : tooShort && <span className="err">{next.trim().length} of {MIN} characters</span>}
          </label>
          <label className="field">Type the new passphrase again
            <input type={type} name="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required maxLength={256} />
            {mismatch && <span className="err">Doesn&apos;t match yet</span>}
          </label>
          <label className="pass-show"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passphrases</label>
          <p id="pass-hint" className="small muted">
            At least {MIN} characters. A few unrelated words is easy to remember and hard to guess. Every other device will be signed out; this one stays signed in.
          </p>
          {err.form && <div className="alert error" role="alert">{err.form}</div>}
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || !current || next.trim().length < MIN || next !== confirm}>{busy ? "Saving…" : "Change passphrase"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
