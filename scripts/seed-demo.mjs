// Fills a Mizan instance with about three months of made-up demo data, through the public API.
// Usage: BASE_URL=http://localhost:3000 MIZAN_PASSWORD=... node scripts/seed-demo.mjs
// Use it on a demo or local instance only, never on your real workspace: it adds ~90 transactions.
// Every name, amount and shop below is fictional.
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.MIZAN_PASSWORD;
if (!PW) throw new Error("Set MIZAN_PASSWORD");

const origin = new URL(BASE).origin;
let cookie = "";
let csrf = "";

async function call(path, method = "GET", body) {
  const headers = { origin };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (csrf && method !== "GET") headers["x-csrf-token"] = csrf;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status} ${JSON.stringify(data)}`);
  return { res, data };
}

const login = await call("/api/auth/login", "POST", { password: PW, remember: true });
const set = login.res.headers.getSetCookie();
cookie = set.map((c) => c.split(";")[0]).join("; ");
csrf = (set.find((c) => c.startsWith("mizan_csrf=")) ?? "").split(";")[0].split("=")[1] ?? "";

// Small deterministic random generator, so every run gives the same data.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const around = (n, spread = 0.25) => Math.round(n * (1 - spread + rand() * spread * 2));

// Dates in Pakistan time, as the API expects (YYYY-MM-DDTHH:mm).
const PKT = 5 * 3600e3;
const now = new Date(Date.now() + PKT);
const dayStr = (d) => d.toISOString().slice(0, 10);
const at = (daysAgo, hh, mm = 0) => {
  const d = new Date(now.getTime() - daysAgo * 86400e3);
  return `${dayStr(d)}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

const DAYS = 92;
const txs = [];
const add = (daysAgo, hh, kind, amount, category, counterparty, note) =>
  txs.push({ kind, amount: String(amount), occurredAt: at(daysAgo, hh, Math.floor(rand() * 60)), category, counterparty, note });

// Monthly income, rent and bills: on the 1st, 5th, 10th and so on of each of the last three months.
for (let m = 0; m < 3; m++) {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
  const ago = (dom) => Math.round((now.getTime() - (first.getTime() + (dom - 1) * 86400e3)) / 86400e3);
  const inRange = (dom) => ago(dom) >= 1 && ago(dom) <= DAYS;
  if (inRange(1)) add(ago(1), 10, "income", 185000, "Salary", "Northwind Software");
  if (inRange(3)) add(ago(3), 11, "expense", 55000, "Rent", "Farhan Malik", "Monthly rent");
  if (inRange(6)) add(ago(6), 18, "remittance", 60000, "Family support", "Bilal Ahmed");
  if (inRange(8)) add(ago(8), 9, "expense", around(9800, 0.3), "Utilities", "K-Electric");
  if (inRange(9)) add(ago(9), 9, "expense", around(2600, 0.3), "Utilities", "SSGC");
  if (inRange(12)) add(ago(12), 20, "expense", 3999, "Utilities", "PTCL Flash Fiber");
  if (inRange(15)) add(ago(15), 21, "expense", 1100, "Entertainment", "Netflix");
  if (inRange(18)) add(ago(18), 13, "income", around(40000, 0.2), "Freelance", "Ayesha Khan", "Logo design project");
}

// Day-to-day spending.
for (let d = DAYS; d >= 1; d--) {
  if (rand() < 0.55) add(d, 13 + Math.floor(rand() * 9), "expense", around(1800, 0.5), "Food & dining", pick(["Foodpanda", "KFC", "Cheezious", "Savour Foods", "Gloria Jeans"]));
  if (rand() < 0.3) add(d, 10 + Math.floor(rand() * 10), "expense", around(650, 0.5), "Transport", pick(["Careem", "Bykea", "inDrive"]));
  if (d % 7 === 2) add(d, 18, "expense", around(14500, 0.3), "Groceries", pick(["Imtiaz", "Carrefour", "Naheed"]));
  if (d % 10 === 4) add(d, 8, "expense", around(6000, 0.2), "Transport", "PSO");
  if (d % 23 === 5) add(d, 16, "expense", around(7500, 0.6), "Shopping", pick(["Daraz", "Khaadi", "Outfitters"]));
  if (d % 31 === 11) add(d, 12, "expense", around(2400, 0.4), "Health", "Dvago Pharmacy");
  if (d % 19 === 7) add(d, 19, "expense", 20000, "Transfers", "Hamza Siddiqui", "Shared trip costs");
}

// Set-asides first, so payments can be drawn from them.
const charity = (await call("/api/set-asides", "POST", { name: "Charity", percent: "10", appliesTo: "remittance", startsOn: dayStr(new Date(now.getTime() - DAYS * 86400e3)), purpose: "giving" })).data.id;
await call("/api/set-asides", "POST", { name: "Emergency fund", percent: "10", appliesTo: "income", startsOn: dayStr(new Date(now.getTime() - 30 * 86400e3)), purpose: "saving" });
add(40, 17, "expense", 5000, "Charity", "Community food bank");
txs[txs.length - 1].setAsideId = charity;
add(12, 17, "expense", 4000, "Charity", "Neighbourhood school fund");
txs[txs.length - 1].setAsideId = charity;

let n = 0;
for (const t of txs) {
  await call("/api/transactions", "POST", t);
  n++;
}

// The balance is anchored now; alerts sent after this move it.
await call("/api/balance", "PUT", { amount: "85,301.17" });
console.log(`Seeded ${n} transactions, 2 set-asides and a starting balance of PKR 85,301.17.`);
