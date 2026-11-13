"use client";
import { digitsLabel } from "@/lib/banks";
import type { Space } from "./api";
import { useData } from "./useData";

export type BankItem = { id: string; name: string; senders: string; account_hint: string; auto_import: boolean; hold_transfers: boolean; active: boolean; records?: number };
export type RemovedBankItem = { id: string; name: string; account_hint: string; records: number; archived_at: string };

/** "My Bank ••1234", with "(paused)" while the bank is paused: how a bank is named in pickers. */
export function bankLabel(b: Pick<BankItem, "name" | "account_hint"> & { active?: boolean }) {
  return `${b.name}${b.account_hint ? ` ${digitsLabel(b.account_hint)}` : ""}${b.active === false ? " (paused)" : ""}`;
}

/** The owner's banks. The bank picker and bank tags only show once there are two or more. */
export function useBanks(space: Space = "app") {
  const { data, reload } = useData<{ items: BankItem[]; removed?: RemovedBankItem[] }>(space === "app" ? "/api/banks" : null);
  const banks = data?.items ?? [];
  const removed = data?.removed ?? [];
  // Transactions of a removed bank keep its name.
  const nameOf = (id: string | null | undefined) => (id ? banks.find((b) => b.id === id)?.name ?? removed.find((b) => b.id === id)?.name ?? null : null);
  // "<Bank> balance" with one bank, "Bank balance" otherwise: the balance covers every account together.
  const balanceName = banks.length === 1 ? `${banks[0].name} balance` : "Bank balance";
  return { banks, removed, multi: banks.length >= 2, nameOf, reload, balanceName };
}
