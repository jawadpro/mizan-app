"use client";
import { useState } from "react";
import { apiFetch } from "./api";
import { useToast } from "./Toast";
import { useData } from "./useData";

type Info = { smsToken: string | null; smsTokenFromEnv: boolean };

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The SMS token the iPhone Shortcut sends. Shown only to the signed-in owner, and only when Mizan created it. */
export default function SmsToken() {
  const toast = useToast();
  const { data, reload } = useData<Info>("/api/setup");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!data) return <p className="small muted">Loading…</p>;
  if (data.smsTokenFromEnv) return <p className="small muted">SMS token: set in your environment variables ✓ (the value is never shown here)</p>;
  if (!data.smsToken) return <p className="small muted">SMS token: not created yet.</p>;
  const token = data.smsToken;

  async function renew() {
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setBusy(true);
    try {
      await apiFetch("/api/setup", { method: "POST", body: JSON.stringify({ action: "new-token" }) });
      reload();
      setShown(true);
      toast("New token made. Update it in your Shortcut.", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sms-token">
      <code className="sms-token-value">{shown ? token : "•".repeat(24)}</code>
      <div className="toolbar">
        <button className="btn sm" onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</button>
        <button className="btn sm primary" onClick={async () => toast((await copy(`Bearer ${token}`)) ? "Copied “Bearer …” for the Authorization header" : "Couldn't copy; select it and copy by hand", "ok")}>Copy for Shortcut</button>
        <button className="btn sm ghost" onClick={renew} disabled={busy}>{busy ? "Making…" : confirming ? "Yes, replace it" : "Make a new token"}</button>
      </div>
      <p className="small muted">Keep it private: anyone with this token can send alerts to your Mizan. A new token stops the old one working.</p>
    </div>
  );
}
