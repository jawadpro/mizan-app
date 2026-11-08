import { headers } from "next/headers";
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
          <p className="muted">Forward bank alerts from iPhone Messages with a Shortcuts automation. Add each bank and its senders in Settings, under Bank messages.</p>
        </div>
      </div>
      <div className="grid two">
        <div className="card">
          <h2>iPhone Shortcut</h2>
          <ShortcutSteps endpoint={endpoint} />
        </div>
        <div className="grid" style={{ gap: 16, alignContent: "start" }}>
          <div className="card">
            <h3>Endpoint</h3>
            <pre>{`POST ${endpoint}`}</pre>
            <h3 style={{ marginTop: 14 }}>SMS token</h3>
            <SmsToken />
          </div>
          <div className="card">
            <h3>Example body (synthetic)</h3>
            <pre>{JSON.stringify({ sender: "MYBANK", text: "PKR 2,450.00 debited from A/C ****1234 on 15-Oct-2026 14:22 at FOODPANDA. Avl Bal PKR 85,301.17", receivedAt: "2026-10-15T14:22:31+05:00" }, null, 2)}</pre>
          </div>
          <div className="alert warn">
            <span>Unfamiliar or ambiguous messages land in the Review inbox instead of being guessed. Use Test a message in Settings to check how a bank's alerts are read.</span>
          </div>
        </div>
      </div>
    </>
  );
}
