import "server-only";
import { q } from "./db";
import { CATEGORIES, OWN_ACCOUNTS } from "./categories";
import { buildInsights } from "./insights";
import { formatPaisa } from "./money";
import { analytics, createTransaction, distinctCategories, getBalances, getPrefs, invoiceTransactions, listBanks, listSetAsides, listTransactions, spendingCheckData } from "./repo";
import { canShareInvoice, invoiceRef, invoiceTitle, type InvoiceTx } from "./invoice-data";
import { addShares, listSplits, settleShare, splitPeople } from "./splits-repo";
import { equalShares } from "./splits";
import { addDays, formatDatePkt, isIsoDate, pktLocalToDate, todayPkt } from "./time";
import { guessCategory, matchCategory } from "./assistant-commands";
import { matchPerson } from "./whatsapp";

// What the WhatsApp assistant can look up and do. Each action returns short WhatsApp-ready text, which command mode
// sends as it is and the AI reads before answering. Changes (a split, an expense, settling a share) are never made
// here: they come back as a proposal that the owner confirms with YES (see runConfirmed).

const rs = (p: number) => formatPaisa(Math.round(p)).replace(/\.00$/, "");
const day = (d: string | Date) => formatDatePkt(d);
const paisa = (units: number) => Math.round(units * 100);

export type Proposal =
  | { type: "split"; billId: string | null; newBill: { amount: number; category: string; note: string; occurredAt: string } | null; shares: { person: string; amount: number }[]; note: string | null }
  | { type: "expense"; amount: number; category: string; counterparty: string | null; note: string | null; occurredAt: string }
  | { type: "settle"; shareIds: string[]; note: string | null };

/** invoices: transactions whose invoice pictures are sent after the reply. */
export type ToolOutput = { text: string; proposal?: { action: Proposal; summary: string }; invoices?: InvoiceTx[] };

async function categoriesInUse(): Promise<string[]> {
  const used = await distinctCategories("app");
  return [...new Set([...CATEGORIES.expense, ...used])].filter((c) => c !== OWN_ACCOUNTS);
}

function rangeOk(from?: string, to?: string) {
  const today = todayPkt();
  const f = isIsoDate(from) ? from : `${today.slice(0, 8)}01`;
  let t = isIsoDate(to) ? to : today;
  if (t < f) t = f;
  return { from: f, to: t };
}

export async function spendingSummary(i: { from?: string; to?: string; label?: string; category?: string; query?: string }): Promise<ToolOutput> {
  const { from, to } = rangeOk(i.from, i.to);
  const label = i.label ?? (from === to ? day(from) : `${day(from)} to ${day(to)}`);
  const subject = (i.category ?? "").trim();
  const cats = subject ? await categoriesInUse() : [];
  const category = subject ? matchCategory(subject, cats) : null;
  const query = !category ? (i.query ?? subject).trim() || null : null;
  if (category || query) {
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400e3) + 1;
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(from, -days);
    const f = { kind: "expense" as const, category: category ?? undefined, q: query ?? undefined, page: 1, pageSize: 5 };
    const [now, prev] = await Promise.all([
      listTransactions("app", { ...f, from, to }),
      listTransactions("app", { ...f, from: prevFrom, to: prevTo, pageSize: 1 }),
    ]);
    const what = category ?? `"${query}"`;
    if (!now.total) return { text: `No ${what} spending ${label}.` };
    const lines = [`*${what}* ${label}: *${rs(now.sums.expense)}* across ${now.total} payment${now.total === 1 ? "" : "s"}.`];
    if (prev.sums.expense > 0) {
      const d = Math.round(((now.sums.expense - prev.sums.expense) / prev.sums.expense) * 100);
      lines.push(`The ${days} days before: ${rs(prev.sums.expense)} (${d >= 0 ? "+" : ""}${d}%).`);
    }
    lines.push("", "Latest:");
    for (const t of now.items) lines.push(`• ${day(t.occurred_at)} · ${rs(t.amount_paisa)} · ${t.counterparty ?? t.note ?? t.category}`);
    return { text: lines.join("\n") };
  }
  const a = await analytics("app", from, to, "month");
  const ex = a.totals.expense.total;
  const inc = a.totals.income.total + a.totals.remittance.total;
  const lines = [`*Spending ${label}*`, `Spent: *${rs(ex)}* (${a.totals.expense.n} payments)`, `Income: ${rs(a.totals.income.total)}${a.totals.remittance.total ? ` · Remittances: ${rs(a.totals.remittance.total)}` : ""}`, `Net flow: ${rs(a.net)}`];
  void inc;
  const pex = a.previous.totals.expense.total;
  if (pex > 0) {
    const d = Math.round(((ex - pex) / pex) * 100);
    lines.push(`Same length before: ${rs(pex)} spent (${d >= 0 ? "+" : ""}${d}%)`);
  }
  if (a.categories.length) {
    lines.push("", "Top categories:");
    for (const c of a.categories.slice(0, 6)) lines.push(`• ${c.category}: ${rs(c.total)}`);
  }
  if (a.topRecipients.length) {
    lines.push("", "Top places:");
    for (const r of a.topRecipients.slice(0, 4)) lines.push(`• ${r.counterparty}: ${rs(r.total)}`);
  }
  if (a.pendingReview) lines.push("", `${a.pendingReview} bank message${a.pendingReview === 1 ? "" : "s"} still waiting in Review, not counted yet.`);
  return { text: lines.join("\n") };
}

