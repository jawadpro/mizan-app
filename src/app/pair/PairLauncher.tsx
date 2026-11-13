"use client";
import { useEffect, useState } from "react";

/**
 * Opened on the iPhone by scanning the QR code in Mizan. Two steps in order: add the Mizan Shortcut, then hand it
 * the one-time code. The code is in the #fragment, which the browser never sends to any server.
 */
export default function PairLauncher({ server, shortcutName, shortcutUrl }: { server: string; shortcutName: string; shortcutUrl: string | null }) {
  const [code, setCode] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    const c = window.location.hash.replace(/^#/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    setCode(c.length === 8 ? c : "");
    try {
      setAdded(localStorage.getItem("mizan.shortcutAdded") === "1");
    } catch {}
  }, []);
  if (code === null) return null;
  if (!code) {
    return <div className="alert error" role="alert">This pairing link is incomplete. In Mizan, open SMS setup › Connected iPhones and tap Connect iPhone to get a new code.</div>;
  }
  const payload = `${server}/api/devices/pair?code=${code}`;
  const runUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}&input=text&text=${encodeURIComponent(payload)}`;
  function markAdded() {
    setAdded(true);
    try {
      localStorage.setItem("mizan.shortcutAdded", "1");
    } catch {}
  }
  return (
    <ol className="pair-flow">
      <li className={added ? "done" : "now"}>
        <div className="pair-flow-head"><span className="iph-dot" aria-hidden>{added ? "✓" : "1"}</span><b>Add the {shortcutName} Shortcut</b></div>
        {shortcutUrl ? (
          <>
            <a className={`btn ${added ? "" : "primary"}`} href={shortcutUrl} onClick={markAdded}>Get the Shortcut</a>
            <p className="small muted">Shortcuts opens: tap <b>Add Shortcut</b>, then come back here. Already have it? <button type="button" className="linkish" onClick={markAdded}>Skip</button></p>
          </>
        ) : (
          <p className="small muted">The Shortcut link isn&apos;t set up on this Mizan yet. If you already have the {shortcutName} Shortcut, <button type="button" className="linkish" onClick={markAdded}>continue</button>.</p>
        )}
      </li>
      <li className={added ? "now" : ""}>
        <div className="pair-flow-head"><span className="iph-dot" aria-hidden>2</span><b>Connect this iPhone</b></div>
        <a className={`btn ${added ? "primary" : ""}`} href={runUrl} aria-disabled={!added}>Connect this iPhone</a>
        <p className="small muted">Opens the Shortcut with your one-time code <b>{code.slice(0, 4)}-{code.slice(4)}</b>. Allow it when iPhone asks. Your address and key are filled in for you; the code works once, for 10 minutes.</p>
      </li>
    </ol>
  );
}
