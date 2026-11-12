-- Each bank account keeps its own balance: set by hand once, then moved by that account's transactions.
-- The single app.balance_anchor row stays for an install with no banks; with banks it is copied to the first one
-- and left in place (ignored from then on), so an older deployment reading it keeps working.
CREATE TABLE IF NOT EXISTS app.bank_balances (
  bank_id       uuid PRIMARY KEY REFERENCES app.banks(id) ON DELETE CASCADE,
  amount_paisa  bigint NOT NULL CHECK (abs(amount_paisa) < 100000000000000),
  as_of         timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The balance set so far was entered for the first (default) bank.
INSERT INTO app.bank_balances (bank_id, amount_paisa, as_of, updated_at)
SELECT b.id, a.amount_paisa, a.as_of, a.updated_at
FROM app.balance_anchor a, (SELECT id FROM app.banks ORDER BY position, created_at LIMIT 1) b
WHERE a.id = 1
ON CONFLICT (bank_id) DO NOTHING;
