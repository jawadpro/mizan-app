"use client";
import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "mizan.theme";
const EVENT = "mizan:theme";

function readPref(): ThemePref {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** The theme picked on this device. "system" follows the phone or computer setting. */
export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPrefState] = useState<ThemePref>("system");
  useEffect(() => {
    setPrefState(readPref());
    const on = () => setPrefState(readPref());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const setPref = (p: ThemePref) => {
    try {
      if (p === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, p);
    } catch {
      /* not remembered on this device */
    }
    if (p === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = p;
    window.dispatchEvent(new Event(EVENT));
  };
  return [pref, setPref];
}

export const NEXT_THEME: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
export const THEME_LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };

const TOKENS = ["text", "muted", "faint", "surface", "border", "border-strong", "accent", "down", "remit", "bar", "bar-strong", "gold"] as const;
export type ChartColors = Record<(typeof TOKENS)[number], string>;

const FALLBACK: ChartColors = {
  text: "#121614", muted: "#6b726e", faint: "#9aa19c", surface: "#ffffff", border: "#e6e8e6", "border-strong": "#d6dad7",
  accent: "#1f8a5b", down: "#d24b3e", remit: "#3f67a8", bar: "#e0e3e0", "bar-strong": "#c5cbc6", gold: "#b58a3a",
};

/** Resolved theme colours for chart libraries that need real colour values rather than CSS variables. */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(FALLBACK);
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const next = { ...FALLBACK };
      for (const t of TOKENS) next[t] = cs.getPropertyValue(`--${t}`).trim() || FALLBACK[t];
      setColors(next);
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    window.addEventListener(EVENT, read);
    return () => {
      mq.removeEventListener("change", read);
      window.removeEventListener(EVENT, read);
    };
  }, []);
  return colors;
}
