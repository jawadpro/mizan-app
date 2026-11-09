// Spending check: plain rules that look at the month so far and say when spending is off track.
// Pure functions only, so the rules can be tested without a database. All money is paisa.

import { currencyInfo, formatPaisa } from "./money";

/** Giving and saving are never "overspending", so they are left out of pace and spike checks. */
export const NOT_CONTROLLABLE = new Set(["Zakat", "Charity", "Savings"]);

export type TipAction =
  | { kind: "limit"; category: string; suggested?: number; existing?: number }
  | { kind: "transactions"; category?: string; label?: string }
  | { kind: "link"; href: string; label: string };

export type Tip = {
  id: string;
  tone: "bad" | "warn";
  title: string;
  detail: string;
  actions: TipAction[];
};

export type LimitStatus = { category: string; limit: number; spent: number; projected: number | null };

export type InsightInput = {
  /** Karachi date, YYYY-MM-DD. */
  today: string;
  /** Expense spent this month so far, by category (own-account transfers already removed). */
  monthByCategory: Record<string, number>;
  /** Totals over the baseline months, counting only days 1..today's day of each month. */
  baselineSameDays: Record<string, number>;
  /** Totals over the baseline months, whole months. */
  baselineFull: Record<string, number>;
  /** How many earlier months (up to 3) the baseline covers. 0 means no history yet. */
  baselineMonths: number;
  /** Every expense in the last 30 days, for the daily rate. */
  last30Expense: number;
  /** Balance less money set aside; null when no balance has been set. */
  freeToSpend: number | null;
  limits: { category: string; limit: number }[];
  /** Saving set-asides that have paid out more than was put in. */
  overspentFunds: { id: string; name: string; over: number }[];
  /** Share of a limit at which the "close to its limit" warning starts. Defaults to 0.8. */
  warnAt?: number;
};

export type Insights = {
  month: { from: string; to: string; day: number; days: number };
  baselineMonths: number;
  spent: number;
  usualSoFar: number | null;
  tips: Tip[];
  limits: LimitStatus[];
  warnAt: number;
};

const rs = (p: number) => formatPaisa(Math.round(p)).replace(/\.\d\d$/, "");
/** Thresholds below are in rupees; this scales them to the chosen currency (Rs 5,000 is about $50). */
const scaled = (paisa: number) => Math.max(100, Math.round(paisa * currencyInfo().scale));
/** Rounds a suggested limit up to a tidy figure: nearest Rs 500 under Rs 10k, else Rs 1,000. */
export function tidyLimit(p: number) {
  const step = p < scaled(1_000_000) ? scaled(50_000) : scaled(100_000);
  return Math.max(step, Math.ceil(p / step) * step);
}
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
};
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100);

