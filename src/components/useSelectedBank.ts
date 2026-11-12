"use client";
import { useCallback, useSyncExternalStore } from "react";
import type { Space } from "./api";
import { useBanks } from "./useBanks";

/**
 * The bank picked on Overview or Transactions, shared between them and remembered on this device, so
 * switching bank on one page carries over to the other. "" is all banks, "none" is cash, else a bank id.
 */
const KEY = "mizan.bank";
const EVENT = "mizan:bank";

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function setSelectedBank(v: string) {
  try {
    if (v) window.localStorage.setItem(KEY, v);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useSelectedBank(space: Space = "app") {
  const { banks, multi } = useBanks(space);
  const stored = useSyncExternalStore(subscribe, read, () => "");
  // A bank that was removed, or a single-bank install, falls back to all banks.
  const bank = !multi ? "" : stored === "none" || banks.some((b) => b.id === stored) ? stored : "";
  const set = useCallback((v: string) => setSelectedBank(v), []);
  return [bank, set] as const;
}
