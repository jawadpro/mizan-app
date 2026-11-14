"use client";
import { useEffect, useState } from "react";
import WidgetSetup, { WidgetItem } from "./WidgetSetup";
import { isIphone, useDevices } from "./paired-devices";
import type { WidgetId } from "@/lib/shortcut-link";
import "@/app/setup.css";
import "@/app/widgets.css";

/** A small drawing of each widget, so you can see what you're adding. */
function Preview({ id }: { id: WidgetId }) {
  if (id === "queue") {
    return (
      <div className="wg-prev wg-amber" aria-hidden>
        <div><b className="wg-big">3</b><span>alerts waiting</span><strong>Rs 18,450</strong></div>
        <div className="wg-bubbles"><i>HBL</i><i>MCB</i><i>MEEZAN<small>Rs 12,340</small></i></div>
      </div>
    );
  }
  return (
    <div className="wg-prev wg-pay" aria-hidden>
      <div className="wg-top"><b>Payments</b><span>6/10 paid</span></div>
      <div className="wg-bar"><i /></div>
      {[["Tuition fee", "Due 20 Nov"], ["House rent", "Paid"], ["Internet bill", "Paid"]].map(([n, st]) => (
        <div key={n} className={`wg-row${st === "Paid" ? " done" : ""}`}><i />{n}<span>{st}</span></div>
      ))}
    </div>
  );
}

const LIST: { id: WidgetId; title: string; text: string }[] = [
  { id: "payments", title: "Monthly payments", text: "This month's bills and payments, with what's paid and what's due. Tap one to mark it paid and link the transaction." },
  { id: "queue", title: "Queued messages", text: "Bank alerts saved while you were offline: how many and how much. Tap to import them all. Green when everything is synced." },
];

/** "Widgets" in the phone's More menu: every Home Screen widget Mizan offers, and the widgets connected. */
export default function Widgets() {
  const [open, setOpen] = useState<WidgetId | null>(null);
  const [phone, setPhone] = useState(true);
  useEffect(() => setPhone(isIphone()), []);
  const devices = useDevices(false, "widget");
  const live = (devices.data?.items ?? []).filter((d) => !d.revoked_at);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Widgets</h1>
          <p className="muted">Mizan on your Home Screen and Lock Screen. The widgets run in Scriptable, a free iPhone app, and set up in a few taps.</p>
        </div>
      </div>
      {!phone && <div className="alert" role="note" style={{ marginBottom: 16 }}>Widgets are for iPhone. You can set one up from here with a QR code, or open this page on your iPhone.</div>}
      <div className="wg-grid">
        {LIST.map((w) => (
          <div key={w.id} className="card wg-card">
            <Preview id={w.id} />
            <h3>{w.title}</h3>
            <p className="small muted">{w.text}</p>
            <button className="btn primary" onClick={() => setOpen(w.id)}>Add to Home Screen</button>
          </div>
        ))}
      </div>
      {live.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ margin: "0 0 4px" }}>Connected</h3>
          <p className="small muted" style={{ margin: 0 }}>One connection per iPhone works for every widget on it. Remove one and its widgets stop updating.</p>
          <ul className="dev-list" style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {live.map((d) => <WidgetItem key={d.id} d={d} onChanged={devices.reload} />)}
          </ul>
        </div>
      )}
      {open && <WidgetSetup widget={open} onClose={() => { setOpen(null); devices.reload(); }} />}
    </>
  );
}