export function daysInMonth(isoDate: string) {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Pace checks need a few days of data before a projection means anything. */
const MIN_DAYS_FOR_PROJECTION = 7;
/** Rs 5,000 overall, Rs 2,000 for one category: smaller swings are noise, not a problem. */
const PACE_MIN_GAP = () => scaled(500_000);
const SPIKE_MIN_GAP = () => scaled(200_000);

export function buildInsights(i: InsightInput): Insights {
  const day = Number(i.today.slice(8, 10));
  const days = daysInMonth(i.today);
  const left = days - day;
  const from = `${i.today.slice(0, 8)}01`;
  const controllable = (c: string) => !NOT_CONTROLLABLE.has(c);
  const sum = (r: Record<string, number>, pick = controllable) => Object.entries(r).reduce((a, [c, v]) => (pick(c) ? a + v : a), 0);
  const limitOf = new Map(i.limits.map((l) => [l.category, l.limit]));
  const canProject = day >= MIN_DAYS_FOR_PROJECTION;
  const project = (spent: number) => (canProject ? Math.round((spent / day) * days) : null);
  const tips: Tip[] = [];
  const n = i.baselineMonths;
  const warnAt = i.warnAt ?? 0.8;
  let paceDriver: string | null = null;

  // 1. Category limits the user set.
  const limits: LimitStatus[] = i.limits
    .map((l) => ({ ...l, spent: i.monthByCategory[l.category] ?? 0, projected: project(i.monthByCategory[l.category] ?? 0) }))
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit);
  for (const l of limits) {
    const actions: TipAction[] = [{ kind: "transactions", category: l.category }, { kind: "limit", category: l.category, existing: l.limit }];
    if (l.spent >= l.limit) {
      tips.push({
        id: `limit-over:${l.category}`,
        tone: "bad",
        title: `${l.category} is over its limit`,
        detail: `${rs(l.spent)} spent against a ${rs(l.limit)} limit, ${rs(l.spent - l.limit)} over${left > 0 ? ` with ${left} ${left === 1 ? "day" : "days"} still to go` : ""}. Hold off on ${l.category.toLowerCase()} for the rest of the month if you can.`,
        actions,
      });
    } else if (l.spent >= l.limit * warnAt) {
      tips.push({
        id: `limit-near:${l.category}`,
        tone: "warn",
        title: `${l.category} is close to its limit`,
        detail: `${Math.round((l.spent / l.limit) * 100)}% of the ${rs(l.limit)} limit is used. ${rs(l.limit - l.spent)} is left${left > 0 ? `, about ${rs((l.limit - l.spent) / left)} a day` : ""}.`,
        actions,
      });
    } else if (l.projected != null && l.projected > l.limit * 1.1) {
      tips.push({
        id: `limit-pace:${l.category}`,
        tone: "warn",
        title: `${l.category} is on track to pass its limit`,
        detail: `At this pace the month ends near ${rs(l.projected)} against a ${rs(l.limit)} limit. Keeping to ${rs((l.limit - l.spent) / Math.max(1, left))} a day keeps it under.`,
        actions,
      });
    }
  }

  // 2. Overall pace against the same days of recent months.
  const spent = sum(i.monthByCategory);
  const usualSoFar = n > 0 ? Math.round(sum(i.baselineSameDays) / n) : null;
  if (usualSoFar != null && usualSoFar > 0 && spent > usualSoFar * 1.2 && spent - usualSoFar >= PACE_MIN_GAP()) {
    // Name the category that pushed it up the most.
    const drivers = Object.keys(i.monthByCategory)
      .filter(controllable)
      .map((c) => ({ c, gap: i.monthByCategory[c] - (i.baselineSameDays[c] ?? 0) / n }))
      .sort((a, b) => b.gap - a.gap);
    const top = drivers[0]?.gap > 0 ? drivers[0] : null;
    paceDriver = top?.c ?? null;
    const usualMonth = Math.round(sum(i.baselineFull) / n);
    const proj = project(spent);
    tips.push({
      id: "pace",
      tone: spent > usualSoFar * 1.5 ? "bad" : "warn",
      title: "Spending is running ahead of usual",
      detail:
        `${rs(spent)} spent by the ${ordinal(day)}, ${pct(spent, usualSoFar)}% more than the ${rs(usualSoFar)} you usually spend by this date.` +
        (proj != null && proj > usualMonth ? ` At this pace the month ends near ${rs(proj)}, against a usual ${rs(usualMonth)}.` : "") +
        (top ? ` Most of the extra is ${top.c} (${rs(top.gap)} more).` : ""),
      actions: top
        ? [{ kind: "transactions", category: top.c }, ...(limitOf.has(top.c) ? [] : [{ kind: "limit" as const, category: top.c, suggested: tidyLimit((i.baselineFull[top.c] ?? 0) / n) }])]
        : [{ kind: "transactions" }],
    });
  }

  // 3. One category well above its own usual level (unless a limit already watches it).
  if (n > 0) {
    const spikes = Object.keys(i.monthByCategory)
      .filter((c) => controllable(c) && !limitOf.has(c) && c !== paceDriver)
      .map((c) => ({ c, now: i.monthByCategory[c], usual: (i.baselineSameDays[c] ?? 0) / n, month: (i.baselineFull[c] ?? 0) / n }))
      .filter((x) => x.now - x.usual >= SPIKE_MIN_GAP() && (x.usual === 0 ? x.month > 0 && x.now > x.month : x.now > x.usual * 1.5))
      .sort((a, b) => b.now - b.usual - (a.now - a.usual))
      .slice(0, 2);
    for (const s of spikes) {
      tips.push({
        id: `spike:${s.c}`,
        tone: "warn",
        title: `${s.c} is higher than usual`,
        detail: s.usual > 0
          ? `${rs(s.now)} so far this month, against about ${rs(s.usual)} by this date normally (${pct(s.now, s.usual)}% more). A monthly limit makes it easy to keep an eye on.`
          : `${rs(s.now)} so far this month, already more than the ${rs(s.month)} a whole month usually costs. A monthly limit makes it easy to keep an eye on.`,
        actions: [{ kind: "transactions", category: s.c }, { kind: "limit", category: s.c, suggested: tidyLimit(Math.max(s.month, s.usual)) }],
      });
    }
  }

  // 4. Free-to-spend money running out before the month does.
  const daily = i.last30Expense / 30;
  if (i.freeToSpend != null && left > 0) {
    if (i.freeToSpend <= 0) {
      tips.push({
        id: "runway",
        tone: "bad",
        title: "Nothing left that's free to spend",
        detail: `Your balance is ${i.freeToSpend < 0 ? `${rs(-i.freeToSpend)} short of` : "fully taken up by"} what you've set aside, with ${left} ${left === 1 ? "day" : "days"} left this month. Spending now uses set-aside money.`,
        actions: [{ kind: "link", href: "/app/set-asides", label: "Open set-asides" }],
      });
    } else if (daily > 0 && i.freeToSpend < daily * left) {
      const lasts = Math.floor(i.freeToSpend / daily);
      tips.push({
        id: "runway",
        tone: lasts < left / 2 ? "bad" : "warn",
        title: "Free-to-spend money may run out",
        detail: `At about ${rs(daily)} a day, the ${rs(i.freeToSpend)} free to spend lasts around ${lasts} ${lasts === 1 ? "day" : "days"}, but ${left} are left this month. Keeping to about ${rs(i.freeToSpend / left)} a day gets you to the end.`,
        actions: [{ kind: "transactions" }],
      });
    }
  }

  // 5. Saving set-asides already spent past what was put in.
  for (const f of i.overspentFunds) {
    tips.push({
      id: `fund:${f.id}`,
      tone: "warn",
      title: `${f.name} is overspent`,
      detail: `${rs(f.over)} more has been paid out of ${f.name} than was put in. New shares will fill the gap before it grows again.`,
      actions: [{ kind: "link", href: "/app/set-asides", label: "Open set-asides" }],
    });
  }

  tips.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "bad" ? -1 : 1));
  return { month: { from, to: i.today, day, days }, baselineMonths: n, spent, usualSoFar, tips, limits, warnAt };
}
