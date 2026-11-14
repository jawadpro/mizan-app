"use client";
import { useEffect, useState } from "react";
import WidgetSteps, { AddWidgetGuide } from "@/components/WidgetSteps";
import { WIDGET_SCRIPT_NAME, pairPayload, scriptableRunUrl } from "@/lib/shortcut-link";

/** The widget's setup steps on the iPhone. The code is in the #fragment, which the browser never sends to a server. */
export default function WidgetLauncher({ server }: { server: string }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const c = window.location.hash.replace(/^#/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    setCode(c.length === 8 ? c : "");
  }, []);
  if (code === null) return null;
  if (!code) {
    return <div className="alert error" role="alert">This link is incomplete. In Mizan, open Monthly payments › Home Screen widget and scan the new QR code.</div>;
  }
  return (
    <>
      <WidgetSteps runUrl={scriptableRunUrl(WIDGET_SCRIPT_NAME, { pair: pairPayload(server, code) })} code={`${code.slice(0, 4)}-${code.slice(4)}`} server={server} />
      <details style={{ marginTop: 12 }}>
        <summary className="small">Then put it on your Home Screen</summary>
        <AddWidgetGuide />
      </details>
    </>
  );
}
