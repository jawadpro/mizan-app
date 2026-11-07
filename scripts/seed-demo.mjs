// Fills an empty database with made-up sample data for local demos (Docker). Never run against real data:
// it does nothing if any transaction exists. Usage: DATABASE_URL=... node scripts/seed-demo.mjs
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || process.env.DATABASE_SSL === "false";
const db = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: true } });
await db.connect();

const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM app.transactions");
if (n > 0) {
  console.log(`[seed] ${n} transactions already exist; leaving the data alone.`);
  await db.end();
  process.exit(0);
}

// Small deterministic random generator so every demo looks the same.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => Math.round(lo + rnd() * (hi - lo));

const { rows: banks } = await db.query("SELECT id, name FROM app.banks ORDER BY position, created_at");
let mcb = banks[0]?.id;
if (!mcb) mcb = (await db.query("INSERT INTO app.banks (position, name, senders) VALUES (0, 'MCB', 'MCB*, 6222') RETURNING id")).rows[0].id;
const meezan = (await db.query("INSERT INTO app.banks (position, name, senders) VALUES (1, 'Meezan', 'MEEZAN*, 8079') RETURNING id")).rows[0].id;

const tx = [];
const add = (kind, rupees, date, hour, category, counterparty, opts = {}) =>
  tx.push({ kind, amount: Math.round(rupees * 100), at: `${date}T${String(hour).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}:00+05:00`, category, counterparty, source: opts.source ?? "sms", bank: opts.bank ?? mcb, note: opts.note ?? null });

const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const day = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Gross salary Rs 200,000 a month; take-home after the employer's tax for that tax year.
const takeHome = (y, m) => (m >= 7 ? y + 1 : y) >= 2027 ? 200_000 - 13_000 : 200_000 - 13_500;

for (let y = 2025, m = 7; day(y, m, 1) <= today; m === 12 ? (y++, m = 1) : m++) {
  const d = (n) => { const s = day(y, m, n); return s <= today ? s : null; };
  const on = (n, fn) => { const s = d(n); if (s) fn(s); };
  on(1, (s) => add("income", takeHome(y, m), s, 9, "Salary", "Acme Pvt Ltd"));
  on(2, (s) => add("expense", 85_000, s, 11, "Rent", "Landlord", { source: "manual" }));
  on(5, (s) => add("expense", between(6_000, 14_000), s, 18, "Utilities", pick(["K-Electric", "SSGC", "PTCL"])));
  for (const n of [3, 9, 16, 23]) on(n, (s) => add("expense", between(4_000, 16_000), s, 19, "Groceries", pick(["Imtiaz", "Carrefour", "Naheed"])));
  for (const n of [6, 13, 20, 27]) on(n, (s) => add("expense", between(1_200, 6_500), s, 21, "Food & dining", pick(["Foodpanda", "Cheezious", "Savour Foods"])));
  for (const n of [8, 18, 26]) on(n, (s) => add("expense", between(800, 3_500), s, 8, "Transport", pick(["Careem", "PSO", "Yango"])));
  on(12, (s) => add("expense", between(3_000, 25_000), s, 17, "Shopping", pick(["Daraz", "Khaadi", "Outfitters"])));
  on(28, (s) => add("expense", 250, s, 10, "Bank charges", "MCB", { note: "Monthly SMS alert fee" }));
  on(28, (s) => add("income", between(1_800, 3_200), s, 10, "Profit", "Meezan", { bank: meezan }));
  if (m % 3 === 0) on(15, (s) => add("remittance", 50_000, s, 14, "Family support", "Brother (Dubai)", { bank: meezan }));
  if ([8, 11, 2, 5, 9].includes(m)) on(20, (s) => add("income", between(120_000, 180_000), s, 16, "Freelance", "Upwork client", { bank: meezan }));
  if ([9, 1, 4, 10].includes(m)) on(10, (s) => add("expense", 300, s, 12, "Tax deducted", "MCB", { note: "Withholding tax on cash withdrawal" }));
  if ([9, 1, 4, 10].includes(m)) on(10, (s) => add("expense", 50_000, s, 12, "Cash withdrawal", "ATM"));
  if (m === 12 || m === 6) on(22, (s) => add("expense", between(5_000, 15_000), s, 13, "Charity", "Edhi Foundation", { source: "manual" }));
}
// Zakat paid in Ramadan 1447 (around March 2026).
add("expense", 62_500, "2026-03-01", 15, "Zakat", "Masjid committee", { source: "manual" });
// One income Mizan can't classify yet, so the Tax page asks about it.
const recent = day(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 3);
add("income", 40_000, recent <= today ? recent : today, 13, "Uncategorized", "Bilal Ahmed", { bank: meezan });

for (const t of tx) {
  await db.query(
    `INSERT INTO app.transactions (kind, amount_paisa, occurred_at, category, counterparty, note, source, bank_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [t.kind, t.amount, t.at, t.category, t.counterparty, t.note, t.source, t.bank],
  );
}
await db.query(`INSERT INTO app.balance_anchor (id, amount_paisa, as_of) VALUES (1, $1, now()) ON CONFLICT (id) DO NOTHING`, [845_000_00]);
console.log(`[seed] added ${tx.length} sample transactions.`);
await db.end();
