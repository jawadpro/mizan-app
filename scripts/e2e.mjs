// End-to-end check against a running Mizan instance.
// Usage: BASE_URL=https://... MIZAN_PASSWORD=... SMS_INGEST_TOKEN=... node scripts/e2e.mjs
// Creates clearly-labelled E2E test records in the private workspace and deletes them at the end.
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.MIZAN_PASSWORD;
const TOKEN = process.env.SMS_INGEST_TOKEN;
if (!PW || !TOKEN) throw new Error("Set MIZAN_PASSWORD and SMS_INGEST_TOKEN");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const origin = new URL(BASE).origin;
let cookie = "";
let csrf = "";

async function call(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = h["content-type"] ?? "application/json";
  if (auth && cookie) h.cookie = cookie;
  if (method !== "GET") h.origin = h.origin ?? origin;
  if (auth && csrf && method !== "GET") h["x-csrf-token"] = csrf;
  const res = await fetch(BASE + path, { method, headers: h, body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
}

const stamp = Date.now();
const nowIso = new Date().toISOString();

// 1. Health, and no public demo
let r = await call("/api/health", { auth: false });
check("health endpoint reports database ok", r.status === 200 && r.data?.database === "ok", `HTTP ${r.status}`);
r = await call("/", { auth: false });
check("home goes straight to sign-in", [302, 307, 308].includes(r.status) && String(r.res.headers.get("location")).includes("/login"), `HTTP ${r.status}`);
r = await call("/demo", { auth: false });
check("demo page is gone", r.status === 404, `HTTP ${r.status}`);

// 2. Private routes reject anonymous access
r = await call("/api/transactions", { auth: false });
check("private API rejects anonymous request", r.status === 401, `HTTP ${r.status}`);
r = await call("/app", { auth: false });
check("private workspace page redirects anonymous visitor", [302, 307, 308].includes(r.status) && String(r.res.headers.get("location")).includes("/login"), `HTTP ${r.status}`);

// 3. Authentication
r = await call("/api/auth/login", { method: "POST", body: { password: "wrong-passphrase" }, auth: false });
check("wrong passphrase rejected", r.status === 401, `HTTP ${r.status}`);
r = await call("/api/auth/login", { method: "POST", body: { password: PW, remember: false }, auth: false });
check("without remember-me the cookie ends with the browser session", r.status === 200 && !(r.res.headers.getSetCookie?.() ?? []).some((c) => /Max-Age/i.test(c)));
r = await call("/api/auth/login", { method: "POST", body: { password: PW, remember: true }, auth: false });
const setCookies = r.res.headers.getSetCookie?.() ?? [];
cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
csrf = (setCookies.find((c) => c.startsWith("mizan_csrf=")) ?? "").split(";")[0].split("=")[1] ?? "";
check("correct passphrase signs in with HttpOnly session cookie", r.status === 200 && setCookies.some((c) => c.startsWith("mizan_session=") && /HttpOnly/i.test(c)), `HTTP ${r.status}`);
check("remember-me keeps the device signed in for 180 days", setCookies.some((c) => c.startsWith("mizan_session=") && /Max-Age=15552000/i.test(c)));

// 4. CSRF protection
const savedCsrf = csrf;
csrf = "";
r = await call("/api/transactions", { method: "POST", body: { kind: "expense", amount: "1", occurredAt: "2026-10-01T10:00", category: "Groceries" } });
check("write without CSRF token is rejected", r.status === 403, `HTTP ${r.status}`);
csrf = savedCsrf;
r = await call("/api/transactions", { method: "POST", headers: { origin: "https://evil.example" }, body: { kind: "expense", amount: "1", occurred_at: "x", category: "Groceries" } });
check("cross-origin write is rejected", r.status === 403, `HTTP ${r.status}`);

// 5. Manual entry persistence
const label = `E2E manual ${stamp}`;
r = await call("/api/transactions", { method: "POST", body: { kind: "expense", amount: "1,234.56", occurredAt: new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 16), category: "Groceries", counterparty: label, note: "automated test" } });
const manualId = r.data?.item?.id;
check("manual transaction created", r.status === 201 && r.data.item.amount_paisa === 123456, `HTTP ${r.status}`);
r = await call(`/api/transactions?q=${encodeURIComponent(label)}`);
check("manual transaction persists on a fresh read (reload)", r.status === 200 && r.data.items.length === 1 && r.data.items[0].id === manualId);
r = await call(`/api/transactions/${manualId}`, { method: "PATCH", body: { kind: "expense", amount: "1500", occurredAt: "2026-10-10T09:15", category: "Shopping", counterparty: label, note: "edited" } });
check("manual transaction edited", r.status === 200 && r.data.item.amount_paisa === 150000 && r.data.item.category === "Shopping");
r = await call(`/api/transactions?q=1500`);
check("search by exact amount finds it", r.status === 200 && r.data.items.some((t) => t.id === manualId));

// 6. Analytics include it
r = await call(`/api/analytics?from=2026-10-10&to=2026-10-10&granularity=day`);
check("analytics include the confirmed manual entry", r.status === 200 && r.data.totals.expense.total >= 150000, `expense total ${r.data?.totals?.expense?.total}`);

// 7. SMS endpoint: auth, validation, import, duplicate, review
const sms = { sender: "MCB", text: `PKR 777.${String(stamp % 100).padStart(2, "0")} debited from A/C ****4321 at E2E TEST SHOP Ref E2E${stamp} on ${new Date().toISOString().slice(0, 10)}. Avl Bal PKR 99,999.00`, receivedAt: nowIso };
r = await call("/api/sms", { method: "POST", body: sms, auth: false, headers: { authorization: "Bearer not-the-token" } });
check("SMS endpoint rejects an invalid token", r.status === 401, `HTTP ${r.status}`);
r = await call("/api/sms", { method: "POST", body: sms, auth: false });
check("SMS endpoint rejects a missing token", r.status === 401, `HTTP ${r.status}`);
r = await call("/api/sms", { method: "POST", body: { ...sms, receivedAt: "yesterday" }, auth: false, headers: { authorization: `Bearer ${TOKEN}` } });
check("SMS endpoint validates receivedAt", r.status === 400, `HTTP ${r.status}`);
r = await call("/api/sms", { method: "POST", body: JSON.stringify({ ...sms, text: "x".repeat(5000) }), auth: false, headers: { authorization: `Bearer ${TOKEN}` } });
check("SMS endpoint enforces size limit", r.status === 413 || r.status === 400, `HTTP ${r.status}`);
r = await call("/api/sms", { method: "POST", body: sms, auth: false, headers: { authorization: `Bearer ${TOKEN}` } });
const importedId = r.data?.transactionId;
check("valid MCB-style SMS imported", r.status === 201 && r.data.status === "imported", `HTTP ${r.status} ${r.data?.status}`);
r = await call("/api/sms", { method: "POST", body: sms, auth: false, headers: { authorization: `Bearer ${TOKEN}` } });
check("same SMS sent again is a duplicate", r.status === 200 && r.data.status === "duplicate", `${r.data?.status}`);
r = await call("/api/sms", { method: "POST", body: { ...sms, receivedAt: new Date(Date.now() - 120e3).toISOString() }, auth: false, headers: { authorization: `Bearer ${TOKEN}` } });
check("re-send with a different receivedAt is still a duplicate (bank ref)", r.status === 200 && r.data.status === "duplicate", `${r.data?.status}`);
r = await call(`/api/transactions?q=${encodeURIComponent("E2E Test Shop")}`);
const imported = r.data?.items?.find((t) => t.id === importedId);
check("imported SMS amount excludes the balance", !!imported && imported.amount_paisa === 77700 + (stamp % 100) && imported.source === "sms", imported ? `${imported.amount_paisa} paisa` : "not found");

const ambiguous = { sender: "MCB", text: `E2E ${stamp}: PKR 4,250.00 debit reversed and credited to your A/C ****4321. Avl Bal PKR 12,000.00`, receivedAt: nowIso };
r = await call("/api/sms", { method: "POST", body: ambiguous, auth: false, headers: { authorization: `Bearer ${TOKEN}` } });
const reviewId = r.data?.reviewId;
check("ambiguous SMS routed to review", r.status === 202 && r.data.status === "review", `${r.data?.status}: ${r.data?.reason}`);
r = await call(`/api/analytics?from=2020-01-01&to=2030-12-31&granularity=year`);
const before = r.data?.totals;
r = await call("/api/review");
const item = r.data?.items?.find((i) => i.id === reviewId);
check("review item visible, redacted and excluded from analytics", !!item && !String(item.redacted_text).includes("12,000.00") && r.data.items.length >= 1);
r = await call(`/api/review/${reviewId}`, { method: "POST", body: { action: "confirm", transaction: { kind: "income", amount: "4250", occurredAt: new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 16), category: "Refund", counterparty: `E2E review ${stamp}`, note: "confirmed by e2e" } } });
const confirmedId = r.data?.item?.id;
check("review item confirmed into a transaction", r.status === 200 && r.data.status === "confirmed", `HTTP ${r.status}`);
r = await call(`/api/analytics?from=2020-01-01&to=2030-12-31&granularity=year`);
check("confirmed review now counts in analytics", r.data.totals.income.total - before.income.total === 425000, `income delta ${r.data.totals.income.total - before.income.total}`);
r = await call(`/api/review/${reviewId}`, { method: "POST", body: { action: "dismiss" } });
check("a resolved review item cannot be resolved twice", r.status === 404, `HTTP ${r.status}`);

