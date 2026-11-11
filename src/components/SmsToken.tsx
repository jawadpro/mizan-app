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

function CopyButton({ text, label, done, primary }: { text: string; label: string; done: string; primary?: boolean }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className={primary ? "btn sm primary" : "btn sm"}
      onClick={async () => ((await copy(text)) ? toast(done, "ok") : toast("Couldn't copy; select it and copy by hand", "error"))}
    >
      {label}
    </button>
  );
}

/**
 * The SMS token the iPhone Shortcut sends, with the two request headers ready to copy.
 * Only the signed-in owner gets the value from the server.
 */
export default function SmsToken() {
  const toast = useToast();
  const { data, reload } = useData<Info>("/api/setup");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!data) return <p className="small muted">Loading…</p>;
  if (!data.smsToken) {
    return <p className="small muted">{data.smsTokenFromEnv ? "SMS token: set in your environment variables, but it's shorter than 32 characters." : "SMS token: not created yet."}</p>;
  }
  const token = data.smsToken;
  const bearer = `Bearer ${token}`;
  const hidden = "•".repeat(24);

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
      <div className="sms-token-row">
        <code className="sms-token-value">{shown ? token : hidden}</code>
        <div className="toolbar">
          <button type="button" className="btn sm" onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</button>
          <CopyButton text={token} label="Copy token" done="Token copied" />
        </div>
      </div>

      <div className="sms-headers">
        <div className="sms-headers-title small muted">Headers for the Shortcut (Get Contents of URL → Headers)</div>
        <div className="sms-header">
          <span className="sms-header-key"><code>Authorization</code><CopyButton text="Authorization" label="Copy" done="Copied “Authorization”" /></span>
          <span className="sms-header-val"><code>{shown ? bearer : `Bearer ${hidden}`}</code><CopyButton text={bearer} label="Copy value" done="Copied “Bearer …”" primary /></span>
        </div>
        <div className="sms-header">
          <span className="sms-header-key"><code>Content-Type</code><CopyButton text="Content-Type" label="Copy" done="Copied “Content-Type”" /></span>
          <span className="sms-header-val"><code>application/json</code><CopyButton text="application/json" label="Copy value" done="Copied “application/json”" /></span>
        </div>
      </div>

      {data.smsTokenFromEnv ? (
        <p className="small muted">Keep it private: anyone with this token can send alerts to your Mizan. It comes from <code>SMS_INGEST_TOKEN</code> in your environment variables, so change it there.</p>
      ) : (
        <>
          <div className="toolbar">
            <button type="button" className="btn sm ghost" onClick={renew} disabled={busy}>{busy ? "Making…" : confirming ? "Yes, replace it" : "Make a new token"}</button>
          </div>
          <p className="small muted">Keep it private: anyone with this token can send alerts to your Mizan. A new token stops the old one working.</p>
        </>
      )}
    </div>
  );
}
