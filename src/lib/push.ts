import "server-only";
import webpush from "web-push";
import { q } from "./db";

// Web Push for review-inbox alerts. The VAPID key pair lives only in server-side environment
// variables; the public half is also handed to the browser so it can subscribe.

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
  return process.env.VAPID_PUBLIC_KEY || null;
}

function configured(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
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

export type PushPayload = { title: string; body: string; url: string; count?: number };

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

/** Notifies devices that an alert is waiting. The text never includes the SMS, the amount or the sender. */
export async function notifyReviewWaiting() {
  let n = 1;
  try {
    const { rows } = await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.review_items WHERE status = 'pending'`);
    n = rows[0]?.n || 1;
  } catch {
    // Fall back to a generic count; the notification still goes out.
  }
  return notifyAll({
    title: "Mizan",
    body: n === 1 ? "An MCB alert is waiting in your review inbox." : `${n} MCB alerts are waiting in your review inbox.`,
    url: "/app/review",
    count: n,
  });
}
