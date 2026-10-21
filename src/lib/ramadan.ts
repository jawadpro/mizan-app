// Ramadan dates from the Umm al-Qura Hijri calendar built into Intl. Pakistan starts the month
// on its own moon sighting, which is often a day later, so these dates are shown as "around".

import { addDays } from "./time";

const hijri = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });

export type HijriDate = { y: number; m: number; d: number };

/** Hijri date of a YYYY-MM-DD Gregorian date. */
export function toHijri(isoDate: string): HijriDate {
  const parts = hijri.formatToParts(new Date(`${isoDate}T12:00:00Z`));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "", 10);
  return { y: get("year"), m: get("month"), d: get("day") };
}

export type RamadanInfo = {
  /** Hijri year of this Ramadan, e.g. 1448. */
  hijriYear: number;
  /** First and last Gregorian day of the month. */
  start: string;
  end: string;
  /** True while today falls inside this Ramadan. */
  now: boolean;
  /** Days from today to the first day (0 while it is Ramadan). */
  daysUntil: number;
};

const RAMADAN = 9;

/** The Ramadan happening today, or else the next one. */
export function currentOrNextRamadan(today: string): RamadanInfo {
  let day = today;
  const h = toHijri(day);
  if (h.m !== RAMADAN) {
    // Jump close to the next 1 Ramadan (a Hijri month is 29 or 30 days), then step day by day.
    const monthsAhead = (RAMADAN - h.m + 12) % 12;
    day = addDays(day, Math.max(0, monthsAhead * 29 - h.d - 2));
    for (let i = 0; i < 70 && toHijri(day).m !== RAMADAN; i++) day = addDays(day, 1);
  } else {
    day = addDays(day, 1 - h.d);
  }
  const start = day;
  let end = addDays(start, 28);
  while (toHijri(addDays(end, 1)).m === RAMADAN) end = addDays(end, 1);
  const daysUntil = Math.max(0, Math.round((Date.parse(start) - Date.parse(today)) / 864e5));
  return { hijriYear: toHijri(start).y, start, end, now: today >= start && today <= end, daysUntil };
}

/** First day of Ramadan in a given Hijri year. */
export function ramadanStart(hijriYear: number): string {
  // 1 Ramadan 1448 falls in February 2027; each Hijri year is about 354.37 days.
  let day = addDays("2027-02-08", Math.round((hijriYear - 1448) * 354.367) - 5);
  for (let i = 0; i < 15; i++) {
    const h = toHijri(day);
    if (h.y === hijriYear && h.m === RAMADAN && h.d === 1) return day;
    day = addDays(day, 1);
  }
  throw new Error("Could not place Ramadan");
}

/**
 * The Ramadan a Zakat payment counts towards: payments up to the end of Ramadan count for that
 * Ramadan, and anything paid after Eid counts in advance towards the next one.
 */
export function zakatYearOf(isoDate: string): number {
  const h = toHijri(isoDate);
  return h.m > RAMADAN ? h.y + 1 : h.y;
}