const signed = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${rs(Math.abs(p))}`;

/** Money in and out for a period, and what was left: income + remittances − spending (transfers between own accounts left out). */
export async function cashFlow(i: { from?: string; to?: string; label?: string }): Promise<ToolOutput> {
  const { from, to } = rangeOk(i.from, i.to);
  const label = i.label ?? (from === to ? day(from) : `${day(from)} to ${day(to)}`);
  const a = await analytics("app", from, to, "month");
  const income = a.totals.income.total;
  const rem = a.totals.remittance.total;
  const ex = a.totals.expense.total;
  const lines = [`*Net flow ${label}: ${signed(a.net)}*`, `Income: ${rs(income)}`, `Remittances: ${rs(rem)}`, `Spent: ${rs(ex)}`];
  const inn = income + rem;
  if (inn > 0) lines.push(a.net >= 0 ? `You kept ${Math.round((a.net / inn) * 100)}% of what came in.` : `You spent ${rs(-a.net)} more than came in.`);
  const p = a.previous;
  if (p.totals.income.total + p.totals.remittance.total + p.totals.expense.total > 0) lines.push(`Same length before: ${signed(p.net)}`);
  if (a.pendingReview) lines.push(`${a.pendingReview} bank message${a.pendingReview === 1 ? "" : "s"} still waiting in Review, not counted yet.`);
  return { text: lines.join("\n") };
}

/** Money that came in for a period: income, remittances or both, with where it came from. */
export async function moneyIn(i: { from?: string; to?: string; label?: string; kind?: "income" | "remittance" }): Promise<ToolOutput> {
  const { from, to } = rangeOk(i.from, i.to);
  const label = i.label ?? (from === to ? day(from) : `${day(from)} to ${day(to)}`);
  const kinds = i.kind ? [i.kind] : (["income", "remittance"] as const);
  const what = i.kind === "remittance" ? "Remittances" : i.kind === "income" ? "Income" : "Money in";
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400e3) + 1;
  const [now, prev, top] = await Promise.all([
    Promise.all(kinds.map((kind) => listTransactions("app", { kind, from, to, page: 1, pageSize: 5 }))),
    Promise.all(kinds.map((kind) => listTransactions("app", { kind, from: addDays(from, -days), to: addDays(from, -1), page: 1, pageSize: 1 }))),
    q<{ who: string; total: number; n: number }>(
      `SELECT coalesce(min(counterparty), 'Unknown') AS who, sum(amount_paisa)::float8 AS total, count(*)::int AS n FROM app.transactions
       WHERE kind = ANY($3::text[]) AND category <> $4
         AND occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Karachi') AND occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Karachi')
       GROUP BY lower(counterparty) ORDER BY total DESC LIMIT 5`,
      [from, to, kinds, OWN_ACCOUNTS],
    ),
  ]);
  const total = now.reduce((a, r) => a + r.sums.income + r.sums.remittance, 0);
  const n = now.reduce((a, r) => a + r.total, 0);
  const before = prev.reduce((a, r) => a + r.sums.income + r.sums.remittance, 0);
  if (!n) return { text: `No ${what.toLowerCase()} ${label}.` };
  const lines = [`*${what} ${label}: ${rs(total)}* (${n} payment${n === 1 ? "" : "s"})`];
  if (before > 0) {
    const d = Math.round(((total - before) / before) * 100);
    lines.push(`The ${days} days before: ${rs(before)} (${d >= 0 ? "+" : ""}${d}%).`);
  }
  if (top.rows.length > 1) {
    lines.push("", "From:");
    for (const r of top.rows) lines.push(`• ${r.who}: ${rs(r.total)}${r.n > 1 ? ` (${r.n})` : ""}`);
  }
  const latest = now.flatMap((r) => r.items).sort((x, y) => Date.parse(y.occurred_at) - Date.parse(x.occurred_at)).slice(0, 5);
  lines.push("", "Latest:");
  for (const t of latest) lines.push(`• ${day(t.occurred_at)} · ${rs(t.amount_paisa)} · ${t.counterparty ?? t.note ?? t.category}`);
  return { text: lines.join("\n") };
}

export async function howAmIDoing(): Promise<ToolOutput> {
  const today = todayPkt();
  const [data, balances, funds, prefs] = await Promise.all([spendingCheckData(today), getBalances(), listSetAsides(), getPrefs()]);
  const setAside = funds.reduce((a, f) => a + Math.max(0, f.remaining), 0);
  const overspentFunds = funds.filter((f) => f.purpose === "saving" && !f.ended_on && f.remaining < 0).map((f) => ({ id: f.id, name: f.name, over: -f.remaining }));
  const free = balances.total ? balances.total.balance - setAside : null;
  const ins = buildInsights({ today, ...data, freeToSpend: free, overspentFunds, warnAt: prefs.limitWarnPercent / 100 });
  const month = await analytics("app", ins.month.from, today, "month");
  const income = month.totals.income.total + month.totals.remittance.total;
  const lines = [`*This month so far* (day ${ins.month.day} of ${ins.month.days})`, `Spent: *${rs(ins.spent)}*`];
  if (ins.usualSoFar !== null) {
    const d = ins.usualSoFar > 0 ? Math.round(((ins.spent - ins.usualSoFar) / ins.usualSoFar) * 100) : 0;
    lines.push(`Usual by today: ${rs(ins.usualSoFar)} (${d > 0 ? `${d}% more` : d < 0 ? `${-d}% less` : "same"})`);
  }
  if (income > 0) {
    const saved = income - month.totals.expense.total;
    lines.push(`Came in: ${rs(income)} · ${saved >= 0 ? `kept ${rs(saved)} (${Math.round((saved / income) * 100)}%)` : `spent ${rs(-saved)} more than came in`}`);
  }
  if (balances.total) lines.push(`Balance: ${rs(balances.total.balance)}${setAside > 0 ? ` (${rs(free ?? 0)} free after set-asides)` : ""}`);
  if (ins.limits.length) {
    lines.push("", "Limits:");
    for (const l of ins.limits.slice(0, 6)) {
      const pct = Math.round((l.spent / l.limit) * 100);
      lines.push(`• ${l.category}: ${rs(l.spent)} of ${rs(l.limit)} (${pct}%)${pct >= 100 ? " ⚠️" : ""}`);
    }
  }
  if (ins.tips.length) {
    lines.push("", "Worth a look:");
    for (const t of ins.tips.slice(0, 4)) lines.push(`${t.tone === "bad" ? "🔴" : "🟡"} *${t.title}*. ${t.detail}`);
  } else lines.push("", "✅ Nothing off track this month.");
  return { text: lines.join("\n") };
}

export async function balances(): Promise<ToolOutput> {
  const [b, banks] = await Promise.all([getBalances(), listBanks()]);
  if (!b.total) return { text: "No balance set yet. Set it once on the Overview page in Mizan, and it keeps itself up to date from then on." };
  const name = new Map(banks.map((x) => [x.id, x.name]));
  const lines = [`*Balance: ${rs(b.total.balance)}*`];
  if (b.accounts.length > 1) for (const a of b.accounts) lines.push(`• ${name.get(a.bank_id) ?? "Bank"}: ${rs(a.balance)}`);
  return { text: lines.join("\n") };
}

export async function findTransactions(i: { query?: string; category?: string; kind?: "expense" | "income" | "remittance"; from?: string; to?: string; limit?: number }): Promise<ToolOutput> {
  const limit = Math.min(20, Math.max(1, Math.round(i.limit ?? 10)));
  let category: string | undefined;
  let query = i.query?.trim() || undefined;
  if (i.category) category = matchCategory(i.category, await categoriesInUse()) ?? undefined;
  if (query && !category) {
    const c = matchCategory(query, await categoriesInUse());
    if (c) {
      category = c;
      query = undefined;
    }
  }
  const r = await listTransactions("app", {
    q: query?.slice(0, 100), category, kind: i.kind,
    from: isIsoDate(i.from) ? i.from : undefined, to: isIsoDate(i.to) ? i.to : undefined, page: 1, pageSize: limit,
  });
  if (!r.items.length) return { text: "No payments found." };
  const lines = r.items.map((t) => {
    const sign = t.kind === "expense" ? "" : "+";
    const split = t.split ? ` · split with ${t.split.n}` : "";
    return `• ${day(t.occurred_at)} · ${sign}${rs(t.amount_paisa)} · ${t.counterparty ?? t.note ?? t.category} (${t.category})${split} [id ${t.id}]`;
  });
  if (r.total > r.items.length) lines.push(`…and ${r.total - r.items.length} more.`);
  return { text: lines.join("\n") };
}

export const MAX_INVOICES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Invoice pictures for the transactions asked for: by id, or the latest ones matching a search. Never for bank charges or tax. */
export async function invoices(i: { ids?: string[]; query?: string; category?: string; kind?: "expense" | "income" | "remittance"; from?: string; to?: string; limit?: number }): Promise<ToolOutput> {
  const limit = Math.min(MAX_INVOICES, Math.max(1, Math.round(i.limit ?? (i.ids?.length || 1))));
  let ids = (i.ids ?? []).filter((x) => UUID.test(x));
  if (!ids.length) {
    let category: string | undefined;
    let query = i.query?.trim() || undefined;
    const cats = i.category || query ? await categoriesInUse() : [];
    if (i.category) category = matchCategory(i.category, cats) ?? undefined;
    if (query && !category) {
      const c = matchCategory(query, cats);
      if (c) [category, query] = [c, undefined];
    }
    // A few extra, since bank charge and tax rows are skipped.
    const r = await listTransactions("app", {
      q: query?.slice(0, 100), category, kind: i.kind,
      from: isIsoDate(i.from) ? i.from : undefined, to: isIsoDate(i.to) ? i.to : undefined, page: 1, pageSize: limit + 10,
    });
    ids = r.items.filter((t) => canShareInvoice(t) && t.category !== OWN_ACCOUNTS).slice(0, limit).map((t) => t.id);
  }
  const rows = (await invoiceTransactions(ids.slice(0, MAX_INVOICES))).filter(canShareInvoice);
  if (!rows.length) {
    return { text: i.ids?.length ? "Those can't get an invoice (bank charges and tax don't have their own)." : "No payments found for an invoice." };
  }
  const lines = [`${rows.length === 1 ? "This invoice picture is" : `These ${rows.length} invoice pictures are`} sent right after your reply, so don't list them again:`];
  for (const t of rows) lines.push(`• ${invoiceRef(t.id)} · ${day(t.occurred_at)} · ${t.kind === "expense" ? "" : "+"}${rs(t.amount_paisa)} · ${invoiceTitle(t)} [id ${t.id}]`);
  return { text: lines.join("\n"), invoices: rows };
}