// 8. Export and recipients
r = await call(`/api/transactions/export?q=${encodeURIComponent(label)}`);
check("CSV export returns the transaction", r.status === 200 && typeof r.data === "string" && r.data.includes(label) && r.data.includes("1500.00"));
r = await call("/api/recipients");
check("recipient totals include the test recipient", r.status === 200 && r.data.items.some((x) => x.counterparty === label && x.sent === 150000));

// 9. Delete
r = await call(`/api/transactions/${manualId}`, { method: "DELETE" });
check("manual transaction deleted", r.status === 200);
r = await call(`/api/transactions?q=${encodeURIComponent(label)}`);
check("deleted transaction is gone", r.data?.items?.length === 0);

// 10. Bank balance follows transactions dated after it was set
const soon = (min) => new Date(Date.now() + 5 * 3600e3 + min * 60e3).toISOString().slice(0, 16);
const extra = [];
r = await call("/api/balance");
const hadAnchor = !!r.data?.balance;
if (!hadAnchor) {
  r = await call("/api/balance", { method: "PUT", body: { amount: "50,000" } });
  check("balance can be set by hand", r.status === 200 && r.data.balance.anchor === 5000000, `${r.data?.balance?.anchor}`);
}
r = await call("/api/balance");
const base = r.data.balance.balance;
r = await call("/api/transactions", { method: "POST", body: { kind: "income", amount: "1000", occurredAt: soon(3), category: "Salary", counterparty: `${label} employer` } });
extra.push(r.data?.item?.id);
r = await call("/api/transactions", { method: "POST", body: { kind: "expense", amount: "300", occurredAt: soon(4), category: "Groceries", counterparty: label } });
const balExpenseId = r.data?.item?.id;
r = await call("/api/balance");
check("incoming adds to and outgoing subtracts from the balance", r.data.balance.balance - base === 70000, `delta ${r.data.balance.balance - base}`);
await call(`/api/transactions/${balExpenseId}`, { method: "DELETE" });
r = await call("/api/balance");
check("deleting a payment restores the balance", r.data.balance.balance - base === 100000, `delta ${r.data.balance.balance - base}`);

