import type { Kind } from "@/lib/categories";

export type Tx = {
  id: string;
  kind: Kind;
  amount_paisa: number;
  occurred_at: string;
  category: string;
  counterparty: string | null;
  note: string | null;
  source: "manual" | "sms" | "demo";
  account_hint: string | null;
  bank_ref: string | null;
  set_aside_id: string | null;
};

export type Analytics = {
  from: string;
  to: string;
  granularity: "day" | "month" | "year";
  totals: Record<Kind, { total: number; n: number }>;
  net: number;
  avgDailyExpense: number;
  series: { bucket: string; expense: number; income: number; remittance: number }[];
  categories: { category: string; total: number; n: number }[];
  topRecipients: { counterparty: string; total: number; n: number }[];
  pendingReview: number;
};

export type Recipient = { counterparty: string; sent: number; received: number; n: number; last_at: string; first_at: string };

export type ReviewItem = {
  id: string;
  reason: string;
  redacted_text: string | null;
  sender: string | null;
  received_at: string;
  kind: Kind | null;
  amount_paisa: number | null;
  occurred_at: string | null;
  counterparty: string | null;
  category: string | null;
  account_hint: string | null;
  bank_ref: string | null;
};

export type SetAside = {
  id: string;
  name: string;
  percent_bp: number;
  applies_to: "remittance" | "income" | "incoming";
  starts_on: string;
  ended_on: string | null;
  allocated: number;
  sources: number;
  used: number;
  remaining: number;
};

export type BalanceSummary = {
  balance: { anchor: number; as_of: string; delta: number; n: number; balance: number } | null;
  setAside: number;
  freeToSpend: number | null;
};
