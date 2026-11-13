import { headers } from "next/headers";
import { shortcutConfig } from "@/lib/paired-devices";
import PairLauncher from "./PairLauncher";
import "../extra.css";
import "../setup.css";
import BrandMark from "@/components/BrandMark";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect your iPhone", robots: { index: false, follow: false } };

/** Opened on the iPhone from the pairing QR code. The one-time code is in the #fragment; no sign-in needed. */
export default async function PairPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  const server = process.env.APP_URL?.trim().replace(/\/$/, "") || `${proto}://${host}`;
  const sc = shortcutConfig();
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ marginBottom: 12 }}><BrandMark /> Mizan</div>
        <h1 style={{ fontSize: "1.5rem" }}>Connect this iPhone to Mizan</h1>
        <p className="muted" style={{ marginTop: 4 }}>Two taps and this iPhone sends your bank alerts to Mizan as they arrive.</p>
        <PairLauncher server={server} shortcutName={sc.name} shortcutUrl={sc.url} />
      </div>
    </div>
  );
}
