-- Banks the owner gets alerts from, edited in Settings > Bank messages. Each alert is matched to a bank
-- by its sender, and every transaction can carry the bank it came from (for the bank filter).
CREATE TABLE IF NOT EXISTS app.banks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position        int NOT NULL DEFAULT 0,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- Sender IDs or contact names, comma-separated; "MCB*" matches any sender starting with MCB.
  senders         text NOT NULL DEFAULT '' CHECK (char_length(senders) <= 300),
  account_hint    text NOT NULL DEFAULT '' CHECK (account_hint = '' OR account_hint ~ '^[0-9]{3,4}$'),
  auto_import     boolean NOT NULL DEFAULT true,
  hold_transfers  boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The MCB setup that used to live in code, so an existing install keeps reading MCB alerts exactly as before.
-- Only an install that already has SMS data gets it; a new install adds its own banks on the setup page.
INSERT INTO app.banks (position, name, senders)
SELECT 0, 'MCB', 'MCB*, MCBBANK, MCB BANK, MCB-BANK, 6222, 8222'
WHERE NOT EXISTS (SELECT 1 FROM app.banks)
  AND (EXISTS (SELECT 1 FROM app.transactions WHERE source = 'sms') OR EXISTS (SELECT 1 FROM app.review_items));

ALTER TABLE app.transactions ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES app.banks(id) ON DELETE SET NULL;
ALTER TABLE app.review_items ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES app.banks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transactions_bank_idx ON app.transactions (bank_id, occurred_at DESC);

-- Until now every SMS came from MCB: tag those transactions and pending reviews with it.
UPDATE app.transactions t SET bank_id = b.id
FROM (SELECT id FROM app.banks ORDER BY position, created_at LIMIT 1) b
WHERE t.source = 'sms' AND t.bank_id IS NULL;
UPDATE app.review_items r SET bank_id = b.id
FROM (SELECT id FROM app.banks ORDER BY position, created_at LIMIT 1) b
WHERE r.bank_id IS NULL AND (upper(trim(r.sender)) LIKE 'MCB%' OR trim(r.sender) IN ('6222', '8222'));
