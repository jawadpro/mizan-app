import { paisaToDecimal } from "./money";
import { dateToPktLocal } from "./time";
import type { TxRow } from "./repo";

function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: TxRow[]): string {
  const header = ["date_pkt", "kind", "amount_pkr", "category", "counterparty", "note", "source", "account_hint", "bank_ref", "id"];
  const lines = rows.map((r) =>
    [dateToPktLocal(r.occurred_at).replace("T", " "), r.kind, paisaToDecimal(r.amount_paisa), r.category, r.counterparty, r.note, r.source, r.account_hint, r.bank_ref, r.id]
      .map(cell)
      .join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}
