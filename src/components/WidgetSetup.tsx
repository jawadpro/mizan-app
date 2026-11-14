"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import CloseButton from "./CloseButton";
import QrCode from "./QrCode";
import { useToast } from "./Toast";
import WidgetSteps, { AddWidgetGuide, SCRIPTABLE_APP_URL } from "./WidgetSteps";
import { ago, isConnected, isIphone, useDevices, usePairingCode, type Device } from "./paired-devices";
import { WIDGET_SCRIPTS, scriptableRunUrl, type WidgetId } from "@/lib/shortcut-link";
import "@/app/setup.css";

/** Pairs a new widget: a QR code on a computer, the steps right here on an iPhone. Done once the widget used its key. */
function PairWidget({ onPaired, widget }: { onPaired: (d: Device) => void; widget: WidgetId }) {
  const script = WIDGET_SCRIPTS[widget];
  const devices = useDevices(true, "widget");
  const [paired, setPaired] = useState<Device | null>(null);
  const { code, error, secondsLeft, renew } = usePairingCode(!paired, { kind: "widget" });
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isIphone()), []);
  const [known] = useState(() => new Set<string>());
  const [baseline, setBaseline] = useState(false);
  const items = devices.data?.items;
  useEffect(() => {
    if (!items) return;
    if (!baseline) {
      items.forEach((d) => known.add(d.id));
      setBaseline(true);
      return;
    }
    const done = items.find((d) => !known.has(d.id) && isConnected(d));
    if (done && !paired) {
      setPaired(done);
      onPaired(done);
    }
  }, [items, baseline, known, paired, onPaired]);
  useEffect(() => {
    if (code && secondsLeft === 0 && !paired) renew();
  }, [code, secondsLeft, paired, renew]);

  if (paired) {
    return (
      <div className="iph-success" role="status">
        <span className="iph-check" aria-hidden>✓</span>
        <div><b>{paired.name}</b> is connected.<div className="small muted">Now put it on your Home Screen.</div></div>
      </div>
    );
  }
  if (error) return <div className="alert error" role="alert"><span>{error}</span><button className="btn sm" onClick={renew}>Try again</button></div>;
  if (!code) return <p className="small muted iph-loading">Getting ready…</p>;
  // The code works for either widget; only the script it opens differs.
  const runUrl = widget === "payments" ? code.runUrl : scriptableRunUrl(script.name, { pair: code.payload });
  const pageUrl = widget === "payments" ? code.pairPageUrl : code.pairPageUrl.replace("#", `?w=${widget}#`);
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const footer = (
    <>
      <div className="small muted" aria-live="polite">
        {secondsLeft > 0 ? <>Code {code.code} works for {mm}:{ss}. </> : "Making a new one… "}
        <button type="button" className="linkish" onClick={renew}>New code</button>
      </div>
      <div className="iph-waiting small" role="status"><span className="iph-pulse" aria-hidden /> Waiting for the widget…</div>
    </>
  );
  if (phone) {
    return (
      <div className="iph-pair phone">
        <WidgetSteps runUrl={runUrl} code={code.code} server={code.server} widget={widget} />
        {footer}
      </div>
    );
  }
  return (
    <div className="iph-pair">
      <figure className="iph-qr">
        <QrCode value={pageUrl} label="QR code to set up the widget on your iPhone" />
        <figcaption className="small muted">Scan with the iPhone camera</figcaption>
      </figure>
      <div className="iph-pair-text">
        <p style={{ margin: 0 }}>Scan this with your iPhone. It opens a page with three taps: get <a href={SCRIPTABLE_APP_URL} target="_blank" rel="noreferrer">Scriptable</a>, copy the script, and connect.</p>
        <p className="small muted" style={{ margin: 0 }}>
          Or by hand: add <a href={script.path} target="_blank" rel="noreferrer">the script</a> to Scriptable as <b>{script.name}</b>, run it, and type
          the address <b>{code.server}</b> and the code <b>{code.code}</b>.
        </p>
        {footer}
      </div>
    </div>
  );
}

