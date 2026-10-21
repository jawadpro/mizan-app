import { addDays, todayPkt } from "@/lib/time";

export type Preset = "7d" | "30d" | "month" | "lastMonth" | "12m" | "year" | "custom";
export const PRESETS: { id: Preset; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "month", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "12m", label: "12 months" },
  { id: "year", label: "This year" },
  { id: "custom", label: "Custom" },
];

export function presetRange(p: Preset, now = new Date()): { from: string; to: string; granularity: "day" | "month" | "year" } {
  const today = todayPkt(now);
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (p) {
    case "7d": return { from: addDays(today, -6), to: today, granularity: "day" };
    case "30d": return { from: addDays(today, -29), to: today, granularity: "day" };
    case "month": return { from: `${y}-${pad(m)}-01`, to: today, granularity: "day" };
    case "lastMonth": {
      const first = new Date(Date.UTC(y, m - 2, 1));
      const last = new Date(Date.UTC(y, m - 1, 0));
      return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), granularity: "day" };
    }
    case "12m": {
      const first = new Date(Date.UTC(y, m - 12, 1));
      return { from: first.toISOString().slice(0, 10), to: today, granularity: "month" };
    }
    case "year": return { from: `${y}-01-01`, to: today, granularity: "month" };
    default: return { from: addDays(today, -29), to: today, granularity: "day" };
  }
}
