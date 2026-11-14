import { headers } from "next/headers";
import WidgetLauncher from "./WidgetLauncher";
import "../../extra.css";
import "../../setup.css";
import BrandMark from "@/components/BrandMark";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up the Mizan widget", robots: { index: false, follow: false } };

/** Opened on the iPhone from the widget QR code. The one-time code is in the #fragment; no sign-in needed. */
export default async function WidgetPairPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  const server = process.env.APP_URL?.trim().replace(/\/$/, "") || `${proto}://${host}`;
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ marginBottom: 12 }}><BrandMark /> Mizan</div>
        <h1 style={{ fontSize: "1.5rem" }}>Monthly payments widget</h1>
        <p className="muted" style={{ marginTop: 4 }}>Three steps and this month&apos;s payments are on your Home Screen.</p>
        <WidgetLauncher server={server} />
      </div>
    </div>
  );
}
