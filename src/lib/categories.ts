export const KINDS = ["expense", "income", "remittance"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  expense: "Expense",
  income: "Income",
  remittance: "Remittance",
};

/** Money moved between the user's own accounts: kept for the balance, left out of spending, income and set-asides. */
export const OWN_ACCOUNTS = "Own accounts";

export const CATEGORIES: Record<Kind, string[]> = {
  expense: [
    "Groceries", "Food & dining", "Transport", "Utilities", "Rent", "Shopping", "Health",
    "Education", "Entertainment", "Charity", "Zakat", "Savings", "Transfers", "Cash withdrawal", "Bank charges", OWN_ACCOUNTS, "Uncategorized",
  ],
  income: ["Salary", "Freelance", "Business", "Refund", "Profit", OWN_ACCOUNTS, "Uncategorized"],
  remittance: ["Family support", "Remittance", "Uncategorized"],
};

export const ALL_CATEGORIES = Array.from(new Set(Object.values(CATEGORIES).flat()));
