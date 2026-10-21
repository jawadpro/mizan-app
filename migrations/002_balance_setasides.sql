-- Personal-use changes: drop the synthetic demo, add a manually anchored bank balance
-- and percentage "set-aside" rules (e.g. 10% of remittances for charity).

DROP SCHEMA IF EXISTS demo CASCADE;

-- One row. The live balance is this anchor plus every transaction dated after as_of.
CREATE TABLE IF NOT EXISTS app.balance_anchor (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  amount_paisa  bigint NOT NULL CHECK (abs(amount_paisa) < 100000000000000),
  as_of         timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.set_asides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  percent_bp  int  NOT NULL CHECK (percent_bp BETWEEN 1 AND 10000),   -- basis points: 1000 = 10%
  applies_to  text NOT NULL CHECK (applies_to IN ('remittance', 'income', 'incoming')),
  starts_on   date NOT NULL,
  ended_on    date CHECK (ended_on IS NULL OR ended_on >= starts_on),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- An expense can be paid out of a set-aside (e.g. a donation from the charity fund).
ALTER TABLE app.transactions ADD COLUMN IF NOT EXISTS set_aside_id uuid REFERENCES app.set_asides(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transactions_set_aside_idx ON app.transactions (set_aside_id) WHERE set_aside_id IS NOT NULL;
