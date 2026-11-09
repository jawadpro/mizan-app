/** A transaction with any bank charges or tax that were added on it, kept together for the activity list. */
export type TxGroup<T> = { t: T; charges: T[] };

/**
 * Puts each bank charge or tax right after the transfer it belongs to, when both are in the same list
 * (one day's items). A charge whose transfer isn't in the list stays where it was, as a normal row.
 */
export function groupCharges<T extends { id: string; parent_id?: string | null }>(items: T[]): TxGroup<T>[] {
  const ids = new Set(items.map((t) => t.id));
  const isCharge = (t: T) => !!t.parent_id && t.parent_id !== t.id && ids.has(t.parent_id);
  const byParent = new Map<string, T[]>();
  for (const t of items) {
    if (!isCharge(t)) continue;
    const list = byParent.get(t.parent_id!) ?? [];
    list.push(t);
    byParent.set(t.parent_id!, list);
  }
  return items.filter((t) => !isCharge(t)).map((t) => ({ t, charges: byParent.get(t.id) ?? [] }));
}
