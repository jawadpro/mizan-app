// Bill splits: when a share counts as paid back, and spotting which incoming transaction paid it. No database here.

export type ShareLike = { id: string; person: string; amount_paisa: number; paid: number; bill_at: string };
export type InTx = { id: string; amount_paisa: number; occurred_at: string; counterparty: string | null; note: string | null };

/** A share is paid back once its parts reach 98% of it (a small shortfall is usually a transfer fee). */
export function isPaidBack(amount: number, paid: number, settledByHand: boolean): boolean {
  return settledByHand || paid * 100 >= amount * 98;
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").split(" ").filter((w) => w.length >= 3);

/** Whether a name ("Ali Raza") shows up in a bank line ("ALI RAZA KHAN" / "IBFT from ali"). */
export function nameHit(person: string, hay: string): boolean {
  const h = hay.toLowerCase();
  const n = person.trim().toLowerCase();
  if (n.length >= 3 && h.includes(n)) return true;
  const ws = words(n);
  if (!ws.length) return false;
  const hw = new Set(words(h));
  // Every word, or at least the first name when the bank prints the full name differently.
  return ws.every((w) => hw.has(w)) || hw.has(ws[0]);
}

/**
 * How likely incoming money is to be this person paying their share back, 0 to 100.
 * The name matters most, then the amount (against what is still owed); money that arrived before the bill can't be it.
 */
export function shareScore(s: ShareLike, t: InTx): number {
  const days = (Date.parse(t.occurred_at) - Date.parse(s.bill_at)) / 86400e3;
  if (days < -1) return 0;
  const owed = Math.max(1, s.amount_paisa - s.paid);
  let score = 0;
  if (nameHit(s.person, `${t.counterparty ?? ""} ${t.note ?? ""}`)) score += 50;
  const diff = Math.abs(t.amount_paisa - owed) / owed;
  if (diff === 0) score += 40;
  else if (diff <= 0.02) score += 32;
  else if (diff <= 0.1) score += 15;
  else if (t.amount_paisa < owed) score += 5; // could be a part payment
  if (days <= 14) score += 10;
  else if (days <= 45) score += 5;
  return Math.min(100, score);
}

/** Good enough to offer as "looks like Ali paid you back" without searching. */
export const SUGGEST_AT = 60;

export function rankFor<T extends InTx>(s: ShareLike, txs: T[], min = 0): (T & { score: number })[] {
  return txs
    .map((t) => ({ ...t, score: shareScore(s, t) }))
    .filter((t) => t.score >= min && Date.parse(t.occurred_at) - Date.parse(s.bill_at) >= -86400e3)
    .sort((a, b) => b.score - a.score || Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}

/** One suggestion per open share, never the same transaction for two shares. */
export function suggestShares<S extends ShareLike, T extends InTx>(shares: S[], txs: T[]): Map<string, T & { score: number }> {
  const pairs: { s: S; t: T & { score: number } }[] = [];
  for (const s of shares) for (const t of rankFor(s, txs, SUGGEST_AT)) pairs.push({ s, t });
  pairs.sort((a, b) => b.t.score - a.t.score);
  const out = new Map<string, T & { score: number }>();
  const used = new Set<string>();
  for (const { s, t } of pairs) {
    if (out.has(s.id) || used.has(t.id)) continue;
    out.set(s.id, t);
    used.add(t.id);
  }
  return out;
}

/**
 * Equal shares of a bill between `people` people, in whole currency units. When the owner is one of them,
 * the rounding left over stays with the owner; otherwise it goes to the first shares.
 */
export function equalShares(total: number, people: number, includeMe: boolean): number[] {
  const n = Math.max(1, Math.floor(people));
  const others = includeMe ? n - 1 : n;
  if (others <= 0) return [];
  const each = Math.floor(total / n / 100) * 100 || Math.floor(total / n);
  const shares = Array.from({ length: others }, () => each);
  if (!includeMe) {
    let left = total - each * others;
    for (let i = 0; left > 0; i = (i + 1) % others) {
      const step = Math.min(left, 100);
      shares[i] += step;
      left -= step;
    }
  }
  return shares;
}

/** A short reference for a receipt, from the share's id ("SPL-3F9A2C"). */
export function receiptRef(id: string): string {
  return `SPL-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
