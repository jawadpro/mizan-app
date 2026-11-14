"use client";
import { useEffect, useState } from "react";
import { WIDGET_SCRIPT_NAME, WIDGET_SCRIPT_PATH } from "@/lib/shortcut-link";

export const SCRIPTABLE_APP_URL = "https://apps.apple.com/app/scriptable/id1405459188";

/** Copies the widget script, fetched ahead of time so the copy happens inside the tap (Safari requires that). */
export function useCopyScript() {
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  useEffect(() => {
    fetch(WIDGET_SCRIPT_PATH).then((r) => (r.ok ? r.text() : Promise.reject())).then(setText).catch(() => setText(null));
  }, []);
  async function copy() {
    try {
      if (text) await navigator.clipboard.writeText(text);
      else {
        const blob = fetch(WIDGET_SCRIPT_PATH).then((r) => r.blob());
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      }
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }
  return { copy, copied };
}

/**
 * The steps on the iPhone itself: get Scriptable, paste the script, connect. Used in Mizan on an iPhone and on the
 * page the QR code opens. `runUrl` opens the script in Scriptable with the one-time code.
 */
export default function WidgetSteps({ runUrl, code, server }: { runUrl: string; code?: string; server?: string }) {
  const { copy, copied } = useCopyScript();
  return (
    <ol className="pair-flow">
      <li>
        <div className="pair-flow-head"><span className="iph-dot" aria-hidden>1</span><b>Get Scriptable</b></div>
        <a className="btn" href={SCRIPTABLE_APP_URL} target="_blank" rel="noreferrer">Scriptable on the App Store</a>
        <p className="small muted">A free app that runs small scripts and shows them as widgets. Already have it? Go to step 2.</p>
      </li>
      <li className={copied === "yes" ? "done" : ""}>
        <div className="pair-flow-head"><span className="iph-dot" aria-hidden>{copied === "yes" ? "✓" : "2"}</span><b>Add the script</b></div>
        <button type="button" className={`btn ${copied === "yes" ? "" : "primary"}`} onClick={copy}>{copied === "yes" ? "Copied" : "Copy the script"}</button>
        <p className="small muted">
          Open Scriptable, tap <b>+</b>, paste, then tap the title at the top and name it <b>{WIDGET_SCRIPT_NAME}</b>. Tap <b>Done</b>.
          {copied === "failed" && <> Copying didn&apos;t work here: open <a href={WIDGET_SCRIPT_PATH} target="_blank" rel="noreferrer">the script</a>, select all and copy it.</>}
        </p>
      </li>
      <li className="now">
        <div className="pair-flow-head"><span className="iph-dot" aria-hidden>3</span><b>Connect the widget</b></div>
        <a className="btn primary" href={runUrl}>Connect the widget</a>
        <p className="small muted">
          Opens the script in Scriptable{code ? <> with your one-time code <b>{code}</b></> : null}. It saves its own key in this iPhone&apos;s
          Keychain. If the button does nothing, run <b>{WIDGET_SCRIPT_NAME}</b> in Scriptable and type
          {server ? <> the address <b>{server}</b> and</> : null} the code.
        </p>
      </li>
    </ol>
  );
}

/** The last step: putting the widget on the Home Screen or Lock Screen. */
export function AddWidgetGuide() {
  return (
    <ol className="iph-steps">
      <li>Touch and hold an empty spot on the Home Screen until the apps jiggle, then tap <b>Edit</b> › <b>Add Widget</b>.</li>
      <li>Find <b>Scriptable</b>, pick the <b>medium</b> or <b>large</b> size and tap <b>Add Widget</b>.</li>
      <li>Tap the new widget (while it still jiggles). Set <b>Script</b> to <b>{WIDGET_SCRIPT_NAME}</b> and <b>When Interacting</b> to <b>Run Script</b>.</li>
      <li>Tap outside to finish. Tap a payment on the widget to mark it paid and link the transaction that paid it.</li>
    </ol>
  );
}
