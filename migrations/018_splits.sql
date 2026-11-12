-- Bill splits: a payment made in full, split into shares that other people owe back.
-- A share stays open until incoming money is linked to it (or it is settled by hand).
CREATE TABLE IF NOT EXISTS app.splits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The payment that was split. Deleting it removes its shares.
  transaction_id  uuid NOT NULL REFERENCES app.transactions(id) ON DELETE CASCADE,
  person          text NOT NULL CHECK (char_length(person) BETWEEN 1 AND 60),
  amount_paisa    bigint NOT NULL CHECK (amount_paisa > 0 AND amount_paisa < 100000000000000),
  -- What it was for, shown on the receipt ("Dinner at Kolachi").
  note            text CHECK (note IS NULL OR char_length(note) <= 200),
  -- Settled by hand: paid in cash, or let off. Shares paid back through the bank are settled by their links.
  settled_at      timestamptz,
  settled_note    text CHECK (settled_note IS NULL OR char_length(settled_note) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS splits_tx_idx ON app.splits (transaction_id);

-- Incoming money that paid a share back, in one or more parts. One transaction pays back one share.
CREATE TABLE IF NOT EXISTS app.split_payments (
  split_id        uuid NOT NULL REFERENCES app.splits(id) ON DELETE CASCADE,
  transaction_id  uuid NOT NULL UNIQUE REFERENCES app.transactions(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (split_id, transaction_id)
);
