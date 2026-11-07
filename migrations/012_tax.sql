-- Yearly income tax (FBR tax year, July to June). Income and tax already deducted come from transactions;
-- this row only keeps the owner's answers: how each income category is taxed, and salary slip figures per year.
CREATE TABLE IF NOT EXISTS app.tax_settings (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  value       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(value::text) <= 8000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
