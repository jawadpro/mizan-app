// Savings plan: how much can realistically be saved each month, and plain tips for saving more.
// Rule-based and built only from the owner's own records. Pure functions, so it can be tested without a
// database. All money is paisa.

import { currencyInfo, formatPaisa } from "./money";
import { daysInMonth } from "./insights";

/** Money moved into savings is saved, not spent. */
export const SAVED_CATEGORY = "Savings";

/** Costs that are hard to cut from one month to the next: housing, bills, school, health, tax, giving. */
export const FIXED = new Set(["Rent", "Utilities", "Education", "Health", "Tax deducted", "Tax payment", "Zakat", "Charity", "Transfers"]);

/**
 * How much of a flexible category's usual cost is a fair cut, as a share of it. Eating out and shopping
 * give the most room; groceries and transport much less. Anything not listed gets 10%.
 */
export const TRIM_RATE: Record<string, number> = {
  "Food & dining": 0.2,
  Shopping: 0.25,
  Entertainment: 0.25,
  "Cash withdrawal": 0.15,
  "Bank charges": 0.3,
  Groceries: 0.1,
  Transport: 0.1,
};
const trimRate = (c: string) => TRIM_RATE[c] ?? 0.1;

export type MonthTotals = {
  /** "YYYY-MM" */
  month: string;
  /** Income and remittances, own-account transfers left out. */
  income: number;
  /** Expenses by category, own-account transfers left out. */
  byCategory: Record<string, number>;
};

export type SavingsInput = {
  /** Karachi date, YYYY-MM-DD. */
  today: string;
  /** Whole earlier months the records fully cover, oldest first, at most six. */
  months: MonthTotals[];
  /** This month so far. */
  thisMonth: Omit<MonthTotals, "month">;
  /** Monthly payments still running this month. */
  recurring: { name: string; amount: number | null; category: string }[];
  /** Saving set-asides still running. */
  savingFunds: { id: string; name: string; percent_bp: number; applies_to: "remittance" | "income" | "incoming"; remaining: number }[];
  /** The owner's own monthly target; 0 means "use the suggestion". */
  target: number;
};

export type SavingsTipAction =
  | { kind: "transactions"; category?: string; label?: string }
  | { kind: "limit"; category: string; suggested: number }
  | { kind: "link"; href: string; label: string };

export type SavingsTip = {
  id: string;
  tone: "bad" | "warn" | "info";
  title: string;
  detail: string;
  /** Roughly how much a month this could save, when it can be put as a number. */
  monthly?: number;
  actions: SavingsTipAction[];
};

export type CategoryRow = { category: string; usual: number; last: number; fixed: boolean; trim: number };

export type SavingsPlan =
  | { ready: false; today: string }
  | {
      ready: true;
      today: string;
      monthsUsed: number;
      /** Usual month: income, spending (savings left out), and what was left over. */
      usual: { income: number; spend: number; saved: number; fixed: number; flexible: number };
      /** Income the plan is based on: the usual income, or halfway to the leanest month when income swings a lot. */
      planIncome: number;
      uneven: boolean;
      /** The realistic monthly amount, rounded down to a tidy figure. */
      suggested: number;
      /** 20% of usual income, a common rule of thumb, for comparison. */
      rule20: number;
      /** What the owner chose, or the suggestion. */
      target: number;
      targetIsOwn: boolean;
      history: { month: string; income: number; spend: number; saved: number }[];
      thisMonth: {
        day: number;
        days: number;
        income: number;
        spend: number;
        savedSoFar: number;
        /** What the month should end at if the usual income arrives and the rest of the month costs what it usually does. */
        projected: number;
        /** Spending room left this month that still meets the target; negative when it is already out of reach. */
        roomLeft: number;
      };
      categories: CategoryRow[];
      recurringTotal: number;
      /** Saved so far in saving set-asides. */
      saved: number;
      /** Three months of essential costs, a common emergency-fund goal. */
      emergencyGoal: number;
      tips: SavingsTip[];
    };

