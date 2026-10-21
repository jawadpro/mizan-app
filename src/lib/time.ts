// Mizan works in Asia/Karachi (UTC+05:00, no daylight saving).
export const TZ = "Asia/Karachi";
const OFFSET_MS = 5 * 3600 * 1000;

/** YYYY-MM-DD for "today" in Karachi. */
export function todayPkt(now = new Date()): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Converts a Karachi wall-clock "YYYY-MM-DDTHH:mm" (or date only) to a UTC Date. */
export function pktLocalToDate(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, hh = "12", mm = "00"] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +hh, +mm) - OFFSET_MS;
  const back = new Date(t + OFFSET_MS);
  if (back.getUTCMonth() !== +mo - 1 || back.getUTCDate() !== +d || +hh > 23 || +mm > 59) return null;
  return new Date(t);
}

/** UTC Date to Karachi "YYYY-MM-DDTHH:mm" for datetime-local inputs. */
export function dateToPktLocal(d: Date | string): string {
  return new Date(new Date(d).getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

export function isIsoDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && pktLocalToDate(s) !== null;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dtf = new Intl.DateTimeFormat("en-PK", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const dtfTime = new Intl.DateTimeFormat("en-PK", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
export function formatDatePkt(d: Date | string): string {
  return dtf.format(new Date(d));
}
export function formatTimePkt(d: Date | string): string {
  return dtfTime.format(new Date(d));
}
