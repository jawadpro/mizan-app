// The WhatsApp assistant's free "command mode": short messages Mizan understands without any AI, turned into the
// same actions the AI uses. Pure, so tests can use it. Dates are Karachi calendar days (YYYY-MM-DD).
import { addDays } from "./time";

export type Range = { from: string; to: string; label: string };

export type Intent =
  | { tool: "help" }
  | { tool: "how_am_i_doing" }
  | { tool: "balances" }
  | { tool: "spending_summary"; from: string; to: string; label: string; category?: string; query?: string }
  | { tool: "cash_flow"; from: string; to: string; label: string }
  | { tool: "money_in"; from: string; to: string; label: string; kind?: "income" | "remittance" }
  | { tool: "find_transactions"; query?: string; from?: string; to?: string; limit: number }
  | { tool: "list_splits"; person?: string }
  | { tool: "create_split"; total: number; people: string[]; include_me: boolean; description: string }
  | { tool: "settle_split"; person: string; note?: string }
  | { tool: "add_expense"; amount: number; description: string; category: string }
  | { tool: "invoices"; limit: number; query?: string; from?: string; to?: string }
  | { tool: "unknown" };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_LONG = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

/** Finds a period in a message ("this month", "last week", "october", "last 30 days") and the text left without it. */
export function findRange(text: string, today: string): { range: Range | null; rest: string } {
  const t = ` ${text.toLowerCase()} `;
  const [y, m] = today.split("-").map(Number);
  const tries: [RegExp, () => Range][] = [
    [/\b(today|aaj)\b/, () => ({ from: today, to: today, label: "today" })],
    [/\b(yesterday|kal)\b/, () => ({ from: addDays(today, -1), to: addDays(today, -1), label: "yesterday" })],
    [/\b(?:last|past|pichl[ae])\s+(\d{1,3})\s+days?\b/, () => {
      const n = Math.min(366, Math.max(1, Number(/(\d{1,3})\s+days?/.exec(t)![1])));
      return { from: addDays(today, -(n - 1)), to: today, label: `the last ${n} days` };
    }],
    [/\bthis\s+week\b/, () => {
      const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday first
      return { from: addDays(today, -dow), to: today, label: "this week" };
    }],
    [/\b(last|previous|pichle)\s+week\b/, () => {
      const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
      const end = addDays(today, -dow - 1);
      return { from: addDays(end, -6), to: end, label: "last week" };
    }],
    [/\b(last|previous|pichle)\s+month\b/, () => {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: monthEnd(py, pm), label: "last month" };
    }],
    [/\b(this|current|is)\s+month\b|\bmonth\s+so\s+far\b|\bmtd\b/, () => ({ from: `${today.slice(0, 8)}01`, to: today, label: "this month" })],
    [/\b(last|previous)\s+year\b/, () => ({ from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` })],
    [/\b(this|current)\s+year\b|\bytd\b/, () => ({ from: `${y}-01-01`, to: today, label: "this year" })],
  ];
  for (const [re, make] of tries) {
    if (re.test(t)) return { range: make(), rest: clean(t.replace(re, " ")) };
  }
  // A month by name, with an optional year ("october", "oct 2025"). A month after this one means last year's.
  const mm = new RegExp(`\\b(?:in\\s+)?(${MONTH_LONG.join("|")}|${MONTHS.join("|")})(?:\\s+(\\d{4}))?\\b`).exec(t);
  if (mm) {
    const idx = (MONTH_LONG.indexOf(mm[1]) + 1 || MONTHS.indexOf(mm[1]) + 1);
    const yy = mm[2] ? Number(mm[2]) : idx > m ? y - 1 : y;
    const end = monthEnd(yy, idx);
    const label = `${MONTH_LONG[idx - 1][0].toUpperCase()}${MONTH_LONG[idx - 1].slice(1)}${yy !== y ? ` ${yy}` : ""}`;
    return { range: { from: `${yy}-${pad(idx)}-01`, to: end > today ? today : end, label }, rest: clean(t.replace(mm[0], " ")) };
  }
  return { range: null, rest: clean(t) };
}

const clean = (s: string) => s.replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();

/** Words people use for Mizan's categories. The first category in each list that exists wins. */
const CATEGORY_WORDS: [RegExp, string][] = [
  [/^(food|dining|eating out|restaurants?|khana|lunch|dinner|breakfast|takeaway|food ?panda|chai|tea|coffee|pizza|burgers?|biryani|kfc|mcdonalds|cafe)$/, "Food & dining"],
  [/^(grocery|groceries|sabzi|kiryana|ration|imtiaz|carrefour|naheed)$/, "Groceries"],
  [/^(transport|travel|fuel|petrol|uber|careem|indrive|ride|rides|taxi|car)$/, "Transport"],
  [/^(bills?|utilit(y|ies)|electricity|gas|water|internet|k-?electric|ptcl|mobile)$/, "Utilities"],
  [/^(rent|house rent)$/, "Rent"],
  [/^(shopping|clothes|daraz|amazon)$/, "Shopping"],
  [/^(health|medical|medicine|doctor|pharmacy|hospital)$/, "Health"],
  [/^(education|school|fees?|tuition|books?)$/, "Education"],
  [/^(entertainment|movies?|netflix|fun|games?)$/, "Entertainment"],
  [/^(charity|sadqa|sadaqah|donations?|khairat)$/, "Charity"],
  [/^(zakat)$/, "Zakat"],
  [/^(savings?)$/, "Savings"],
  [/^(cash|atm|cash withdrawals?)$/, "Cash withdrawal"],
  [/^(bank charges|charges|fees and charges)$/, "Bank charges"],
  [/^(tax|taxes)$/, "Tax payment"],
];

/** Matches a word ("food", "petrol", "Groceries") to one of the categories in use, or null. */
export function matchCategory(word: string, categories: string[]): string | null {
  const w = word.trim().toLowerCase();
  if (!w) return null;
  const exact = categories.find((c) => c.toLowerCase() === w);
  if (exact) return exact;
  for (const [re, cat] of CATEGORY_WORDS) {
    if (re.test(w)) return categories.find((c) => c.toLowerCase() === cat.toLowerCase()) ?? cat;
  }
  const starts = categories.filter((c) => c.toLowerCase().startsWith(w) && w.length >= 3);
  return starts.length === 1 ? starts[0] : null;
}

/** A category for a new expense from what it was for ("dinner at kolachi" → Food & dining). */
export function guessCategory(description: string, categories: string[]): string {
  for (const word of description.toLowerCase().split(/[^a-z-]+/)) {
    const c = matchCategory(word, categories);
    if (c) return c;
  }
  return "Uncategorized";
}

/** "3000", "3,000", "3k", "1.5k", "Rs 3000", "2 lakh" → whole currency units, or null. */
export function parseAmount(s: string): number | null {
  const m = /^(?:rs\.?|pkr|\$)?\s*(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d{1,2})?)\s*(k|thousand|hazar|lakh|lac|l)?$/i.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  const mult = !m[2] ? 1 : /^(k|thousand|hazar)$/i.test(m[2]) ? 1000 : 100000;
  const v = Math.round(n * mult * 100) / 100;
  return v > 0 && v < 1e11 ? v : null;
}

const AMOUNT = String.raw`((?:rs\.?|pkr)?\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:k|thousand|hazar|lakh|lac)?)`;

/** "Ali, Sara and Bilal" / "ali & sara" → ["Ali", "Sara", "Bilal"]. */
export function splitNames(s: string): string[] {
  return s
    .split(/\s*(?:,|&|\band\b|\baur\b|\+)\s*/i)
    .map((n) => n.replace(/^(?:with|mr|ms)\s+/i, "").trim())
    .filter((n) => n && !/^(me|myself|i)$/i.test(n))
    .slice(0, 20);
}

/** Turns a short message into an action. Anything it doesn't recognise is "unknown" (the AI, when set up, takes those). */
export function parseCommand(raw: string, today: string): Intent {
  const text = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  const t = text.toLowerCase().replace(/[?!.]+$/g, "").trim();
  if (!t) return { tool: "unknown" };

  if (/^(hi|hello|hey|salam|salaam|assalam.*|aoa|help|menu|commands|start|\?)$/.test(t)) return { tool: "help" };
  if (/\b(how am i (doing|performing)|how('?m| am) i doing|performance|how'?s my (month|spending)|status|report|spending check|kaisa ja raha)\b/.test(t)) {
    return { tool: "how_am_i_doing" };
  }
  if (/^(my\s+)?(bank\s+)?balances?(\s+please)?$|\bhow much (money )?(do i have|is left|left)\b/.test(t)) return { tool: "balances" };

  // invoice for the last payment | invoice kolachi | invoices this month | invoices for the last 3 payments
  let m: RegExpExecArray | null = /^(?:(?:please\s+)?(?:send|make|generate|create|share|give)\s+(?:me\s+)?)?(?:an?\s+|the\s+|my\s+)?(invoices?|receipts?|rasee?d)\b\s*(.*)$/.exec(t);
  if (m) {
    let rest = m[2];
    const n = /\b(?:last|latest|recent)\s+(\d{1,2})\b(?!\s*(?:days?|weeks?|months?))/.exec(rest);
    const all = /\b(all|every)\b/.test(rest);
    if (n) rest = rest.replace(n[0], " ");
    const { range, rest: left } = findRange(rest, today);
    const query = left
      .replace(/\b(for|of|to|from|at|on|with|the|my|me|a|an|all|every|last|latest|recent|payments?|transactions?|expenses?|ones?|please|plz|send|it|them)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const plural = /s$/.test(m[1]) || all;
    const limit = Math.min(10, n ? Number(n[1]) : plural ? 10 : 1);
    return { tool: "invoices", limit: Math.max(1, limit), query: query.slice(0, 60) || undefined, from: range?.from, to: range?.to };
  }

  // split 3000 dinner with ali and sara  |  split 3k with ali, sara for dinner  |  split 3000 with ali (not me)
  m = new RegExp(String.raw`^split\s+${AMOUNT}\s+(?:(?:for|on)\s+)?(.*?)\s*\bwith\b\s+(.+)$`, "i").exec(text);
  if (m) {
    const total = parseAmount(m[1]);
    let names = m[3];
    let description = m[2].trim();
    const forPart = /\s+(?:for|on)\s+(.+)$/i.exec(names);
    if (forPart && !description) {
      description = forPart[1];
      names = names.slice(0, forPart.index);
    }
    const notMe = /\b(not me|without me|excluding me|i paid for them|for them only)\b/i.test(names);
    names = names.replace(/\(?\b(not me|without me|excluding me|i paid for them|for them only)\b\)?/gi, " ");
    const people = splitNames(names);
    if (total && people.length) return { tool: "create_split", total, people, include_me: !notMe, description };
  }

  // ali paid | ali paid me back | ali paid cash | settle ali | mark ali paid
  m = /^(?:settle|mark)\s+(.+?)(?:\s+(?:as\s+)?paid)?$/i.exec(text) ?? /^(.+?)\s+(?:paid(?:\s+me)?(?:\s+back)?|has paid|returned|gave back|ne de diye)(?:\s+(in\s+)?(cash))?$/i.exec(text);
  if (m && m[1].split(" ").length <= 3 && !/^(i|who|what|how)$/i.test(m[1])) {
    return { tool: "settle_split", person: m[1].trim(), note: m[3] ? "Paid in cash" : undefined };
  }

  // who owes me | splits | dues | what does ali owe | how much does ali owe
  m = /^(?:what|how much)\s+does\s+(.+?)\s+owe(?:\s+me)?$/i.exec(t) ?? /^(.+?)\s+owes?(?:\s+me)?$/i.exec(t);
  if (m && !/^(who|everyone|people|they)$/.test(m[1])) return { tool: "list_splits", person: m[1] };
  if (/\b(who owes|owed|owe me|splits?|dues|udhaar|udhar|lena hai)\b/.test(t)) return { tool: "list_splits" };

  // spent 500 on lunch | add 1200 petrol | paid 2500 for groceries
  m = new RegExp(String.raw`^(?:spent|add|paid|expense)\s+${AMOUNT}\s+(?:(?:on|for|at)\s+)?(.+)$`, "i").exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    if (amount) return { tool: "add_expense", amount, description: m[2].trim(), category: "" };
  }

  // last 5 payments | recent transactions | payments to daraz | find careem
  m = /^(?:last|recent|latest)\s*(\d{1,2})?\s*(payments?|transactions?|expenses?|spends?)?$/.exec(t);
  if (m && (m[1] || m[2])) return { tool: "find_transactions", limit: Math.min(20, Number(m[1] ?? 5)) };
  m = /^(?:find|search|show)\s+(.+)$/.exec(t) ?? /^(?:payments?|transactions?)\s+(?:to|from|at|for)\s+(.+)$/.exec(t);
  if (m) {
    const { range, rest } = findRange(m[1], today);
    return { tool: "find_transactions", query: rest || undefined, from: range?.from, to: range?.to, limit: 10 };
  }

  // net flow this month | cash flow last month | how much did I save in october
  const thisMonth = { from: `${today.slice(0, 8)}01`, to: today, label: "this month" };
  if (/\b(net ?flow|cash ?flow|net|in and out|how much (did i|have i) (save|saved)|savings? rate|bachat)\b/.test(t)) {
    return { tool: "cash_flow", ...(findRange(t, today).range ?? thisMonth) };
  }
  // remittance this month | how much remittance came in | salary last month | income in october
  if (/\b(remittances?|remitted|bhej[ae]? gaye)\b/.test(t)) return { tool: "money_in", kind: "remittance", ...(findRange(t, today).range ?? thisMonth) };
  if (/\b(income|salary|earnings?|earned|aamdani|tankhwah)\b/.test(t)) return { tool: "money_in", kind: "income", ...(findRange(t, today).range ?? thisMonth) };
  if (/\b(money in|came in|received|got paid)\b/.test(t)) return { tool: "money_in", ...(findRange(t, today).range ?? thisMonth) };

  // spending this month | food this month | how much did i spend on petrol last month | daraz in october | summary
  const { range, rest } = findRange(t, today);
  let subject = rest
    .replace(/\b(how much|did i|have i|i|my|total|spend(ing)?|spent|kharch[ae]?|expenses?|on|at|for|in|the|so far|please|show|tell me|what('?s| is| was)|summary|overview|kitna)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (range || /\b(spend|spent|spending|summary|overview|expenses?|kharch)\b/.test(t)) {
    const r = range ?? { from: `${today.slice(0, 8)}01`, to: today, label: "this month" };
    if (!subject) return { tool: "spending_summary", ...r };
    subject = subject.slice(0, 60);
    return { tool: "spending_summary", ...r, category: subject };
  }
  return { tool: "unknown" };
}

export const HELP_TEXT = [
  "Here's what you can ask me:",
  "",
  "📊 *Spending*",
  "• summary · spending last month",
  "• food this month · petrol in october",
  "• last 5 payments · find daraz",
  "",
  "📈 *How you're doing*",
  "• how am I doing · balance",
  "• net flow this month · remittance this month · salary last month",
  "",
  "🤝 *Splits*",
  "• split 3000 dinner with Ali and Sara",
  "• split 5000 with Ali (not me)",
  "• who owes me · Ali paid",
  "",
  "➕ *Add*",
  "• spent 500 on lunch",
  "",
  "🧾 *Invoices*",
  "• invoice for the last payment · invoice kolachi",
  "• invoices this month · invoices for the last 3 payments",
].join("\n");
