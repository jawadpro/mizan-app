"use client";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/components/api";

export default function LoginForm() {
  const expired = useSearchParams().get("expired");
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password: pw, remember }) });
      window.location.href = "/app";
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 18 }}>
      {expired && !err && <div className="alert warn">Your session ended. Please sign in again.</div>}
      <label className="field">Passphrase
        <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
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