const rs = (p: number) => formatPaisa(Math.round(p)).replace(/\.\d\d$/, "");
const scaled = (paisa: number) => Math.max(100, Math.round(paisa * currencyInfo().scale));
/** Rounds down to a tidy figure (Rs 500 under Rs 20k, else Rs 1,000), so a suggestion never looks falsely exact. */
export function tidyDown(p: number) {
  if (p <= 0) return 0;
  const step = p < scaled(2_000_000) ? scaled(50_000) : scaled(100_000);
  return Math.floor(p / step) * step;
}
const monthName = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en", { month: "long", timeZone: "UTC" });
};
const spendOf = (by: Record<string, number>) => Object.entries(by).reduce((a, [c, v]) => (c === SAVED_CATEGORY ? a : a + v), 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Below these, a tip is noise: Rs 1,500 a month for one category, Rs 500 a month in fees. */
const TIP_MIN = () => scaled(150_000);
const FEES_MIN = () => scaled(50_000);
/** Income that swings more than this (as a share of the average) is planned more carefully. */
const UNEVEN_AT = 0.25;
/** Kept back from the plan for surprises: 5% of income. */
const CUSHION = 0.05;

export function buildSavingsPlan(i: SavingsInput): SavingsPlan {
  const n = i.months.length;
  if (n === 0) return { ready: false, today: i.today };

  const day = Number(i.today.slice(8, 10));
  const days = daysInMonth(i.today);
  const left = days - day;

  const history = i.months.map((m) => {
    const spend = spendOf(m.byCategory);
    return { month: m.month, income: m.income, spend, saved: m.income - spend };
  });
  const incomes = history.map((h) => h.income);
  const income = mean(incomes);
  const spend = mean(history.map((h) => h.spend));
  const sd = Math.sqrt(mean(incomes.map((x) => (x - income) ** 2)));
  const uneven = n >= 2 && income > 0 && sd / income > UNEVEN_AT;
  // Uneven income is planned halfway between the usual and the leanest month: careful, but not so careful the plan is useless.
  const planIncome = uneven ? (income + Math.min(...incomes)) / 2 : income;

  // Usual cost of each category, and how much of it could fairly be cut.
  const cats = new Set(i.months.flatMap((m) => Object.keys(m.byCategory)));
  cats.delete(SAVED_CATEGORY);
  const categories: CategoryRow[] = [...cats].map((c) => {
    const vals = i.months.map((m) => m.byCategory[c] ?? 0);
    const usual = mean(vals);
    const fixed = FIXED.has(c);
    // A realistic cut is one already managed in a past month, capped at the category's fair share.
    // With a single month there is nothing to compare with, so half the fair share.
    const cap = usual * trimRate(c);
    const trim = fixed ? 0 : n >= 2 ? Math.min(cap, Math.max(0, usual - Math.min(...vals))) : cap / 2;
    return { category: c, usual, last: vals[n - 1], fixed, trim };
  }).sort((a, b) => b.usual - a.usual);
  const fixedTotal = categories.filter((c) => c.fixed).reduce((a, c) => a + c.usual, 0);
  const trims = categories.reduce((a, c) => a + c.trim, 0);

  const suggested = tidyDown(planIncome - spend + trims - planIncome * CUSHION);
  const rule20 = tidyDown(income * 0.2);
  const target = i.target > 0 ? i.target : suggested;

  // This month.
  const tmIncome = i.thisMonth.income;
  const tmSpend = spendOf(i.thisMonth.byCategory);
  const expectIncome = Math.max(tmIncome, planIncome);
  // Fixed costs like rent land once a month, so only flexible spending is spread over the days left,
  // and the month is never assumed to cost less than a usual one.
  const projected = Math.round(expectIncome - Math.max(tmSpend + ((spend - fixedTotal) * left) / days, spend));
  const roomLeft = Math.round(expectIncome - target - tmSpend);

  const recurringTotal = i.recurring.reduce((a, r) => a + (r.amount ?? 0), 0);
  const saved = i.savingFunds.reduce((a, f) => a + Math.max(0, f.remaining), 0);
  const essentials = categories.filter((c) => c.fixed || c.category === "Groceries" || c.category === "Transport").reduce((a, c) => a + c.usual, 0);
  const emergencyGoal = tidyDown(essentials * 3);

  const tips: SavingsTip[] = [];

  // 1. Spending more than comes in.
  if (spend > income) {
    tips.push({
      id: "over",
      tone: "bad",
      title: "Spending is more than what comes in",
      detail: `A usual month brings in ${rs(income)} and costs ${rs(spend)}, ${rs(spend - income)} more. Start by bringing spending under income; the cuts below are the easiest places to find it.`,
      actions: [{ kind: "transactions", label: "See recent spending" }],
    });
  }

  // 2. Categories running above their usual level, last month or at this month's pace.
  const pace = day >= 7 ? days / day : 0;
  for (const c of categories.filter((c) => !c.fixed)) {
    const earlier = n >= 2 ? mean(i.months.slice(0, -1).map((m) => m.byCategory[c.category] ?? 0)) : 0;
    const now = (i.thisMonth.byCategory[c.category] ?? 0) * pace;
    const lastUp = n >= 2 && earlier > 0 && c.last > earlier * 1.2 && c.last - earlier >= TIP_MIN();
    const nowUp = pace > 0 && c.usual > 0 && now > c.usual * 1.2 && now - c.usual >= TIP_MIN();
    if (!lastUp && !nowUp) continue;
    const gap = nowUp ? now - c.usual : c.last - earlier;
    tips.push({
      id: `rising:${c.category}`,
      tone: "warn",
      title: `${c.category} is creeping up`,
      detail: nowUp
        ? `At this month's pace ${c.category.toLowerCase()} ends near ${rs(now)}, against a usual ${rs(c.usual)}. Bringing it back to usual keeps about ${rs(gap)} this month.`
        : `${monthName(i.months[n - 1].month)} cost ${rs(c.last)}, against about ${rs(earlier)} in the months before. Holding it at the old level saves about ${rs(gap)} a month.`,
      monthly: Math.round(gap),
      actions: [{ kind: "transactions", category: c.category }, { kind: "limit", category: c.category, suggested: tidyUp(nowUp ? c.usual : earlier) }],
    });
  }
  const rising = new Set(tips.filter((t) => t.id.startsWith("rising:")).map((t) => t.id.slice(7)));

  // 3. The flexible categories with the most room, measured against the owner's own best month.
  const cuts = categories
    .filter((c) => !c.fixed && !rising.has(c.category) && c.trim >= TIP_MIN() && c.category !== "Bank charges")
    .sort((a, b) => b.trim - a.trim)
    .slice(0, 3);
  for (const c of cuts) {
    const best = n >= 2 ? Math.min(...i.months.map((m) => m.byCategory[c.category] ?? 0)) : null;
    const aim = tidyUp(c.usual - c.trim);
    tips.push({
      id: `cut:${c.category}`,
      tone: "info",
      title: CUT_TITLE[c.category] ?? `Trim ${c.category.toLowerCase()}`,
      detail:
        `${c.category} usually costs ${rs(c.usual)} a month` +
        (best != null && best < c.usual ? `; your lightest month was ${rs(best)}.` : ".") +
        ` Aiming for about ${rs(aim)} saves around ${rs(c.trim)} a month.` +
        (CUT_HINT[c.category] ? ` ${CUT_HINT[c.category]}` : ""),
      monthly: Math.round(c.trim),
      actions: [{ kind: "transactions", category: c.category }, { kind: "limit", category: c.category, suggested: aim }],
    });
  }

  // 4. Monthly payments: each one dropped is saved every month.
  if (recurringTotal > 0) {
    const top = [...i.recurring].filter((r) => r.amount).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 3);
    const share = income > 0 ? Math.round((recurringTotal / income) * 100) : null;
    tips.push({
      id: "recurring",
      tone: "info",
      title: "Review your monthly payments",
      detail:
        `${i.recurring.length} monthly ${i.recurring.length === 1 ? "payment adds" : "payments add"} up to ${rs(recurringTotal)}` +
        (share != null ? `, ${share}% of a usual month's income` : "") +
        `. The biggest: ${top.map((r) => `${r.name} (${rs(r.amount!)})`).join(", ")}. Look for anything you no longer use or could get cheaper (internet, phone, gym, subscriptions); whatever you drop is saved every month.`,
      actions: [{ kind: "link", href: "/app/monthly", label: "Open monthly payments" }],
    });
  }

  // 5. Bank charges and tax on transfers.
  const fees = mean(i.months.map((m) => (m.byCategory["Bank charges"] ?? 0) + (m.byCategory["Tax deducted"] ?? 0)));
  if (fees >= FEES_MIN()) {
    tips.push({
      id: "fees",
      tone: "info",
      title: "Bank charges add up",
      detail: `Charges and tax taken on transfers come to about ${rs(fees)} a month. Fewer, larger transfers, and free options like Raast where you can, keep more of it.`,
      monthly: Math.round(fees * 0.5),
      actions: [{ kind: "transactions", category: "Bank charges" }],
    });
  }

  // 6. Pay yourself first: put the target aside as soon as money comes in.
  if (target > 0 && income > 0) {
    const want = Math.min(50, Math.max(1, Math.round((target / income) * 100)));
    const fund = [...i.savingFunds].sort((a, b) => b.percent_bp - a.percent_bp)[0];
    if (!fund) {
      tips.push({
        id: "pay-first",
        tone: "info",
        title: "Save first, then spend",
        detail: `Saving what's left at the end of the month rarely works. A saving set-aside of ${want}% puts about ${rs(target)} aside the moment money comes in, so you only spend the rest.`,
        actions: [{ kind: "link", href: "/app/set-asides", label: "Add a saving set-aside" }],
      });
    } else if (fund.percent_bp / 100 + 2 < want) {
      tips.push({
        id: "pay-first",
        tone: "info",
        title: `Raise ${fund.name} to ${want}%`,
        detail: `${fund.name} keeps ${(fund.percent_bp / 100).toLocaleString("en", { maximumFractionDigits: 2 })}% of what comes in, about ${rs((income * fund.percent_bp) / 10000)} a month. ${want}% would cover the ${rs(target)} target.`,
        actions: [{ kind: "link", href: "/app/set-asides", label: "Open set-asides" }],
      });
    }
  }

  // 7. Income that changes a lot from month to month.
  if (uneven) {
    tips.push({
      id: "uneven",
      tone: "info",
      title: "Save extra in good months",
      detail: `Income has ranged from ${rs(Math.min(...incomes))} to ${rs(Math.max(...incomes))} a month, so the suggestion assumes about ${rs(planIncome)} comes in. When a month brings in more, save the extra instead of spending it; it carries you through the lean ones.`,
      actions: [],
    });
  }

  // 8. A cushion for emergencies.
  if (emergencyGoal > 0 && target > 0 && saved < emergencyGoal) {
    const months = Math.ceil((emergencyGoal - saved) / target);
    tips.push({
      id: "emergency",
      tone: "info",
      title: "Build an emergency fund first",
      detail: `Three months of essentials (rent, bills, groceries, transport and the like) is about ${rs(emergencyGoal)}.` +
        (saved > 0 ? ` ${rs(saved)} is already set aside.` : "") +
        ` At ${rs(target)} a month that takes about ${months} ${months === 1 ? "month" : "months"}, and it keeps a surprise bill from undoing your savings.`,
      actions: [],
    });
  }

  const order = { bad: 0, warn: 1, info: 2 } as const;
  tips.sort((a, b) => order[a.tone] - order[b.tone] || (b.monthly ?? 0) - (a.monthly ?? 0));

  return {
    ready: true,
    today: i.today,
    monthsUsed: n,
    usual: { income: Math.round(income), spend: Math.round(spend), saved: Math.round(income - spend), fixed: Math.round(fixedTotal), flexible: Math.round(spend - fixedTotal) },
    planIncome: Math.round(planIncome),
    uneven,
    suggested,
    rule20,
    target,
    targetIsOwn: i.target > 0,
    history,
    thisMonth: { day, days, income: tmIncome, spend: tmSpend, savedSoFar: tmIncome - tmSpend, projected, roomLeft },
    categories,
    recurringTotal,
    saved,
    emergencyGoal,
    tips,
  };
}

/** Rounds up to a tidy figure, for a suggested spending limit. */
function tidyUp(p: number) {
  const step = p < scaled(2_000_000) ? scaled(50_000) : scaled(100_000);
  return Math.max(step, Math.ceil(p / step) * step);
}

const CUT_TITLE: Record<string, string> = {
  "Food & dining": "Eat out a little less",
  Shopping: "Pause before you shop",
  Entertainment: "Trim entertainment",
  "Cash withdrawal": "Keep an eye on cash",
  Groceries: "Shop groceries with a list",
  Transport: "Plan trips to cut transport",
};
const CUT_HINT: Record<string, string> = {
  "Food & dining": "Cooking at home a couple more times a week usually does it.",
  Shopping: "Waiting a day before buying anything non-essential cuts most impulse buys.",
  Entertainment: "Check for subscriptions you rarely use.",
  "Cash withdrawal": "Cash is hard to track; a fixed weekly amount makes it easier to keep to.",
  Groceries: "Buying staples in bulk and sticking to a list helps.",
  Transport: "Combining errands into one trip helps.",
};
