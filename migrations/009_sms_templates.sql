-- Message templates for other banks' alerts, made from one pasted example each (Settings > Bank messages).
CREATE TABLE IF NOT EXISTS app.sms_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position    int NOT NULL DEFAULT 0,
  bank        text NOT NULL CHECK (char_length(bank) BETWEEN 1 AND 60),
  sender      text NOT NULL DEFAULT '' CHECK (char_length(sender) <= 64),
  kind        text NOT NULL CHECK (kind IN ('expense', 'income', 'remittance')),
  category    text CHECK (category IS NULL OR char_length(category) <= 60),
  example     text NOT NULL CHECK (char_length(example) BETWEEN 1 AND 1000),
  payee       text NOT NULL DEFAULT '' CHECK (char_length(payee) <= 120),
  created_at  timestamptz NOT NULL DEFAULT now()
);
