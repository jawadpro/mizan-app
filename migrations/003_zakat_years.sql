-- Zakat is paid each Ramadan. One row per Hijri year records what was worked out as due;
-- payments are ordinary expense transactions in the "Zakat" category, so they move the balance.

CREATE TABLE IF NOT EXISTS app.zakat_years (
  hijri_year    int PRIMARY KEY CHECK (hijri_year BETWEEN 1400 AND 1600),
  assessed_on   date NOT NULL,
  basis         text NOT NULL CHECK (basis IN ('silver', 'gold')),
  wealth_paisa  bigint NOT NULL CHECK (wealth_paisa >= 0 AND wealth_paisa < 100000000000000),
  nisab_paisa   bigint NOT NULL CHECK (nisab_paisa >= 0 AND nisab_paisa < 100000000000000),
  due_paisa     bigint NOT NULL CHECK (due_paisa >= 0 AND due_paisa < 100000000000000),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Payments are looked up by category and date.
CREATE INDEX IF NOT EXISTS transactions_category_occurred_idx ON app.transactions (category, occurred_at);
