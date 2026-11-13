"use client";
import { bankLabel, useBanks } from "./useBanks";
import { useSelectedBank } from "./useSelectedBank";

/**
 * The shared bank filter for Set-asides, Bill splits and Savings: the same pick as Overview and Transactions.
 * Hidden with fewer than two banks, where there is nothing to pick.
 */
export default function BankPicker() {
  const { banks, multi } = useBanks();
  const [bank, setBank] = useSelectedBank();
  if (!multi) return null;
  return (
    <select aria-label="Bank" value={bank} onChange={(e) => setBank(e.target.value)}>
      <option value="">All banks</option>
      {banks.map((b) => <option key={b.id} value={b.id}>{bankLabel(b)}</option>)}
      <option value="none">No bank (cash)</option>
    </select>
  );
}

/** "UBL" for a bank-linked item, null for a shared one; for the small tag on its card. */
export function useBankTag() {
  const { multi, nameOf } = useBanks();
  return (id: string | null | undefined) => (multi && id ? nameOf(id) : null);
}
