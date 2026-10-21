"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ToastProvider } from "./Toast";
import { apiFetch, resourceUrl, REVIEW_CHANGED, type Space } from "./api";
import "@/app/extra.css";
import "@/app/badge.css";

type Tab = { href: string; label: string; icon: React.ReactNode };

const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
const ICONS = {
  home: svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>),
  list: svg(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>),
  jar: svg(<><path d="M7 4h10M8 4v3a5 5 0 0 0-3 4.6V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7.4A5 5 0 0 0 16 7V4" /><path d="M9 14h6" /></>),
  scale: svg(<><path d="M12 3v18M5 21h14M4 7h16" /><path d="M7 7l-3 7a3 3 0 0 0 6 0L7 7zM17 7l-3 7a3 3 0 0 0 6 0l-3-7z" /></>),
  more: svg(<><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>),
};

export default function Shell({ space, children }: { space: Space; children: React.ReactNode }) {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const base = space === "demo" ? "/demo" : "/app";
  const links = [
    { href: base, label: "Dashboard" },
    { href: `${base}/transactions`, label: "Transactions" },
    { href: `${base}/recipients`, label: "Recipients" },
    { href: `${base}/set-asides`, label: "Set-asides" },
    { href: `${base}/zakat`, label: "Zakat" },
    { href: `${base}/review`, label: "Review inbox" },
    ...(space === "app" ? [{ href: `${base}/settings`, label: "SMS setup" }, { href: `${base}/backup`, label: "Backups" }] : []),
  ];
  // Phone navigation: the four most used pages as tabs, the rest behind "More".
  const tabs: Tab[] = [
    { href: base, label: "Home", icon: ICONS.home },
    { href: `${base}/transactions`, label: "Activity", icon: ICONS.list },
    { href: `${base}/set-asides`, label: "Set-asides", icon: ICONS.jar },
    { href: `${base}/zakat`, label: "Zakat", icon: ICONS.scale },
  ];
  const moreLinks = links.filter((l) => !tabs.some((t) => t.href === l.href));
  const inMore = moreLinks.some((l) => l.href === path);

  useEffect(() => setMoreOpen(false), [path]);

  // How many SMS alerts wait in the review inbox; refreshed on navigation, focus and after a review.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () =>
      apiFetch<{ items: unknown[] }>(resourceUrl(space, "review"))
        .then((d) => live && setPending(d.items.length))
        .catch(() => {});
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    window.addEventListener(REVIEW_CHANGED, load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.removeEventListener(REVIEW_CHANGED, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [space, path]);
  // Mirror the count on the home-screen icon where the device supports it.
  useEffect(() => {
    if (space !== "app") return;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    (pending > 0 ? nav.setAppBadge?.(pending) : nav.clearAppBadge?.())?.catch(() => {});
  }, [space, pending]);
  const reviewHref = `${base}/review`;
  const badge = (href: string) =>
    href === reviewHref && pending > 0 ? <span className="count-badge" aria-label={`${pending} to review`}>{pending > 99 ? "99+" : pending}</span> : null;
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  async function logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }
  const title = links.find((l) => l.href === path)?.label ?? "Mizan";
  return (
    <ToastProvider>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link href="/app" className="brand" aria-label="Mizan home">
            <span className="brand-mark" aria-hidden>م</span> <span className="brand-name">Mizan</span>
          </Link>
          <span className="topbar-title" aria-hidden>{path === base ? "" : title}</span>
          <nav className="nav" aria-label="Main">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
                {l.label}
                {badge(l.href)}
              </Link>
            ))}
          </nav>
          <button className="btn sm ghost signout" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main>
        <div className="container">{children}</div>
      </main>
      <nav className="tabbar" aria-label="Main">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={path === t.href ? "active" : ""} aria-current={path === t.href ? "page" : undefined}>
            {t.icon}
            <span>{t.label}</span>
          </Link>
        ))}
        <button type="button" className={inMore || moreOpen ? "active" : ""} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <span className="tab-icon">
            {ICONS.more}
            {pending > 0 && <span className="count-badge on-icon" aria-label={`${pending} to review`}>{pending > 99 ? "99+" : pending}</span>}
          </span>
          <span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <div className="sheet-back" onClick={() => setMoreOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" aria-hidden />
            {moreLinks.map((l) => (
              <Link key={l.href} href={l.href} className={`sheet-item${path === l.href ? " active" : ""}`}>
                <span className="sheet-label">{l.label}{badge(l.href)}</span>
                <span aria-hidden>›</span>
              </Link>
            ))}
            <button type="button" className="sheet-item danger" onClick={logout}>Sign out</button>
            <button type="button" className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={() => setMoreOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </ToastProvider>
  );
}