export async function splitsOwed(i: { person?: string }): Promise<ToolOutput> {
  const s = await listSplits();
  let open = s.open;
  if (i.person) {
    const m = matchPerson(i.person, [...new Set(open.map((x) => x.person))]);
    if (m.kind === "ambiguous") return { text: `Which one: ${m.options.join(", ")}?` };
    if (m.kind === "new") return { text: `${m.name} doesn't owe you anything right now.` };
    open = open.filter((x) => x.person.toLowerCase() === m.name.toLowerCase());
  }
  if (!open.length) return { text: "Nobody owes you anything right now. 🎉" };
  const by = new Map<string, { owed: number; items: typeof open }>();
  for (const x of open) {
    const k = x.person;
    const e = by.get(k) ?? { owed: 0, items: [] };
    e.owed += x.amount_paisa - Math.min(x.paid, x.amount_paisa);
    e.items.push(x);
    by.set(k, e);
  }
  const total = [...by.values()].reduce((a, e) => a + e.owed, 0);
  const lines = [i.person ? `*${[...by.keys()][0]} owes you ${rs(total)}*` : `*You're owed ${rs(total)}*`];
  for (const [person, e] of [...by.entries()].sort((a, b) => b[1].owed - a[1].owed)) {
    if (!i.person) lines.push(`• ${person}: ${rs(e.owed)}`);
    for (const x of e.items.slice(0, i.person ? 10 : 3)) {
      const what = x.note ?? x.bill.counterparty ?? x.bill.category;
      const part = x.paid > 0 ? `, ${rs(x.paid)} paid back` : "";
      const hint = x.suggestion ? ` (looks paid: ${rs(x.suggestion.amount_paisa)} came in ${day(x.suggestion.occurred_at)})` : "";
      lines.push(`   ${i.person ? "•" : "-"} ${rs(x.amount_paisa)} for ${what}, ${day(x.bill.occurred_at)}${part}${hint} [share ${x.id}]`);
    }
  }
  return { text: lines.join("\n") };
}

