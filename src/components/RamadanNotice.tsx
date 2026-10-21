"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { currentOrNextRamadan, type RamadanInfo } from "@/lib/ramadan";
import { formatDatePkt, todayPkt } from "@/lib/time";

/** A dashboard reminder from 30 days before Ramadan until it ends, pointing to the Zakat page. */
export default function RamadanNotice() {
  const [r, setR] = useState<RamadanInfo | null>(null);
  useEffect(() => setR(currentOrNextRamadan(todayPkt())), []);
  if (!r || (!r.now && r.daysUntil > 30)) return null;
  return (
    <div className="alert ok" style={{ marginBottom: 16 }}>
      <span>
        {r.now
          ? `Ramadan ${r.hijriYear} is here. Time to work out and pay this year's Zakat.`
          : `Ramadan ${r.hijriYear} starts around ${formatDatePkt(`${r.start}T12:00:00+05:00`)}, in ${r.daysUntil} ${r.daysUntil === 1 ? "day" : "days"}. Get ready to work out your Zakat.`}
      </span>
      <Link href="/app/zakat" className="btn sm">Open Zakat</Link>
    </div>
  );
}
