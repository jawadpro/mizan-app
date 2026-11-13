"use client";
import { useEffect, useState } from "react";

const ADDED_KEY = "mizan.shortcutAdded";

/**
 * The two taps on the iPhone itself: add the Mizan Shortcut (first time only), then hand it the one-time code.
 * Shown on /pair after scanning the QR code, and in the app when it's opened on the iPhone.
 */
export default function PairSteps({ runUrl, shortcutUrl, shortcutName, code }: { runUrl: string; shortcutUrl: string | null; shortcutName: string; code?: string }) {
  const [added, setAdded] = useState(false);
  useEffect(() => {
    try {
      setAdded(localStorage.getItem(ADDED_KEY) === "1");
    } catch {}
  }, []);
  function markAdded() {
    setAdded(true);
    try {
      localStorage.setItem(ADDED_KEY, "1");
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
          <p className="small muted">Already have the {shortcutName} Shortcut? <button type="button" className="linkish" onClick={markAdded}>Continue</button></p>
        )}
      </li>
      <li className={added ? "now" : ""}>
        <div className="pair-flow-head"><span className="iph-dot" aria-hidden>2</span><b>Connect this iPhone</b></div>
        <a className={`btn ${added ? "primary" : ""}`} href={runUrl}>Connect this iPhone</a>
        <p className="small muted">
          Opens the Shortcut{code ? <> with your one-time code <b>{code}</b></> : null}. Allow it when iPhone asks. Nothing to type: it saves
          this Mizan&apos;s address and its own key by itself.
        </p>
      </li>
    </ol>
  );
}