// ---- Changes: each returns a proposal to confirm ----

async function people(): Promise<string[]> {
  return splitPeople().catch(() => []);
}

export async function proposeSplit(i: {
  total: number; people: string[]; include_me?: boolean; description?: string; shares?: { person: string; amount: number }[]; bill_id?: string; category?: string; date?: string;
}): Promise<ToolOutput> {
  const total = paisa(i.total);
  if (!(total > 0)) return { text: "How much was the bill?" };
  const known = await people();
  const names: string[] = [];
  const raw = i.shares?.length ? i.shares.map((s) => s.person) : i.people;
  for (const p of raw) {
    const m = matchPerson(p, known);
    if (m.kind === "ambiguous") return { text: `Which ${m.name} do you mean: ${m.options.join(", ")}? Say the full name.` };
    names.push(m.name);
  }
  if (!names.length) return { text: "Who should I split it with?" };
  let amounts: number[];
  if (i.shares?.length) amounts = i.shares.map((s) => paisa(s.amount));
  else amounts = equalShares(total, names.length + (i.include_me === false ? 0 : 1), i.include_me !== false);
  if (amounts.some((a) => !(a > 0))) return { text: "Each share needs an amount above zero." };
  const shared = amounts.reduce((a, b) => a + b, 0);
  if (shared > total) return { text: `The shares come to ${rs(shared)}, more than the ${rs(total)} bill.` };
  const shares = names.map((person, k) => ({ person, amount: amounts[k] }));
  const note = i.description?.trim().slice(0, 200) || null;
  const today = todayPkt();
  const onDay = isIsoDate(i.date) && i.date <= today ? i.date : null;

  // Which payment was split: the one named, or a recent payment of the same amount that isn't split yet.
  type Bill = { id: string; amount_paisa: number; occurred_at: string; counterparty: string | null; category: string; shared: number };
  let bill: Bill | null = null;
  if (i.bill_id && /^[0-9a-f-]{36}$/i.test(i.bill_id)) {
    const { rows } = await q<Bill & { kind: string }>(
      `SELECT t.id, t.kind, t.amount_paisa::float8 AS amount_paisa, t.occurred_at, t.counterparty, t.category,
              coalesce((SELECT sum(s.amount_paisa) FROM app.splits s WHERE s.transaction_id = t.id), 0)::float8 AS shared
       FROM app.transactions t WHERE t.id = $1`,
      [i.bill_id],
    );
    if (!rows[0] || rows[0].kind !== "expense") return { text: "That payment can't be split (only money you paid out can)." };
    bill = rows[0];
  } else {
    const around = onDay ?? today;
    const { rows } = await q<Bill>(
      `SELECT t.id, t.amount_paisa::float8 AS amount_paisa, t.occurred_at, t.counterparty, t.category, 0::float8 AS shared
       FROM app.transactions t
       WHERE t.kind = 'expense' AND t.amount_paisa = $1
         AND t.occurred_at >= (($2::date - 7)::timestamp AT TIME ZONE 'Asia/Karachi')
         AND t.occurred_at < (($2::date + 2)::timestamp AT TIME ZONE 'Asia/Karachi')
         AND NOT EXISTS (SELECT 1 FROM app.splits s WHERE s.transaction_id = t.id)
       ORDER BY t.occurred_at DESC LIMIT 1`,
      [total, around],
    );
    bill = rows[0] ?? null;
  }
  if (bill && bill.shared + shared > bill.amount_paisa) {
    return { text: `That payment is ${rs(bill.amount_paisa)} and ${rs(bill.shared)} of it is already split, so only ${rs(bill.amount_paisa - bill.shared)} is left to split.` };
  }
  const billTotal = bill?.amount_paisa ?? total;
  const mine = billTotal - (bill?.shared ?? 0) - shared;
  const lines = ["*Split this?*"];
  if (bill) lines.push(`Payment: ${rs(bill.amount_paisa)} · ${bill.counterparty ?? bill.category} · ${day(bill.occurred_at)}`);
  let newBill: { amount: number; category: string; note: string; occurredAt: string } | null = null;
  if (!bill) {
    const cats = await categoriesInUse();
    const category = (i.category && matchCategory(i.category, cats)) || guessCategory(note ?? "", cats);
    const at = pktLocalToDate(`${onDay ?? today}T${onDay && onDay !== today ? "20:00" : new Date(Date.now() + 5 * 3600e3).toISOString().slice(11, 16)}`) ?? new Date();
    newBill = { amount: total, category, note: note ?? "Split bill", occurredAt: at.toISOString() };
    lines.push(`New payment: ${rs(total)} · ${category} · ${day(at)} (no matching payment found, so I'll add it)`);
  }
  if (note) lines.push(`For: ${note}`);
  for (const s of shares) lines.push(`• ${s.person} owes ${rs(s.amount)}`);
  if (mine > 0) lines.push(`• Your part: ${rs(mine)}`);
  const summary = lines.join("\n");
  return {
    text: `${summary}\n\n(Waiting for the owner to reply YES to save or NO to cancel. Nothing is saved yet.)`,
    proposal: { action: { type: "split", billId: bill?.id ?? null, newBill, shares, note }, summary },
  };
}

