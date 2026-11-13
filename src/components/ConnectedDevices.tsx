"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import CloseButton from "./CloseButton";
import { AutomationGuide, PairIphone } from "./IphoneSetup";
import { ago, deviceStatus, isConnected, useDevices, type Device, type DevicesInfo } from "./paired-devices";
import { useToast } from "./Toast";
import "@/app/setup.css";

const PHONE = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M11 18.5h2" />
  </svg>
);

const STEPS = ["Scan", "Automation"] as const;

/** "Add another iPhone" or "Reconnect" (which replaces a device's key) as a short guided dialog. */
function ConnectDialog({ info, replaces, onClose }: { info: DevicesInfo | null; replaces?: Device; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [device, setDevice] = useState<Device | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const name = info?.shortcut.name ?? "Mizan";
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal iph-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="modal-head">
          <h2 id="connect-title">{replaces ? `Reconnect ${replaces.name}` : "Connect an iPhone"}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <ol className="setup-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? "done" : i === step ? "now" : ""}>
              <span className="setup-dot">{i < step ? "✓" : i + 1}</span><span className="setup-label">{s}</span>
            </li>
          ))}
        </ol>
        {step === 0 && (
          <>
            {replaces && <p className="small muted" style={{ margin: 0 }}>{replaces.name}&apos;s old key stops working once the iPhone has saved the new one.</p>}
            <PairIphone onPaired={setDevice} replaces={replaces?.id} />
          </>
        )}
        {step === 1 && <AutomationGuide shortcutName={name} senders={[]} />}
        <div className="modal-foot">
          {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
          {step < STEPS.length - 1
            ? <button className="btn primary" disabled={step === 0 && !device} onClick={() => setStep(step + 1)}>{step === 0 && !device ? "Waiting for iPhone…" : "Continue"}</button>
            : <button className="btn primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  );
}

function DeviceItem({ d, onChanged, onReconnect }: { d: Device; onChanged: () => void; onReconnect: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const st = deviceStatus(d);
  async function revoke() {
    if (!confirming) return setConfirming(true);
    try {
      await apiFetch(`/api/devices/${d.id}`, { method: "DELETE" });
      toast(`${d.name} removed. It can't send alerts any more.`, "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setConfirming(false);
    }
  }
  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!renaming?.trim()) return setRenaming(null);
    try {
      await apiFetch(`/api/devices/${d.id}`, { method: "PATCH", body: JSON.stringify({ name: renaming.trim() }) });
      setRenaming(null);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  return (
    <li className={`dev-item${d.revoked_at ? " off" : ""}`}>
      <span className="dev-icon">{PHONE}</span>
      <div>
        {renaming !== null ? (
          <form onSubmit={rename} className="toolbar">
            <input aria-label="Device name" value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={60} autoFocus />
            <button className="btn sm primary">Save</button>
            <button type="button" className="btn sm ghost" onClick={() => setRenaming(null)}>Cancel</button>
          </form>
        ) : (
          <div className="dev-name">{d.name} <span className={`chip ${st.tone}`}>{st.label}</span></div>
        )}
        <div className="dev-meta">{st.detail}</div>
        <div className="dev-meta">
          Paired {new Date(d.paired_at).toLocaleDateString()}
          {d.last_test_at && <> · last test {ago(d.last_test_at)}</>}
        </div>
        {(d.imported_count + d.review_count + d.duplicate_count + d.failed_count) > 0 && (
          <div className="dev-stats">
            <span>{d.imported_count} imported</span><span>{d.review_count} to review</span><span>{d.duplicate_count} duplicates skipped</span>
            {d.ignored_count > 0 && <span>{d.ignored_count} ignored (OTP, promos)</span>}
            {d.failed_count > 0 && <span>{d.failed_count} failed</span>}
          </div>
        )}
      </div>
      {!d.revoked_at && (
        <div className="dev-actions">
          {renaming === null && <button className="btn sm ghost" onClick={() => setRenaming(d.name)}>Rename</button>}
          <button className="btn sm" onClick={onReconnect}>Reconnect</button>
          <button className={`btn sm ${confirming ? "danger" : "ghost"}`} onClick={revoke} onBlur={() => setConfirming(false)}>{confirming ? "Yes, remove" : "Remove"}</button>
        </div>
      )}
    </li>
  );
}

/**
 * Connect iPhone: the connection status, every paired iPhone, and pairing. Two steps: scan the QR code (right on the
 * page while nothing is connected; "Add another iPhone" opens it in a dialog after that), then turn on the Message
 * automation, whose instructions stay underneath until the first bank alert arrives.
 */
export default function ConnectedDevices() {
  const { data, error, reload } = useDevices(true);
  const [dialog, setDialog] = useState<{ replaces?: Device } | null>(null);
  const active = data?.items.filter((d) => !d.revoked_at) ?? [];
  const connected = active.filter(isConnected);
  const removed = data?.items.filter((d) => d.revoked_at) ?? [];
  const name = data?.shortcut.name ?? "Mizan";
  const finishing = connected.length > 0 && !connected.some((d) => d.last_sms_at);
  const onPaired = useCallback(() => reload(), [reload]);
  return (
    <div className="devices">
      {error && <div className="alert error">{error}</div>}
      {!data && !error && <p className="small muted">Loading…</p>}
      {data && (
        <div className={`cx-status ${connected.length ? "on" : "off"}`} role="status">
          <span className="status-dot" aria-hidden />
          <span>
            {connected.length
              ? <><b>{connected.length === 1 ? "1 iPhone connected" : `${connected.length} iPhones connected`}</b><span className="muted"> · bank alerts come in by themselves</span></>
              : <><b>Not connected</b><span className="muted"> · no bank alerts are coming in yet</span></>}
          </span>
        </div>
      )}
      {data && connected.length === 0 && (
        <div className="cx-pair">
          <PairIphone onPaired={onPaired} />
        </div>
      )}
      {active.length > 0 && <ul className="dev-list" style={{ listStyle: "none", padding: 0, margin: "14px 0 0" }}>{active.map((d) => <DeviceItem key={d.id} d={d} onChanged={reload} onReconnect={() => setDialog({ replaces: d })} />)}</ul>}
      {connected.length > 0 && (
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setDialog({})}>Add another iPhone</button>
        </div>
      )}
      {finishing && (
        <div className="cx-next">
          <h3>Now turn on the automation</h3>
          <AutomationGuide shortcutName={name} senders={[]} />
        </div>
      )}
      {removed.length > 0 && (
        <details className="setup-more">
          <summary>Removed in the last 30 days ({removed.length})</summary>
          <ul className="dev-list" style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>{removed.map((d) => <DeviceItem key={d.id} d={d} onChanged={reload} onReconnect={() => {}} />)}</ul>
        </details>
      )}
      {dialog && <ConnectDialog info={data} replaces={dialog.replaces} onClose={() => { setDialog(null); reload(); }} />}
    </div>
  );
}
