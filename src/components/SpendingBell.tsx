"use client";
import "@/app/spending.css";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Insights } from "@/lib/insights";
import { apiFetch } from "./api";
import SpendingCheck, { readHidden, TIPS_CHANGED } from "./SpendingCheck";

const BELL = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

type Summary = { enabled: boolean; count: number; bad: boolean };

/** Bell with a count of spending tips that need attention. Opens the spending check in a panel. */
export default function SpendingBell({ className = "icon-btn" }: { className?: string }) {
  const path = usePathname();
  const [sum, setSum] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    apiFetch<Insights & { enabled?: boolean }>("/api/insights")
      .then((d) => {
        const hidden = readHidden(d.month.from);
        const tips = d.tips.filter((t) => !hidden.includes(t.id));
        setSum({ enabled: d.enabled !== false, count: tips.length, bad: tips.some((t) => t.tone === "bad") });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    window.addEventListener(TIPS_CHANGED, load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(TIPS_CHANGED, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, path]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".modal") && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!sum?.enabled) return null;
  const label = sum.count ? `Spending check: ${sum.count} tip${sum.count === 1 ? "" : "s"}` : "Spending check: on track";
  return (
    <>
      <button type="button" className={`${className} bell`} onClick={() => setOpen(true)} aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open}>
        {BELL}
        {sum.count > 0 && <span className={`bell-dot${sum.bad ? " bad" : ""}`} aria-hidden>{sum.count > 9 ? "9+" : sum.count}</span>}
      </button>
      {open && createPortal(
        <div className="drawer-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="spend-title">
            <SpendingCheck onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