export async function proposeSettle(i: { person: string; share_ids?: string[]; note?: string }): Promise<ToolOutput> {
  const s = await listSplits();
  const m = matchPerson(i.person, [...new Set(s.open.map((x) => x.person))]);
  if (m.kind === "ambiguous") return { text: `Which one: ${m.options.join(", ")}?` };
  if (m.kind === "new") return { text: `${m.name} has nothing open to settle.` };
  let open = s.open.filter((x) => x.person.toLowerCase() === m.name.toLowerCase());
  if (i.share_ids?.length) open = open.filter((x) => i.share_ids!.includes(x.id));
  if (!open.length) return { text: `${m.name} has nothing open to settle.` };
  const owed = open.reduce((a, x) => a + x.amount_paisa - Math.min(x.paid, x.amount_paisa), 0);
  const note = i.note?.trim().slice(0, 200) || "Settled on WhatsApp";
  const lines = [`*Mark ${m.name} as paid?* ${rs(owed)} in total`];
  for (const x of open.slice(0, 10)) lines.push(`• ${rs(x.amount_paisa - Math.min(x.paid, x.amount_paisa))} for ${x.note ?? x.bill.counterparty ?? x.bill.category} (${day(x.bill.occurred_at)})`);
  if (open.some((x) => x.suggestion)) lines.push("Tip: if the money came through the bank, linking it in Mizan's Splits page keeps the record tidier.");
  const summary = lines.join("\n");
  return {
    text: `${summary}\n\n(Waiting for the owner to reply YES to save or NO to cancel. Nothing is saved yet.)`,
    proposal: { action: { type: "settle", shareIds: open.map((x) => x.id), note }, summary },
  };
}

