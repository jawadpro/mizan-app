"use client";
import { useEffect, useState } from "react";
import PairSteps from "@/components/PairSteps";
import { pairPayload, shortcutRunUrl } from "@/lib/shortcut-link";

/**
 * Opened on the iPhone by scanning the QR code in Mizan. Two steps in order: add the Mizan Shortcut, then hand it
 * the one-time code. The code is in the #fragment, which the browser never sends to any server.
 */
export default function PairLauncher({ server, shortcutName, shortcutUrl }: { server: string; shortcutName: string; shortcutUrl: string | null }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const c = window.location.hash.replace(/^#/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    setCode(c.length === 8 ? c : "");
  }, []);
  if (code === null) return null;
  if (!code) {
    return <div className="alert error" role="alert">This link is incomplete. In Mizan, open Connect iPhone and scan the new QR code.</div>;
  }
  return <PairSteps runUrl={shortcutRunUrl(shortcutName, pairPayload(server, code))} shortcutUrl={shortcutUrl} shortcutName={shortcutName} code={`${code.slice(0, 4)}-${code.slice(4)}`} />;
}
