"use client";
import Link from "next/link";
import { formatPaisa } from "@/lib/money";
import { dueDate, monthLabel } from "@/lib/monthly";
import { useData } from "./useData";
import { shortDate, summarize, type MonthlyData } from "./MonthlyPayments";

/** One line on the dashboard: how this month's payments are going. Hidden until there is a list. */
export default function MonthlyStrip() {
  const { data } = useData<MonthlyData>("/api/monthly");
  if (!data || data.items.length === 0) return null;
  const s = summarize(data);
  const next = s.open
    .map((r) => ({ r, due: dueDate(data.month, r.due_day) }))
    .sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"))[0];
  const late = next?.due && next.due < data.today;
  return (
    <Link href="/app/monthly" className="card mp-strip">
      <span className="mp-strip-title">{monthLabel(data.month, "short").replace(/ \d{4}$/, "")} payments</span>
      <span className="num">{s.paid}/{s.due} paid</span>
      <div className="progress" aria-hidden><div style={{ width: `${s.due ? (s.paid / s.due) * 100 : 100}%` }} /></div>
      <span className="small muted">
        {s.open.length === 0 ? "All done for this month" : next ? (
          <>Next: {next.r.name}{next.due ? <span style={late ? { color: "var(--down-ink)" } : undefined}>{late ? ", late" : `, due ${shortDate(next.due)}`}</span> : ""}
            {s.leftTotal > 0 && ` · ${formatPaisa(s.leftTotal).replace(/\.00$/, "")} to go`}</>
        ) : null}
      </span>
    </Link>
  );
}
