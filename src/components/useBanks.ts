"use client";
import type { Space } from "./api";
import { useData } from "./useData";

export type BankItem = { id: string; name: string; senders: string; account_hint: string; auto_import: boolean; hold_transfers: boolean };

/** The owner's banks. The bank picker and bank tags only show once there are two or more. */
export function useBanks(space: Space = "app") {
  const { data, reload } = useData<{ items: BankItem[] }>(space === "app" ? "/api/banks" : null);
  const banks = data?.items ?? [];
  const nameOf = (id: string | null | undefined) => (id ? banks.find((b) => b.id === id)?.name ?? null : null);
  // "<Bank> balance" with one bank, "Bank balance" otherwise: the balance covers every account together.
  const balanceName = banks.length === 1 ? `${banks[0].name} balance` : "Bank balance";
  return { banks, multi: banks.length >= 2, nameOf, reload, balanceName };
}