// 11. Set-asides
r = await call("/api/set-asides", { method: "POST", body: { name: `${label} charity`, percent: "10", appliesTo: "remittance", startsOn: "2026-10-01" } });
const fundId = r.data?.id;
check("set-aside created", r.status === 201 && !!fundId, `HTTP ${r.status}`);
r = await call("/api/set-asides", { method: "POST", body: { name: "x", percent: "150", appliesTo: "remittance", startsOn: "2026-10-01" } });
check("set-aside rejects more than 100%", r.status === 400);
r = await call("/api/transactions", { method: "POST", body: { kind: "remittance", amount: "20,000", occurredAt: soon(5), category: "Family support", counterparty: `${label} brother` } });
extra.push(r.data?.item?.id);
r = await call("/api/transactions", { method: "POST", body: { kind: "expense", amount: "500", occurredAt: soon(6), category: "Charity", counterparty: `${label} masjid`, setAsideId: fundId } });
extra.push(r.data?.item?.id);
check("payment can be made from a set-aside", r.status === 201 && r.data.item.set_aside_id === fundId);
r = await call("/api/set-asides");
const fund = r.data?.items?.find((f) => f.id === fundId);
check("10% of the remittance is set aside and the payout is deducted", !!fund && fund.allocated >= 200000 && fund.used === 50000 && fund.remaining === fund.allocated - 50000, fund ? `allocated ${fund.allocated}, used ${fund.used}` : "missing");
r = await call(`/api/set-asides/${fundId}`);
check("set-aside history lists the remittance share", r.status === 200 && r.data.items.some((t) => t.share === 200000));
r = await call("/api/balance");
check("dashboard shows money set aside and free to spend", r.data.setAside >= fund.remaining && r.data.freeToSpend === r.data.balance.balance - r.data.setAside);
r = await call("/api/recipients");
check("sender of incoming money appears as a recipient", r.data.items.some((x) => x.counterparty === `${label} brother` && x.received === 2000000));
r = await call(`/api/set-asides/${fundId}`, { method: "DELETE" });
check("set-aside deleted", r.status === 200);

// 12. Clean up the remaining test records
for (const id of [importedId, confirmedId, ...extra].filter(Boolean)) await call(`/api/transactions/${id}`, { method: "DELETE" });
r = await call(`/api/transactions?q=E2E`);
check("test records cleaned up", r.data?.items?.length === 0, `${r.data?.items?.length} left`);
r = await call("/api/auth/logout", { method: "POST" });
check("sign out", r.status === 200);

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (!hadAnchor) console.log("note: this run set a test bank balance; clear app.balance_anchor before real use");
process.exit(failed.length ? 1 : 0);
