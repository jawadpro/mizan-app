import { headers } from "next/headers";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SmsSetupPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-app.vercel.app";
  const endpoint = `https://${host}/api/sms`;
  let tokenOk = false;
  try {
    tokenOk = env.smsToken().length >= 32;
  } catch {
    tokenOk = false;
  }
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
          <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Open <strong>Shortcuts</strong>, then the <strong>Automation</strong> tab, then <strong>+</strong> and <strong>Message</strong>.</li>
            <li>Set <strong>Sender</strong> to your bank&apos;s contact or sender ID (one automation per bank) and <strong>Message Contains</strong> to <code>PKR</code> (or <code>Rs</code>). Choose <strong>Run Immediately</strong>, then <strong>Next</strong> and <strong>New Blank Automation</strong>.</li>
            <li>Add <strong>Current Date</strong>, then <strong>Format Date</strong> with Date Format <strong>ISO 8601</strong> and Include Time on.</li>
            <li>Add <strong>Get Contents of URL</strong>: URL <code>{endpoint}</code>, Method <strong>POST</strong>.</li>
            <li>Headers: <code>Authorization</code> = <code>Bearer &lt;your SMS token&gt;</code>, <code>Content-Type</code> = <code>application/json</code>.</li>
            <li>Request Body <strong>JSON</strong>: <code>sender</code> = Shortcut Input → <em>Sender</em>; <code>text</code> = Shortcut Input → <em>Content</em>; <code>receivedAt</code> = <em>Formatted Date</em>.</li>
            <li>Optional: add <strong>Show Notification</strong> with the response so you see “imported”, “review” or “duplicate”.</li>
          </ol>
        </div>
        <div className="grid" style={{ gap: 16, alignContent: "start" }}>
          <div className="card">
            <h3>Endpoint</h3>
            <pre>{`POST ${endpoint}`}</pre>
            <p className="small muted">SMS token: {tokenOk ? "configured on the server ✓ (value is never shown here)" : "not configured"}</p>
          </div>
          <div className="card">
            <h3>Example body (synthetic)</h3>
            <pre>{JSON.stringify({ sender: "MCB", text: "PKR 2,450.00 debited from A/C ****1234 on 15-Oct-2026 14:22 at FOODPANDA. Avl Bal PKR 85,301.17", receivedAt: "2026-10-15T14:22:31+05:00" }, null, 2)}</pre>
          </div>
          <div className="alert warn">
            <span>Unfamiliar or ambiguous messages land in the Review inbox instead of being guessed. Use Test a message in Settings to check how a bank's alerts are read.</span>
          </div>
        </div>
      </div>
    </>
  );
}
