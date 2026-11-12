import "server-only";
import webpush from "web-push";
import { q } from "./db";
import { env } from "./env";
import { formatPaisa, setDisplayCurrency } from "./money";
import { getPrefs, listBanks } from "./repo";

// Web Push for imported payments and review-inbox alerts. The VAPID key pair comes from the environment, or is created on
// the setup page and kept in the database; the public half is also handed to the browser so it can subscribe.

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Push services browsers actually use. Anything else is refused, so the server never posts to arbitrary hosts. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.username && !u.password && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export function vapidPublicKey(): string | null {
  return env.vapid()?.pub ?? null;
}

function configured(): boolean {
  const v = env.vapid();
  if (!v) return false;
  webpush.setVapidDetails(v.subject, v.pub, v.priv);
  return true;
}

export async function saveSubscription(s: PushSubscriptionInput) {
  await q(
    `INSERT INTO app.push_subscriptions (endpoint, p256dh, auth) VALUES ($1,$2,$3)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [s.endpoint, s.keys.p256dh, s.keys.auth],
  );
}

export async function deleteSubscription(endpoint: string) {
  await q(`DELETE FROM app.push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

/** tag: notifications with the same tag replace each other; each imported payment gets its own. */
export type PushPayload = { title: string; body: string; url: string; count?: number; tag?: string };

/**
 * Sends to every subscribed device and drops subscriptions the push service says are gone.
 * Never throws: a failed notification must not fail the SMS import that triggered it.
 */
export async function notifyAll(payload: PushPayload): Promise<number> {
  try {
    if (!configured()) return 0;
    const { rows } = await q<{ endpoint: string; p256dh: string; auth: string }>(`SELECT endpoint, p256dh, auth FROM app.push_subscriptions LIMIT 20`);
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(
      rows.map((r) => webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, { TTL: 86400, timeout: 5000, urgency: "normal" })),
    );
    let sent = 0;
    for (const [i, res] of results.entries()) {
      if (res.status === "fulfilled") sent++;
      else {
        const code = (res.reason as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await deleteSubscription(rows[i].endpoint);
      }
    }
    return sent;
  } catch {
    return 0;
  }
}

export type AlertDetail = { kind: "expense" | "income" | "remittance" | null; amountPaisa: number | null; counterparty: string | null; category: string | null; bankId: string | null };

const KIND_WORD = { expense: "Spent", income: "Received", remittance: "Remittance" } as const;
const KIND_PAST = { expense: "spent", income: "received", remittance: "remittance" } as const;
const money = (p: number) => formatPaisa(p).replace(/\.00$/, "");

/** "Imtiaz · Groceries · UBL": who it was with, the category and the bank, whichever are known. */
async function describe(d: AlertDetail) {
  const bank = d.bankId ? (await listBanks().catch(() => [])).find((b) => b.id === d.bankId)?.name : null;
  const who = d.counterparty ? (d.kind === "expense" ? d.counterparty : `From ${d.counterparty}`) : null;
  return [who, d.category, bank].filter(Boolean).join(" · ");
}

async function prefs() {
  const p = await getPrefs().catch(() => null);
  setDisplayCurrency(p?.currency ?? "PKR");
  return p;
}

/** Tells devices a payment was imported from a bank message: "Spent Rs 2,450" / "Imtiaz · Groceries · UBL". */
export async function notifyImported(d: AlertDetail & { transactionId: string }) {
  const p = await prefs();
  if (p && !p.notifyImports) return 0;
  const details = p?.notifyDetails !== false;
  const amount = d.amountPaisa ? money(d.amountPaisa) : null;
  return notifyAll({
    title: details && amount && d.kind ? `${KIND_WORD[d.kind]} ${amount}` : "Mizan",
    body: details ? (await describe(d)) || "Added from a bank message." : "A payment was added from a bank message.",
    url: "/app/transactions",
    tag: `mizan-tx-${d.transactionId}`,
  });
}

/** Tells devices an alert is waiting for review, with its amount and reason unless details are turned off. */
export async function notifyReviewWaiting(d?: AlertDetail & { reason: string }) {
  let n = 1;
  try {
    const { rows } = await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.review_items WHERE status = 'pending'`);
    n = rows[0]?.n || 1;
  } catch {
    // Fall back to a generic count; the notification still goes out.
  }
  const p = await prefs();
  const waiting = n === 1 ? "1 alert waiting" : `${n} alerts waiting`;
  if (d && p?.notifyDetails !== false) {
    const amount = d.amountPaisa ? money(d.amountPaisa) : null;
    const what = await describe(d);
    return notifyAll({
      title: amount ? `Review ${amount}${d.kind ? ` ${KIND_PAST[d.kind]}` : ""}` : "A bank alert needs a look",
      body: [what, d.reason].filter(Boolean).join(" · ") + ` (${waiting})`,
      url: "/app/review",
      count: n,
      tag: "mizan-review",
    });
  }
  return notifyAll({
    title: "Mizan",
    body: n === 1 ? "A bank alert is waiting in your review inbox." : `${n} bank alerts are waiting in your review inbox.`,
    url: "/app/review",
    count: n,
    tag: "mizan-review",
  });
}
