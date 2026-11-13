"use client";
import { useEffect, useState } from "react";
import QrCode from "./QrCode";
import { ago, isIphone, useDevices, usePairingCode, type Device, type DevicesInfo } from "./paired-devices";

/** Step: add the universal Mizan Shortcut from its iCloud link. */
export function InstallShortcut({ info }: { info: DevicesInfo | null }) {
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isIphone()), []);
  const url = info?.shortcut.url;
  const name = info?.shortcut.name ?? "Mizan";
  if (!info) return <p className="small muted">Loading…</p>;
  if (!url) {
    return (
      <div className="alert warn">
        <span>
          The Shortcut link isn&apos;t set up on this Mizan. Set <code>MIZAN_SHORTCUT_URL</code> to the <b>{name}</b> Shortcut&apos;s iCloud
          link (see <code>docs/iphone-pairing.md</code>). If you already have the Shortcut, continue.
        </span>
      </div>
    );
  }
  return (
    <div className="iph-install">
      {!phone && (
        <figure className="iph-qr">
          <QrCode value={url} label={`QR code to add the ${name} Shortcut`} />
          <figcaption className="small muted">Scan with your iPhone&apos;s Camera</figcaption>
        </figure>
      )}
      <div className="iph-install-text">
        <ol className="iph-list">
          <li>{phone ? <>Tap <b>Add the Shortcut</b> below.</> : <>Point your iPhone&apos;s Camera at the code and tap the link.</>}</li>
          <li>Shortcuts opens. Tap <b>Add Shortcut</b>. You don&apos;t need to type any address or token: pairing does that next.</li>
        </ol>
        <a className={`btn ${phone ? "primary" : ""}`} href={url} target="_blank" rel="noopener noreferrer">Add the {name} Shortcut</a>
        <p className="small muted">One Shortcut for everyone, so it never contains your details. It only learns this Mizan&apos;s address when you pair it.</p>
      </div>
    </div>
  );
}

/**
 * Step: pair. Shows a single-use code (renewed when it runs out), as a QR code for the iPhone's Camera, a button
 * that hands it straight to the installed Shortcut, and as text to type. Calls onPaired once a new device appears.
 */
export function PairIphone({ onPaired, replaces }: { onPaired: (d: Device) => void; replaces?: string }) {
  const devices = useDevices(true);
  const [paired, setPaired] = useState<Device | null>(null);
  const { code, error, secondsLeft, renew } = usePairingCode(!paired, { replaces });
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isIphone()), []);
  const [known] = useState(() => new Set<string>());
  const [baseline, setBaseline] = useState(false);

  useEffect(() => {
    const items = devices.data?.items;
    if (!items) return;
    if (!baseline) {
      items.forEach((d) => known.add(d.id));
      setBaseline(true);
      return;
    }
    const fresh = items.find((d) => !known.has(d.id) && !d.revoked_at);
    if (fresh && !paired) {
      setPaired(fresh);
      onPaired(fresh);
    }
  }, [devices.data, baseline, known, paired, onPaired]);

  useEffect(() => {
    if (code && secondsLeft === 0 && !paired) renew();
  }, [code, secondsLeft, paired, renew]);

  if (paired) {
    return (
      <div className="iph-success" role="status">
        <span className="iph-check" aria-hidden>✓</span>
        <div><b>{paired.name}</b> is connected to Mizan.<div className="small muted">Paired {ago(paired.paired_at)}. Its own token is stored only on that iPhone.</div></div>
      </div>
    );
  }
  if (error) return <div className="alert error" role="alert"><span>{error}</span><button className="btn sm" onClick={renew}>Try again</button></div>;
  if (!code) return <p className="small muted">Making a pairing code…</p>;
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  return (
    <div className="iph-pair">
      {!phone && (
        <figure className="iph-qr">
          <QrCode value={code.pairPageUrl} label="QR code to pair your iPhone" />
          <figcaption className="small muted">Scan with your iPhone&apos;s Camera, then tap <b>Connect this iPhone</b></figcaption>
        </figure>
      )}
      <div className="iph-pair-text">
        {phone && <a className="btn primary iph-run" href={code.runUrl}>Connect this iPhone</a>}
        <div className="iph-code-label small muted">{phone ? "Or open the Shortcut and type this code" : "Or run the Shortcut on your iPhone and type this code"}</div>
        <div className="iph-code" aria-label={`Pairing code ${code.code}`}>{code.code}</div>
        <div className="small muted" aria-live="polite">Works once. {secondsLeft > 0 ? <>Expires in {mm}:{ss}.</> : "Making a new one…"} <button type="button" className="linkish" onClick={renew}>New code</button></div>
        <div className="iph-waiting small"><span className="iph-pulse" aria-hidden /> Waiting for your iPhone…</div>
      </div>
    </div>
  );
}

