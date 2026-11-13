"use client";
import { useEffect, useState } from "react";
import { currencyInfo } from "@/lib/money";

const KEY = "mizan.amounts.hidden";
const EVENT = "mizan:amounts-hidden";

function read() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the balance is hidden, remembered on this device and kept in step across the page. */
export function useHiddenAmounts(): [boolean, (v: boolean) => void] {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(read());
    const sync = () => setHidden(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const set = (v: boolean) => {
    try {
      window.localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* not remembered on this device */
    }
    setHidden(v);
    window.dispatchEvent(new Event(EVENT));
  };
  return [hidden, set];
}

/** What a hidden amount shows instead of the figure. */
export const masked = () => `${currencyInfo().symbol} ••••••`;