export function WidgetItem({ d, onChanged }: { d: Device; onChanged: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  async function revoke() {
    if (!confirming) return setConfirming(true);
    try {
      await apiFetch(`/api/devices/${d.id}`, { method: "DELETE" });
      toast(`${d.name} removed. It can't read your payments any more.`, "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setConfirming(false);
    }
  }
  return (
    <li className="dev-item">
      <span className="dev-icon" aria-hidden>▦</span>
      <div>
        <div className="dev-name">{d.name} <span className={`chip ${d.last_seen_at ? "ok" : "warn"}`}>{d.last_seen_at ? "Connected" : "Not finished"}</span></div>
        <div className="dev-meta">Paired {new Date(d.paired_at).toLocaleDateString()} · last updated {ago(d.last_seen_at)}</div>
      </div>
      <div className="dev-actions">
        <button className={`btn sm ${confirming ? "danger" : "ghost"}`} onClick={revoke} onBlur={() => setConfirming(false)}>{confirming ? "Yes, remove" : "Remove"}</button>
      </div>
    </li>
  );
}

const STEPS = ["Connect", "Add to Home Screen"] as const;

const INTRO: Record<WidgetId, { title: string; text: string }> = {
  payments: {
    title: "Home Screen widget",
    text: "This month's payments on your iPhone's Home Screen, with what's paid and what's due. Tap one to mark it paid and link the bank transaction that paid it. Runs in the free Scriptable app.",
  },
  queue: {
    title: "Queued messages widget",
    text: "Shows the bank alerts the Mizan Shortcut saved while you were offline: how many, and how much. Tap it and the Shortcut imports them all. Calm green when everything is synced. Runs in the free Scriptable app.",
  },
};

/**
 * Sets up a Home Screen widget: "payments" (on the Monthly payments page) or "queue" (in SMS setup). Both share one
 * connection per iPhone, so the queue widget can skip connecting when a widget is already connected.
 */
export default function WidgetSetup({ onClose, widget = "payments" }: { onClose: () => void; widget?: WidgetId }) {
  const devices = useDevices(false, "widget");
  const live = (devices.data?.items ?? []).filter((d) => !d.revoked_at);
  const [adding, setAdding] = useState<boolean | null>(null);
  const [step, setStep] = useState(0);
  const [device, setDevice] = useState<Device | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Straight to pairing when there's no widget yet.
  useEffect(() => {
    if (adding === null && devices.data) setAdding(widget === "queue" || live.length === 0);
  }, [adding, devices.data, live.length, widget]);
  const intro = INTRO[widget];
  // The queue widget reuses the connection of a widget already on this iPhone.
  const canSkip = widget === "queue" && live.some((d) => d.last_seen_at);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal iph-modal" role="dialog" aria-modal="true" aria-labelledby="widget-title">
        <div className="modal-head">
          <h2 id="widget-title">{intro.title}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <p className="small muted" style={{ margin: "0 0 6px" }}>{intro.text}</p>
        {!adding ? (
          <>
            {devices.error && <div className="alert error" role="alert">{devices.error}</div>}
            {live.length > 0 && <ul className="dev-list" style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }}>{live.map((d) => <WidgetItem key={d.id} d={d} onChanged={devices.reload} />)}</ul>}
            <div className="modal-foot">
              <button className="btn primary" onClick={() => setAdding(true)}>Connect a widget</button>
            </div>
          </>
        ) : (
          <>
            <ol className="setup-steps" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li key={s} className={i < step ? "done" : i === step ? "now" : ""}>
                  <span className="setup-dot">{i < step ? "✓" : i + 1}</span><span className="setup-label">{s}</span>
                </li>
              ))}
            </ol>
            {step === 0 && <PairWidget onPaired={setDevice} widget={widget} />}
            {step === 1 && <AddWidgetGuide widget={widget} />}
            <div className="modal-foot">
              {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
              {step === 0
                ? <button className="btn primary" disabled={!device && !canSkip} onClick={() => setStep(1)}>{device || canSkip ? "Continue" : "Waiting for the widget…"}</button>
                : <button className="btn primary" onClick={onClose}>Done</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
