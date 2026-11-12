"use client";
import { useEffect, useRef, useState } from "react";
import { BRAND_SRC } from "@/lib/brand";

const TRIGGER = 70; // how far to pull (after damping) before letting go reloads
const MAX = 110;

/** Whether something under the finger is a scrolled box (a list in a popup, the calendar), so its own scroll wins. */
function scrolledAncestor(el: EventTarget | null) {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    if (n.scrollTop > 0) return true;
  }
  return false;
}

/**
 * Pull down from the top of the page to reload, like a native app. Only on the home-screen app, where iOS
 * has no pull-to-refresh of its own; in Safari the browser already does this.
 */
export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone) return;
    const root = document.documentElement;
    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
      root.style.setProperty("--ptr-shift", `${v * 0.6}px`);
      root.classList.toggle("ptr-pulling", v > 0 && start.current !== null);
      // The page is only moved while pulling (and while it springs back): a transform on it at other times
      // would make popups position themselves inside the page instead of the screen.
      clearTimeout(off);
      if (v > 0) root.classList.add("ptr-on");
      else off = setTimeout(() => pullRef.current === 0 && root.classList.remove("ptr-on"), 420);
    };
    let off: ReturnType<typeof setTimeout> | undefined;
    const onStart = (e: TouchEvent) => {
      start.current = null;
      if (e.touches.length !== 1 || window.scrollY > 0) return;
      if (document.querySelector(".modal-back, .sheet-back")) return;
      if (scrolledAncestor(e.target)) return;
      start.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) {
        if (pullRef.current) set(0);
        return;
      }
      e.preventDefault();
      set(Math.min(MAX, dy * 0.5));
    };
    const onEnd = () => {
      if (start.current === null) return;
      start.current = null;
      root.classList.remove("ptr-pulling");
      if (pullRef.current >= TRIGGER) {
        navigator.vibrate?.(10);
        setBusy(true);
        set(TRIGGER);
        window.location.reload();
      } else set(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (!pull && !busy) return null;
  const ready = pull >= TRIGGER;
  const progress = Math.min(1, pull / TRIGGER);
  const C = 2 * Math.PI * 22;
  return (
    <div className={`ptr${ready ? " ready" : ""}${busy ? " busy" : ""}`} style={{ "--pull": `${pull}px`, "--p": progress } as React.CSSProperties} aria-live="polite">
      <div className="ptr-badge">
        <svg className="ptr-ring" viewBox="0 0 52 52" aria-hidden>
          <circle cx="26" cy="26" r="22" className="ptr-track" />
          <circle cx="26" cy="26" r="22" className="ptr-fill" style={{ strokeDasharray: C, strokeDashoffset: busy ? C * 0.7 : C * (1 - progress) }} />
        </svg>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ptr-logo" src={BRAND_SRC} alt="" width={30} height={30} />
      </div>
      <span className="ptr-label">{busy ? "Refreshing…" : ready ? "Release to refresh" : "Pull to refresh"}</span>
    </div>
  );
}