/** Step: make the Message automation. iOS requires the person to do this; nothing can switch it on for them. */
export function AutomationGuide({ shortcutName, senders }: { shortcutName: string; senders: string[] }) {
  return (
    <div className="iph-auto">
      <ol className="iph-steps">
        <li><b>Shortcuts</b> app › <b>Automation</b> tab › <b>+</b> (or <b>New Automation</b>) › <b>Message</b>.</li>
        <li>
          <b>Sender</b>: choose your bank&apos;s sender{senders.length ? <> (from your banks: {senders.map((s, i) => <span key={s}>{i > 0 && ", "}<code>{s}</code></span>)})</> : null}.
          Leave <b>Message Contains</b> empty.
        </li>
        <li>Choose <b>Run Immediately</b> and turn off <b>Notify When Run</b> if you like. Tap <b>Next</b>.</li>
        <li>Pick the <b>{shortcutName}</b> Shortcut and tap <b>Done</b>. Make one automation for each bank sender.</li>
      </ol>
      <p className="small muted">
        Apple only lets you create this automation yourself, on the iPhone; no app or link can turn it on for you. Once it&apos;s on, alerts reach Mizan
        within seconds, even when your iPhone is locked. With no internet, the Shortcut keeps the alert and sends it the next time it runs.
      </p>
    </div>
  );
}

/**
 * Step: check it works. Two separate signals:
 *  1. the Shortcut's own test (run it by hand: it sends a made-up alert marked as a test; nothing is saved), which
 *     proves pairing, the device token and Mizan's reading of alerts;
 *  2. the first real bank alert, which is the only proof the Message automation itself works.
 */
export function TestConnection({ device, shortcutName }: { device: Device | null; shortcutName: string }) {
  const { data } = useDevices(true);
  const d = device ? data?.items.find((x) => x.id === device.id) ?? device : data?.items.find((x) => !x.revoked_at) ?? null;
  const tested = !!d?.last_test_at;
  const real = !!d?.last_sms_at;
  return (
    <div className="iph-tests">
      <div className={`iph-test ${d ? "ok" : "wait"}`}>
        <span className="iph-dot" aria-hidden>{d ? "✓" : "1"}</span>
        <div><b>iPhone paired</b><div className="small muted">{d ? `${d.name}, paired ${ago(d.paired_at)}.` : "Not yet. Go back a step to pair."}</div></div>
      </div>
      <div className={`iph-test ${tested ? "ok" : "wait"}`}>
        <span className="iph-dot" aria-hidden>{tested ? "✓" : "2"}</span>
        <div>
          <b>Connection test from the Shortcut</b>
          <div className="small muted">
            {tested
              ? `Received ${ago(d!.last_test_at)}. The token and Mizan's reading of alerts work. Nothing was saved.`
              : <>On your iPhone, open Shortcuts and tap <b>{shortcutName}</b> once. It sends a made-up test alert; this turns green within a few seconds.</>}
          </div>
        </div>
      </div>
      <div className={`iph-test ${real ? "ok" : "wait"}`}>
        <span className="iph-dot" aria-hidden>{real ? "✓" : "3"}</span>
        <div>
          <b>First real bank alert</b>
          <div className="small muted">
            {real
              ? `Arrived ${ago(d!.last_sms_at)}. Your Message automation works.`
              : "Waiting. This turns green with your next real bank SMS. It's the only check that proves the automation is on; you don't need to wait here."}
          </div>
        </div>
      </div>
    </div>
  );
}
