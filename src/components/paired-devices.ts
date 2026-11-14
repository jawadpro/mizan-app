"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

export type Device = {
  id: string; name: string; kind: "shortcut" | "widget"; token_hint: string; paired_at: string;
  last_seen_at: string | null; last_sms_at: string | null; last_test_at: string | null; revoked_at: string | null;
  imported_count: number; review_count: number; duplicate_count: number; ignored_count: number; failed_count: number;
};

export type DevicesInfo = {
  items: Device[];
  pairing: { expires_at: string; used_at: string | null; device_id: string | null } | null;
  shortcut: { url: string | null; name: string };
  phoneUrl: string;
};

export type PairingCode = { code: string; expiresAt: string; runUrl: string; pairPageUrl: string; payload: string; server?: string };

/** Fired with `detail: true` when an iPhone is connected, false when none is. */
export const IPHONE_STATUS = "mizan:iphone-status";

/** Paired iPhones (or widgets), refreshed every few seconds while `live` (during setup, to notice pairing and tests). */
export function useDevices(live = false, kind: "shortcut" | "widget" = "shortcut") {
  const [data, setData] = useState<DevicesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const d = await apiFetch<DevicesInfo & { ok: true }>(kind === "widget" ? "/api/devices?kind=widget" : "/api/devices");
      setData(d);
      setError(null);
      // Lets the menu's red or green dot follow along without its own polling.
      if (kind === "shortcut") window.dispatchEvent(new CustomEvent(IPHONE_STATUS, { detail: d.items.some(isConnected) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [kind]);
  useEffect(() => {
    load();
    if (!live) return;
    const t = setInterval(() => document.visibilityState === "visible" && load(), 3000);
    return () => clearInterval(t);
  }, [load, live]);
  return { data, error, reload: load };
}

/** A pairing code that renews itself when it runs out, until the iPhone uses it. */
export function usePairingCode(enabled: boolean, opts: { replaces?: string; kind?: "widget" } = {}) {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const make = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      setCode(await apiFetch<PairingCode>("/api/devices/code", { method: "POST", body: JSON.stringify({ ...(opts.replaces ? { replaces: opts.replaces } : {}), ...(opts.kind ? { kind: opts.kind } : {}) }) }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }, [opts.replaces, opts.kind]);
  useEffect(() => {
    if (enabled && !code) make();
  }, [enabled, code, make]);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  const secondsLeft = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0;
  return { code, error, secondsLeft, renew: make };
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Connected means the iPhone has used its key at least once, so it really saved it. */
export const isConnected = (d: Device) => !d.revoked_at && !!d.last_seen_at;

/** What the device list says about a device, in plain words. */
export function deviceStatus(d: Device): { tone: "ok" | "wait" | "warn" | "off"; label: string; detail: string } {
  if (d.revoked_at) return { tone: "off", label: "Removed", detail: `Removed ${ago(d.revoked_at)}. It can't send alerts any more.` };
  if (!d.last_seen_at) {
    return { tone: "warn", label: "Not finished", detail: "This iPhone got a code but hasn't confirmed it saved its key. Open Shortcuts and tap the Mizan Shortcut once, or remove it and scan again." };
  }
  if (d.last_sms_at) {
    const stale = Date.now() - Date.parse(d.last_sms_at) > 14 * 86400e3;
    return stale
      ? { tone: "warn", label: "Quiet", detail: `Last bank alert ${ago(d.last_sms_at)}. If you've had alerts since, check the Message automation on this iPhone.` }
      : { tone: "ok", label: "Working", detail: `Last bank alert ${ago(d.last_sms_at)}.` };
  }
  if (d.last_test_at) return { tone: "wait", label: "Test received", detail: `The Shortcut reached Mizan ${ago(d.last_test_at)}. Waiting for the first real bank alert.` };
  return { tone: "ok", label: "Connected", detail: "Ready. Bank alerts arrive as soon as the Message automation is on." };
}

export function isIphone(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 && /Mobile/.test(navigator.userAgent));
}
