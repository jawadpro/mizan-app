"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ToastProvider } from "./Toast";
import SpendingBell from "./SpendingBell";
import { apiFetch, resourceUrl, REVIEW_CHANGED, type Space } from "./api";
import "@/app/extra.css";
import "@/app/badge.css";
import { NEXT_THEME, THEME_LABEL, useTheme } from "./theme";
import { DEFAULT_CURRENCY, setDisplayCurrency } from "@/lib/money";
import BrandMark from "@/components/BrandMark";

type Tab = { href: string; label: string; icon: React.ReactNode };

const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
const ICONS = {
  home: svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>),
  calendar: svg(<><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8 14h2M14 14h2M8 17.5h2" /></>),
  list: svg(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>),
  people: svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>),
  jar: svg(<><path d="M7 4h10M8 4v3a5 5 0 0 0-3 4.6V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7.4A5 5 0 0 0 16 7V4" /><path d="M9 14h6" /></>),
  scale: svg(<><path d="M12 3v18M5 21h14M4 7h16" /><path d="M7 7l-3 7a3 3 0 0 0 6 0L7 7zM17 7l-3 7a3 3 0 0 0 6 0l-3-7z" /></>),
  inbox: svg(<><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5.5 5h13L20 13v6H4v-6z" /></>),
  phone: svg(<><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M11 18.5h2" /></>),
  cloud: svg(<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.5A3.8 3.8 0 0 1 17.5 18H7z" />),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  check: svg(<><rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="M8 9l1.5 1.5L12 8M8 15l1.5 1.5L12 14M14.5 9.5H17M14.5 15.5H17" /></>),
  split: svg(<><path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21z" /><path d="M9 8h6M9 12h6M9 16h3" /></>),
  more: svg(<><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>),
  out: svg(<><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>),
  system: svg(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>),
  light: svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  dark: svg(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />),
};

export default function Shell({ space, children, currency = DEFAULT_CURRENCY }: { space: Space; children: React.ReactNode; currency?: string }) {
  // Set before any child renders, on the server and in the browser, so every amount uses the chosen currency.
  setDisplayCurrency(currency);
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const base = space === "demo" ? "/demo" : "/app";
  const links = [
    { href: base, label: "Dashboard", icon: ICONS.home },
    { href: `${base}/transactions`, label: "Transactions", icon: ICONS.list },
    { href: `${base}/calendar`, label: "Calendar", icon: ICONS.calendar },
    ...(space === "app" ? [{ href: `${base}/monthly`, label: "Monthly payments", icon: ICONS.check }, { href: `${base}/splits`, label: "Bill splits", icon: ICONS.split }] : []),
    { href: `${base}/recipients`, label: "Recipients", icon: ICONS.people },
    { href: `${base}/set-asides`, label: "Set-asides", icon: ICONS.jar },
    { href: `${base}/zakat`, label: "Zakat", icon: ICONS.scale },
    { href: `${base}/review`, label: "Review inbox", icon: ICONS.inbox },
  ];
  const setupLinks = space === "app" ? [
    { href: `${base}/sms`, label: "SMS setup", icon: ICONS.phone },
    { href: `${base}/backup`, label: "Backups", icon: ICONS.cloud },
    { href: `${base}/settings`, label: "Settings", icon: ICONS.gear },
  ] : [];
  const allLinks = [...links, ...setupLinks];
  const [theme, setTheme] = useTheme();
  // Phone navigation: the four most used pages as tabs, the rest behind "More".
  const tabs: Tab[] = [
    { href: base, label: "Home", icon: ICONS.home },
    { href: `${base}/transactions`, label: "Activity", icon: ICONS.list },
    { href: `${base}/set-asides`, label: "Set-asides", icon: ICONS.jar },
    { href: `${base}/zakat`, label: "Zakat", icon: ICONS.scale },
  ];
  const moreLinks = allLinks.filter((l) => !tabs.some((t) => t.href === l.href));

  // The tab you tap lights up at once, before the page arrives, then follows the real path.
  const [tapped, setTapped] = useState<string | null>(null);
  const current = tapped ?? path;
  const onTab = tabs.findIndex((t) => t.href === current);
  const tabIndex = moreOpen || onTab < 0 ? tabs.length : onTab;
  useEffect(() => {
    setMoreOpen(false);
    setTapped(null);
  }, [path]);

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
  const title = allLinks.find((l) => l.href === path)?.label ?? "Mizan";
  const themeButton = (cls: string, withLabel: boolean) => (
    <button type="button" className={cls} onClick={() => setTheme(NEXT_THEME[theme])} aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[NEXT_THEME[theme]]}`} title={`Theme: ${THEME_LABEL[theme]}`}>
      {ICONS[theme]}
      {withLabel && <span>Theme: {THEME_LABEL[theme]}</span>}
    </button>
  );
  return (
    <ToastProvider>
      <div className="layout">
        <aside className="sidebar">
          <div className="side-brand">
            <Link href={base} className="brand" aria-label="Mizan home">
              <BrandMark /> <span className="brand-name">Mizan</span>
            </Link>
            {space === "app" && <SpendingBell />}
          </div>
          <nav className="side-nav" aria-label="Main">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={`side-link${path === l.href ? " active" : ""}`} aria-current={path === l.href ? "page" : undefined}>
                {l.icon}
                <span>{l.label}</span>
                {badge(l.href)}
              </Link>
            ))}
            {setupLinks.length > 0 && <div className="side-group">Setup</div>}
            {setupLinks.map((l) => (
              <Link key={l.href} href={l.href} className={`side-link${path === l.href ? " active" : ""}`} aria-current={path === l.href ? "page" : undefined}>
                {l.icon}
                <span>{l.label}</span>
              </Link>
            ))}
          </nav>
          <div className="side-foot">
            {themeButton("side-link", true)}
            <button type="button" className="side-link" onClick={logout}>{ICONS.out}<span>Sign out</span></button>
          </div>
        </aside>
        <div className="main-col">
          <header className="topbar">
            <Link href={base} className="brand" aria-label="Mizan home">
              <BrandMark /> <span className="brand-name">Mizan</span>
            </Link>
            <span className="topbar-title" aria-hidden>{path === base ? "" : title}</span>
            {space === "app" && <span className="topbar-bell"><SpendingBell /></span>}
            {themeButton("icon-btn", false)}
          </header>
          <main>
            <div className="container">{children}</div>
          </main>
        </div>
      </div>
      <nav className="tabbar" aria-label="Main" style={{ "--tab-i": tabIndex } as React.CSSProperties}>
        <span className="tab-pill" aria-hidden />
        {tabs.map((t) => {
          const on = !moreOpen && current === t.href;
          return (
            // Full prefetch: each tab's page is fetched ahead, so a tap swaps the screen without waiting on the server.
            <Link key={t.href} href={t.href} prefetch className={on ? "active" : ""} aria-current={on ? "page" : undefined} onClick={() => setTapped(t.href === path ? null : t.href)}>
              {t.icon}
              <span>{t.label}</span>
            </Link>
          );
        })}
        <button type="button" className={tabIndex === tabs.length ? "active" : ""} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
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
