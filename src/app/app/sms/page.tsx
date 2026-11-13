import { headers } from "next/headers";
import ConnectedDevices from "@/components/ConnectedDevices";
import ImportQueue from "@/components/ImportQueue";
import ShortcutSteps from "@/components/ShortcutSteps";
import SmsToken from "@/components/SmsToken";
import "../../setup.css";

export const dynamic = "force-dynamic";

export default async function SmsSetupPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-app.vercel.app";
  const endpoint = `https://${host}/api/sms`;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>SMS setup</h1>
          <p className="muted">Forward bank alerts from iPhone Messages. Connect an iPhone with a one-time code: nothing to copy or type. Add each bank and its senders in Settings, under Bank messages.</p>
        </div>
      </div>
      <div className="grid" style={{ gap: 16, maxWidth: 820 }}>
        <div className="card">
          <h2>Connected iPhones</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Add the Mizan Shortcut, then pair it with a one-time code. The Shortcut fills in this Mizan&apos;s address and its own key by itself.</p>
          <div style={{ marginTop: 12 }}><ConnectedDevices /></div>
        </div>
        <div className="card">
          <h3>Queued messages</h3>
          <ImportQueue />
        </div>
        <h3 style={{ margin: "8px 0 0" }}>Using the older Shortcut</h3>
        <p className="small muted" style={{ margin: 0 }}>Already set up with the URL and SMS token typed in by hand? It keeps working; nothing to change.</p>
        <div className="card">
          <h3>Your Mizan URL</h3>
          <pre>{endpoint}</pre>
          <h3 style={{ marginTop: 14 }}>SMS token</h3>
          <SmsToken />
        </div>
        <div className="card">
          <h2>iPhone Shortcuts</h2>
          <ShortcutSteps endpoint={endpoint} />
        </div>
        <div className="alert warn">
          <span>Unfamiliar or ambiguous messages land in the Review inbox instead of being guessed. Use Test a message in Settings to check how a bank&apos;s alerts are read.</span>
        </div>
        <details className="card">
          <summary>For developers: what the Shortcut sends</summary>
          <pre>{`POST ${endpoint}\nAuthorization: Bearer <SMS token>\nContent-Type: application/json\n\n` + JSON.stringify({ sender: "MYBANK", text: "PKR 2,450.00 debited from A/C ****1234 on 15-Oct-2026 14:22 at FOODPANDA. Avl Bal PKR 85,301.17", receivedAt: "2026-10-15T14:22:31+05:00" }, null, 2)}</pre>
        </details>
      </div>
    </>
  );
}
