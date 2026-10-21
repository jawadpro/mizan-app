-- Mizan schema. All money is stored as integer paisa (1 PKR = 100 paisa).
-- The same tables exist in two schemas:
--   app  : the private, authenticated workspace (real data)
--   demo : clearly-labelled synthetic data for the public demo (read-only)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['app', 'demo'] LOOP
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', s);

    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.transactions (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind          text NOT NULL CHECK (kind IN ('expense', 'income', 'remittance')),
        amount_paisa  bigint NOT NULL CHECK (amount_paisa > 0 AND amount_paisa < 100000000000000),
        currency      text NOT NULL DEFAULT 'PKR' CHECK (currency = 'PKR'),
        occurred_at   timestamptz NOT NULL,
        category      text NOT NULL DEFAULT 'Uncategorized' CHECK (char_length(category) BETWEEN 1 AND 60),
        counterparty  text CHECK (counterparty IS NULL OR char_length(counterparty) <= 120),
        note          text CHECK (note IS NULL OR char_length(note) <= 500),
        source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'sms', 'demo')),
        account_hint  text CHECK (account_hint IS NULL OR account_hint ~ '^[0-9]{3,4}$'),
        bank_ref      text CHECK (bank_ref IS NULL OR char_length(bank_ref) <= 64),
        sms_import_id uuid,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )$f$, s);

    EXECUTE format('CREATE INDEX IF NOT EXISTS transactions_occurred_idx ON %I.transactions (occurred_at DESC)', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS transactions_kind_occurred_idx ON %I.transactions (kind, occurred_at DESC)', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS transactions_category_idx ON %I.transactions (category)', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS transactions_counterparty_idx ON %I.transactions (lower(counterparty)) WHERE counterparty IS NOT NULL', s);
    -- Bank reference numbers, when an alert carries one, must never be imported twice.
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS transactions_bank_ref_uniq ON %I.transactions (bank_ref) WHERE bank_ref IS NOT NULL', s);

    -- One row per accepted SMS delivery. Holds a keyed fingerprint, never the raw text.
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.sms_imports (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        fingerprint  text NOT NULL,
        received_at  timestamptz NOT NULL,
        outcome      text NOT NULL CHECK (outcome IN ('imported', 'review', 'ignored')),
        parser_rule  text,
        created_at   timestamptz NOT NULL DEFAULT now()
      )$f$, s);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS sms_imports_fingerprint_uniq ON %I.sms_imports (fingerprint)', s);

    -- Alerts that could not be parsed with confidence. Excluded from analytics until confirmed.
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.review_items (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sms_import_id uuid,
        status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed')),
        reason        text NOT NULL,
        redacted_text text CHECK (redacted_text IS NULL OR char_length(redacted_text) <= 1000),
        sender        text,
        received_at   timestamptz NOT NULL,
        kind          text CHECK (kind IS NULL OR kind IN ('expense', 'income', 'remittance')),
        amount_paisa  bigint CHECK (amount_paisa IS NULL OR amount_paisa > 0),
        occurred_at   timestamptz,
        counterparty  text,
        category      text,
        account_hint  text,
        bank_ref      text,
        transaction_id uuid,
        created_at    timestamptz NOT NULL DEFAULT now(),
        resolved_at   timestamptz
      )$f$, s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS review_items_status_idx ON %I.review_items (status, created_at DESC)', s);
  END LOOP;
END $$;

-- Operational tables live only in the private schema.
CREATE TABLE IF NOT EXISTS app.rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON app.rate_limits (window_start);
