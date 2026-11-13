// Plain helpers for showing devices and email addresses; no server-only imports, so tests can load them.

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const shown = user.length <= 2 ? user[0] ?? "" : user.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(1, Math.min(6, user.length - shown.length)))}@${domain}`;
}

/** "iPhone · Safari" from a user agent, good enough to tell your devices apart. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /CrOS/.test(ua) ? "Chromebook"
    : /Linux/.test(ua) ? "Linux"
    : null;
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /Chrome|CriOS/.test(ua) ? "Chrome"
    : /Safari/.test(ua) ? "Safari"
    : null;
  return [os, browser].filter(Boolean).join(" · ") || "Unknown device";
}