export async function proposeExpense(i: { amount: number; description?: string; category?: string; counterparty?: string; date?: string }): Promise<ToolOutput> {
  const amount = paisa(i.amount);
  if (!(amount > 0)) return { text: "How much was it?" };
  const cats = await categoriesInUse();
  const note = i.description?.trim().slice(0, 500) || null;
  const category = (i.category && matchCategory(i.category, cats)) || guessCategory(`${note ?? ""} ${i.counterparty ?? ""}`, cats);
  const today = todayPkt();
  const onDay = isIsoDate(i.date) && i.date <= today ? i.date : today;
  const at = pktLocalToDate(`${onDay}T${onDay === today ? new Date(Date.now() + 5 * 3600e3).toISOString().slice(11, 16) : "20:00"}`) ?? new Date();
  const counterparty = i.counterparty?.trim().slice(0, 120) || null;
  const summary = [`*Add this expense?*`, `${rs(amount)} · ${category} · ${day(at)}`, counterparty ? `To: ${counterparty}` : null, note ? `For: ${note}` : null]
    .filter(Boolean)
    .join("\n");
  return {
    text: `${summary}\n\n(Waiting for the owner to reply YES to save or NO to cancel. Nothing is saved yet.)`,
    proposal: { action: { type: "expense", amount, category, counterparty, note, occurredAt: at.toISOString() }, summary },
  };
}

