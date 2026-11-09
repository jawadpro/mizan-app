-- Monthly payments: a checklist of things paid every month (rent, bills, school fees). The list for a
-- month is worked out from the items active in it, so nothing has to be generated when a month begins.
CREATE TABLE IF NOT EXISTS app.monthly_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position      int NOT NULL DEFAULT 0,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- The usual amount; empty for bills that change every month (electricity, gas).
  amount_paisa  bigint CHECK (amount_paisa IS NULL OR (amount_paisa > 0 AND amount_paisa < 100000000000000)),
  category      text NOT NULL DEFAULT 'Uncategorized' CHECK (char_length(category) BETWEEN 1 AND 60),
  -- Who it is paid to, used to spot the payment among the month's transactions.
  payee         text CHECK (payee IS NULL OR char_length(payee) <= 120),
  due_day       int CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  starts_month  date NOT NULL CHECK (extract(day FROM starts_month) = 1),
  -- The last month it is on the list; stopping an item keeps its history.
  ended_month   date CHECK (ended_month IS NULL OR (extract(day FROM ended_month) = 1 AND ended_month >= starts_month)),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per item per month once it is ticked off: paid (with or without a linked transaction) or skipped.
CREATE TABLE IF NOT EXISTS app.monthly_marks (
  item_id         uuid NOT NULL REFERENCES app.monthly_items(id) ON DELETE CASCADE,
  month           date NOT NULL CHECK (extract(day FROM month) = 1),
  status          text NOT NULL CHECK (status IN ('paid', 'skipped')),
  transaction_id  uuid REFERENCES app.transactions(id) ON DELETE SET NULL,
  -- For a payment with no transaction in Mizan (paid in cash, from another account).
  amount_paisa    bigint CHECK (amount_paisa IS NULL OR (amount_paisa > 0 AND amount_paisa < 100000000000000)),
  note            text CHECK (note IS NULL OR char_length(note) <= 200),
  marked_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, month)
);
CREATE INDEX IF NOT EXISTS monthly_marks_tx_idx ON app.monthly_marks (transaction_id) WHERE transaction_id IS NOT NULL;
