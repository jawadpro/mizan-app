import Link from "next/link";
import ForIphone from "@/components/ForIphone";
import ConnectedDevices from "@/components/ConnectedDevices";
import "../../setup.css";

export const dynamic = "force-dynamic";

export default function ConnectIphonePage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Connect iPhone</h1>
          <p className="muted">Mizan reads your bank alerts as they arrive on your iPhone. <ForIphone iphone={<>Tap the two buttons below to connect: nothing to copy or type.</>} other={<>Scan one QR code to connect: nothing to copy or type.</>} /></p>
        </div>
      </div>
      <div className="cx-page">
        <div className="card cx-card">
          <ConnectedDevices />
        </div>
        <div className="card cx-notes">
          <h3>Good to know</h3>
          <ul>
            <li>Add each bank and its SMS senders in <Link href="/app/settings">Settings</Link>, under Bank messages.</li>
            <li>Alerts Mizan can&apos;t read with confidence wait in the <Link href="/app/review">Review inbox</Link> instead of being guessed.</li>
            <li>No internet when an alert arrives? The Shortcut keeps it. Back online, open Mizan on your iPhone, tap <b>More</b>, then <b>Import queued messages</b>, or add the queued messages widget from <b>More › Widgets</b>.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