/** Makes a change the owner confirmed with YES. Returns what to tell them. */
export async function runConfirmed(a: Proposal): Promise<string> {
  if (a.type === "expense") {
    await createTransaction({ kind: "expense", amount: a.amount, occurredAt: new Date(a.occurredAt), category: a.category, counterparty: a.counterparty, note: a.note });
    return `✅ Added ${rs(a.amount)} · ${a.category}.`;
  }
  if (a.type === "settle") {
    let n = 0;
    for (const id of a.shareIds) if (await settleShare(id, true, a.note)) n++;
    return n ? `✅ Marked ${n === 1 ? "it" : `${n} shares`} as paid.` : "Those shares were already gone, so nothing changed.";
  }
  let billId = a.billId;
  let created = false;
  if (!billId && a.newBill) {
    const t = await createTransaction({ kind: "expense", amount: a.newBill.amount, occurredAt: new Date(a.newBill.occurredAt), category: a.newBill.category, counterparty: null, note: a.newBill.note });
    billId = t.id;
    created = true;
  }
  if (!billId) return "I couldn't find the payment to split, so nothing changed.";
  const r = await addShares(billId, a.shares.map((s) => ({ person: s.person, amount: s.amount, note: a.note })));
  if ("error" in r) {
    if (created) await q(`DELETE FROM app.transactions WHERE id = $1`, [billId]);
    return r.error === "too-much" ? "That payment has already been split since, so nothing changed." : "That payment can't be split any more, so nothing changed.";
  }
  const total = a.shares.reduce((x, s) => x + s.amount, 0);
  const names = a.shares.map((s) => s.person);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `✅ Split saved. ${who} ${names.length === 1 ? "owes" : "owe"} you ${rs(total)}${names.length > 1 ? " in total" : ""}. I'll spot it when the money comes back in.`;
}
