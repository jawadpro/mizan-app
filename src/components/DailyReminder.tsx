"use client";
import { useEffect, useState } from "react";
import { DUA } from "@/lib/dua";

const KEY = "mizan.reminder.hidden";

/** The dua for provision (Al-Qasas 28:24), shown beside the balance. Hidden state is per device. */
export default function DailyReminder() {
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(KEY) === "1");
    } catch {
      /* storage unavailable: always shown */
    }
    setReady(true);
  }, []);

  const toggle = (h: boolean) => {
    setHidden(h);
    try {
      window.localStorage.setItem(KEY, h ? "1" : "0");
    } catch {
      /* not remembered */
    }
  };

  if (!ready) return null;
  if (hidden) {
    return (
      <div className="reminder-hidden">
        <button type="button" className="btn ghost sm" onClick={() => toggle(false)}>Show dua</button>
      </div>
    );
  }
  return (
    <div className="reminder">
      <div className="reminder-head">
        <span className="reminder-label">Dua for provision</span>
        <button type="button" className="btn ghost sm" onClick={() => toggle(true)}>Hide</button>
      </div>
      <p className="arabic" dir="rtl" lang="ar">{DUA.arabic}</p>
      <p className="urdu" dir="rtl" lang="ur">{DUA.urdu}</p>
      <p className="english">{DUA.english}</p>
      <p className="reminder-ref">Quran, Al-Qasas {DUA.ref} · Urdu translation: {DUA.source}</p>
    </div>
  );
}
