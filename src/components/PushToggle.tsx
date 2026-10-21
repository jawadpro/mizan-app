"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useToast } from "./Toast";

type State = "loading" | "unsupported" | "ios-browser" | "unconfigured" | "denied" | "off" | "on";

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** Lets this device get a notification when an MCB alert lands in the review inbox. */
export default function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return setState(isIos() && !isStandalone() ? "ios-browser" : "unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const { publicKey } = await apiFetch<{ publicKey: string | null }>("/api/push");
      if (!publicKey) return setState("unconfigured");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
      await apiFetch("/api/push", { method: "POST", body: JSON.stringify(sub.toJSON()) });
      setState("on");
      toast("Notifications are on for this device", "ok");
    } catch (e) {
      toast((e as Error).message || "Couldn't turn on notifications", "error");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await apiFetch("/api/push", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
      toast("Notifications are off for this device", "ok");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await apiFetch("/api/push/test", { method: "POST" });
      toast("Test sent. It should appear in a few seconds.", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head">
        <div>
          <strong>Notifications</strong>
          <div className="small muted">
            {state === "on" && "This device gets a notification when an alert needs your review."}
            {state === "off" && "Get a notification on this device when an alert needs your review. It never shows the SMS or the amount."}
            {state === "ios-browser" && "On iPhone, add Mizan to your Home Screen first: tap Share, then Add to Home Screen, and open Mizan from the new icon. Needs iOS 16.4 or later."}
            {state === "unsupported" && "This browser can't receive notifications."}
            {state === "denied" && "Notifications are blocked for Mizan. Allow them in your device settings, then come back here."}
            {state === "unconfigured" && "Notifications aren't set up on the server yet."}
          </div>
        </div>
        <div className="toolbar">
          {state === "off" && <button className="btn primary sm" disabled={busy} onClick={turnOn}>Turn on</button>}
          {state === "on" && (
            <>
              <button className="btn sm" disabled={busy} onClick={test}>Send test</button>
              <button className="btn sm" disabled={busy} onClick={turnOff}>Turn off</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
