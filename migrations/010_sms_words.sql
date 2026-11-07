-- The words that tell MCB alerts apart (expense, income, remittance, transfer), edited in Settings.
-- No row means the built-in defaults in src/lib/sms/keywords.ts.
CREATE TABLE IF NOT EXISTS app.sms_words (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  value       jsonb NOT NULL CHECK (octet_length(value::text) <= 8000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- app.sms_templates (message templates for other banks) is no longer used; it is left in place so nothing saved is lost.
