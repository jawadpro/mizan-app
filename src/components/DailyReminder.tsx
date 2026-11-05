"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DUA } from "@/lib/dua";
import { apiFetch } from "./api";

/**
 * The dua for provision (Al-Qasas 28:24), shown beside the balance. Whether it shows, and which
 * translations, are app settings, so hiding it here hides it on every device.
 */
export default function DailyReminder({ shown, urdu = true, english = true }: { shown: boolean; urdu?: boolean; english?: boolean }) {
  const [on, setOn] = useState(shown);
  const toggle = (next: boolean) => {
    setOn(next);
    apiFetch("/api/preferences", { method: "PATCH", body: JSON.stringify({ dua: next }) }).catch(() => setOn(!next));
  };
  // The dua used to be hidden per device. Carry an old "hidden" choice over to the setting once.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("mizan.reminder.hidden") === "1" && shown) toggle(false);
      window.localStorage.removeItem("mizan.reminder.hidden");
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!on) {
    return (
      <div className="reminder-hidden">
        <button type="button" className="btn ghost sm" onClick={() => toggle(true)}>Show dua</button>
      </div>
    );
  }
  return (
    <div className="reminder">
      <div className="reminder-head">
        <span className="reminder-label">Dua for provision</span>
        <span>
          <Link className="btn ghost sm" href="/app/settings#home">Options</Link>
          <button type="button" className="btn ghost sm" onClick={() => toggle(false)}>Hide</button>
        </span>
      </div>
      <p className="arabic" dir="rtl" lang="ar">{DUA.arabic}</p>
      {urdu && <p className="urdu" dir="rtl" lang="ur">{DUA.urdu}</p>}
      {english && <p className="english">{DUA.english}</p>}
      <p className="reminder-ref">Quran, Al-Qasas {DUA.ref}{urdu ? ` · Urdu translation: ${DUA.source}` : ""}</p>
    </div>
  );
}
