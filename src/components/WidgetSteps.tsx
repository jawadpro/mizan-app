"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { QUEUE_BOOKMARK, WIDGET_SCRIPTS, type WidgetId } from "@/lib/shortcut-link";

export const SCRIPTABLE_APP_URL = "https://apps.apple.com/app/scriptable/id1405459188";

/** Copies the widget script, fetched ahead of time so the copy happens inside the tap (Safari requires that). */
export function useCopyScript(path: string) {
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  useEffect(() => {
    fetch(path).then((r) => (r.ok ? r.text() : Promise.reject())).then(setText).catch(() => setText(null));
  }, [path]);
  async function copy() {
    try {
      if (text) await navigator.clipboard.writeText(text);
      else {
        const blob = fetch(path).then((r) => r.blob());
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
export default function WidgetSteps({ runUrl, code, server, widget = "payments" }: { runUrl: string; code?: string; server?: string; widget?: WidgetId }) {
  const script = WIDGET_SCRIPTS[widget];
  const { copy, copied } = useCopyScript(script.path);
  const queue = widget === "queue";
  const n = queue ? 4 : 3;
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
          Open Scriptable, tap <b>+</b>, paste, then tap the title at the top and name it <b>{script.name}</b>. Tap <b>Done</b>.
          {copied === "failed" && <> Copying didn&apos;t work here: open <a href={script.path} target="_blank" rel="noreferrer">the script</a>, select all and copy it.</>}
        </p>
      </li>
      {queue && <QueueBookmarkStep />}
      <li className="now">
        <div className="pair-flow-head"><span className="iph-dot" aria-hidden>{n}</span><b>Connect the widget</b></div>
        <a className="btn primary" href={runUrl}>Connect the widget</a>
        <p className="small muted">
          Opens the script in Scriptable{code ? <> with your one-time code <b>{code}</b></> : null}. It saves its own key in this iPhone&apos;s
          Keychain. If the button does nothing, run <b>{script.name}</b> in Scriptable and type
          {server ? <> the address <b>{server}</b> and</> : null} the code.
          {queue && <> Already use the Mizan Payments widget on this iPhone? It shares that connection: skip this step.</>}
        </p>
      </li>
    </ol>
  );
}

/** The queue widget reads the Shortcut's queue folder, which Scriptable may only open through a file bookmark. */
function QueueBookmarkStep(): ReactNode {
  return (
    <li>
      <div className="pair-flow-head"><span className="iph-dot" aria-hidden>3</span><b>Let Scriptable see the queue folder</b></div>
      <p className="small muted" style={{ margin: 0 }}>
        In Scriptable, tap the gear (<b>Settings</b>) › <b>File Bookmarks</b> › <b>+</b> › <b>Pick Folder</b>. Choose the folder the Mizan
        Shortcut saves offline alerts in: <b>On My iPhone › Mizan › queue-messages</b> (or wherever yours is). Name the bookmark
        exactly <b>{QUEUE_BOOKMARK}</b>. The widget only counts the alerts there; they reach Mizan when you import them.
      </p>
    </li>
  );
}

/** The last step: putting the widget on the Home Screen or Lock Screen. */
export function AddWidgetGuide({ widget = "payments" }: { widget?: WidgetId }) {
  const queue = widget === "queue";
  return (
    <ol className="iph-steps">
      <li>Touch and hold an empty spot on the Home Screen until the apps jiggle, then tap <b>Edit</b> › <b>Add Widget</b>.</li>
      <li>Find <b>Scriptable</b>, pick a size ({queue ? <>the <b>small</b> or <b>medium</b> one looks best</> : <>the <b>medium</b> or <b>large</b> one</>}) and tap <b>Add Widget</b>.</li>
      <li>Tap the new widget (while it still jiggles). Set <b>Script</b> to <b>{WIDGET_SCRIPTS[widget].name}</b> and <b>When Interacting</b> to <b>Run Script</b>.</li>
      <li>
        Tap outside to finish.{" "}
        {queue
          ? <>When alerts are waiting, the widget turns amber: tap it and the Mizan Shortcut imports them. For the Lock Screen, add Scriptable&apos;s round widget with the same script to see the count.</>
          : <>Tap a payment on the widget to mark it paid and link the transaction that paid it.</>}
      </li>
    </ol>
  );
}
