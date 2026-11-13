"use client";
import { useEffect, useState } from "react";
import PairSteps from "./PairSteps";
import QrCode from "./QrCode";
import { ago, isConnected, isIphone, useDevices, usePairingCode, type Device } from "./paired-devices";

/**
 * Pairing. On a computer: one QR code. Scanning it opens Mizan's pairing page on the iPhone, which adds the Shortcut
 * (first time only) and hands it a one-time code. On the iPhone itself: the same two buttons right here.
 *
 * The code is renewed when it runs out. A new device only counts once the iPhone has used its key (see
 * isConnected), so this never says "connected" before the phone really saved it. Calls onPaired then.
 */
export function PairIphone({ onPaired, replaces }: { onPaired: (d: Device) => void; replaces?: string }) {
  const devices = useDevices(true);
  const [paired, setPaired] = useState<Device | null>(null);
  const { code, error, secondsLeft, renew } = usePairingCode(!paired, { replaces });
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
  // The code was used, but the iPhone hasn't confirmed it kept its key yet.
  const halfway = baseline && !paired && !!items?.some((d) => !known.has(d.id) && !d.revoked_at && !d.last_seen_at);

  useEffect(() => {
    if (code && secondsLeft === 0 && !paired) renew();
  }, [code, secondsLeft, paired, renew]);

  if (paired) {
    return (
      <div className="iph-success" role="status">
        <span className="iph-check" aria-hidden>✓</span>
        <div><b>{paired.name}</b> is connected to Mizan.<div className="small muted">Paired {ago(paired.paired_at)}. Its key is stored only on that iPhone.</div></div>
      </div>
    );
  }
  if (error) return <div className="alert error" role="alert"><span>{error}</span><button className="btn sm" onClick={renew}>Try again</button></div>;
  if (!code) return <p className="small muted iph-loading">Making a QR code…</p>;
  const shortcut = devices.data?.shortcut ?? { url: null, name: "Mizan" };
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const status = halfway ? (
    <div className="iph-waiting small" role="status"><span className="iph-pulse" aria-hidden /> Code received. Waiting for the iPhone to save its key… If this doesn&apos;t change, open Shortcuts and tap <b>{shortcut.name}</b> once.</div>
  ) : (
    <div className="iph-waiting small" role="status"><span className="iph-pulse" aria-hidden /> Waiting for your iPhone…</div>
  );
  const expiry = (
    <div className="small muted" aria-live="polite">
      {secondsLeft > 0 ? <>Works for {mm}:{ss}. </> : "Making a new one… "}
      <button type="button" className="linkish" onClick={renew}>New QR code</button>
    </div>
  );
  if (phone) {
    return (
      <div className="iph-pair phone">
        <PairSteps runUrl={code.runUrl} shortcutUrl={shortcut.url} shortcutName={shortcut.name} />
        {expiry}
        {status}
      </div>
    );
  }
  return (
    <div className="iph-pair">
      <figure className="iph-qr">
        <QrCode value={code.pairPageUrl} size={200} label="QR code to connect your iPhone" />
      </figure>
      <div className="iph-pair-text">
        <ol className="iph-list">
          <li>Open the <b>Camera</b> on your iPhone and point it at the code. Tap the link that appears.</li>
          <li>First time? Tap <b>Get the Shortcut</b>, then <b>Add Shortcut</b>.</li>
          <li>Tap <b>Connect this iPhone</b> and allow it. That&apos;s all: nothing to copy or type.</li>
        </ol>
        {expiry}
        {status}
      </div>
    </div>
  );
}

/** Step: make the Message automation. iOS requires the person to do this; nothing can switch it on for them. */
export function AutomationGuide({ shortcutName, senders }: { shortcutName: string; senders: string[] }) {
  return (
    <div className="iph-auto">
      <ol className="iph-steps">
        <li>On your iPhone, open <b>Shortcuts</b> › <b>Automation</b> › <b>+</b> (or <b>New Automation</b>) › <b>Message</b>.</li>
        <li>
          <b>Sender</b>: choose your bank&apos;s sender{senders.length ? <> (from your banks: {senders.map((s, i) => <span key={s}>{i > 0 && ", "}<code>{s}</code></span>)})</> : null}.
          Leave <b>Message Contains</b> empty.
        </li>
        <li>Choose <b>Run Immediately</b>, then tap <b>Next</b>.</li>
        <li>Pick the <b>{shortcutName}</b> Shortcut and tap <b>Done</b>. Make one automation for each bank sender.</li>
      </ol>
      <p className="small muted">
        Apple only lets you turn this on yourself, on the iPhone. Once it&apos;s on, alerts reach Mizan within seconds, even when your iPhone is locked.
      </p>
    </div>
  );
}
