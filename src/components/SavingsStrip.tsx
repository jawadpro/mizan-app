"use client";
import "@/app/savings.css";
import Link from "next/link";
import { formatPaisa } from "@/lib/money";
import { useData } from "./useData";
import { savingsUrl, type SavingsData } from "./SavingsPlan";
import { useSelectedBank } from "./useSelectedBank";

const rs = (p: number) => formatPaisa(Math.round(p)).replace(/\.\d\d$/, "");

/** One line on the dashboard: this month's savings against the target. Hidden until there is a plan. */
export default function SavingsStrip() {
  // Follows the bank picked on Overview, like the rest of the page.
  const [bank] = useSelectedBank();
  const { data } = useData<SavingsData>(savingsUrl(bank));
  if (!data?.ready || data.target <= 0) return null;
  const tm = data.thisMonth;
  // Money left over mid-month still has rent and bills to cover, so show where the month is heading.
  const share = Math.max(0, Math.min(1, tm.projected / data.target));
  const onTrack = tm.projected >= data.target;
  return (
    <Link href="/app/savings" className="card sv-strip">
      <span className="sv-strip-title">Savings this month</span>
      <span className="num"><span className="muted">heading for</span> {tm.projected < 0 ? `−${rs(-tm.projected)}` : rs(tm.projected)} <span className="muted">of {rs(data.target)}</span></span>
      <div className="progress" aria-hidden><div style={{ width: `${Math.max(2, share * 100)}%`, ...(onTrack ? {} : { background: "var(--gold)" }) }} /></div>
      <span className="small muted">
        {tm.income === 0 ? "Waiting for this month's income" : tm.roomLeft >= 0 ? `${rs(tm.roomLeft)} left to spend` : "Target out of reach this month"}
      </span>
    </Link>
  );
}
