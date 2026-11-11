// Fills an empty database with made-up sample data, ONLY for the docker-compose.demo.yml screenshot demo.
// Never run it for a real install, even when asked to "set the app up": a new owner starts empty and goes
// through the setup wizard. It refuses unless SEED_DEMO_CONFIRM=made-up-sample-data is set and the database
// is a local one, and it does nothing if any transaction exists.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const isLocalDb = /@(localhost|127\.0\.0\.1|db)[:/]/.test(url);
if (process.env.SEED_DEMO_CONFIRM !== "made-up-sample-data" || !isLocalDb) {
  console.error("[seed] Refusing to add sample data. It is only for the local docker-compose.demo.yml demo; a real install starts empty and uses the setup wizard.");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || process.env.DATABASE_SSL === "false";
const db = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: true } });
await db.connect();

const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM app.transactions");
if (n > 0) {
  // A demo made before monthly payments existed still gets a sample list, but only when the data is
  // this script's own sample data (its made-up employer is there).
  const { rows: [{ sample }] } = await db.query("SELECT EXISTS (SELECT 1 FROM app.transactions WHERE counterparty = 'Acme Pvt Ltd') AS sample");
  if (sample) await seedMonthly();
  console.log(`[seed] ${n} transactions already exist; leaving them alone.`);
  await db.end();
  process.exit(0);
}

/** Sample monthly payments: rent, bills and school fees, ticked off for past months. Only into an empty list. */
async function seedMonthly() {
  const { rows: [{ m }] } = await db.query("SELECT count(*)::int AS m FROM app.monthly_items");
  if (m > 0) return;
  const now = new Date(Date.now() + 5 * 3600_000);
  const monthStart = (back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 10);
  const start = monthStart(4);
  const items = [
    ["Rent", 85_000_00, "Rent", "Landlord", 2],
    ["Electricity & gas", null, "Utilities", "K-Electric", 5],
    ["School fees", 18_500_00, "Education", "City School", 10],
    ["Maid", 25_000_00, "Uncategorized", null, 1],
    ["Internet", 4_500_00, "Utilities", "PTCL", 20],
  ];
  const ids = {};
  for (const [i, [name, amount, category, payee, due]] of items.entries()) {
    ids[name] = (await db.query(
      `INSERT INTO app.monthly_items (position, name, amount_paisa, category, payee, due_day, starts_month) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [i, name, amount, category, payee, due, start],
    )).rows[0].id;
  }
  // Past months: link the rent and the first utility bill of the month, mark the rest paid outside Mizan.
  for (let back = 4; back >= 1; back--) {
    const ms = monthStart(back);
    const link = async (name, sql) => {
      const { rows } = await db.query(
        `SELECT id FROM app.transactions WHERE kind = 'expense' AND ${sql}
           AND occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Karachi')
           AND occurred_at < (($1::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Karachi')
         ORDER BY occurred_at LIMIT 1`,
        [ms],
      );
      await db.query(`INSERT INTO app.monthly_marks (item_id, month, status, paid_in_full) VALUES ($1,$2,'paid',true)`, [ids[name], ms]);
      if (rows[0]) await db.query(`INSERT INTO app.monthly_mark_txs (item_id, month, transaction_id) VALUES ($1,$2,$3)`, [ids[name], ms, rows[0].id]);
    };
    await link("Rent", "category = 'Rent'");
    await link("Electricity & gas", "category = 'Utilities'");
    await db.query(`INSERT INTO app.monthly_marks (item_id, month, status, paid_in_full, note) VALUES ($1,$2,'paid',true,'Paid at the school office')`, [ids["School fees"], ms]);
    await db.query(`INSERT INTO app.monthly_marks (item_id, month, status, paid_in_full, amount_paisa, note) VALUES ($1,$2,'paid',true,2500000,'Cash')`, [ids.Maid, ms]);
    // One missed month, so the history shows something still open.
    if (back !== 2) await db.query(`INSERT INTO app.monthly_marks (item_id, month, status, paid_in_full) VALUES ($1,$2,'paid',true)`, [ids.Internet, ms]);
  }
  console.log(`[seed] added ${items.length} sample monthly payments.`);
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
// Income tax paid to FBR with a PSID.
add("expense", 18_000, "2025-09-25", 11, "Tax payment", "FBR", { note: "Income tax for Tax Year 2025" });
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
await seedMonthly();
await db.end();
