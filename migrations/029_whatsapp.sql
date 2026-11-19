-- WhatsApp assistant. The owner links their own WhatsApp number(s) with a short single-use code shown in Settings;
-- after that, messages from a linked number are answered from this Mizan's data. Messages from any other number see
-- nothing. The Meta and Anthropic keys are kept encrypted in app.app_secrets, never in these tables.
-- Only adds tables, so an older deployment on the same database keeps working unchanged.

CREATE TABLE IF NOT EXISTS app.whatsapp_numbers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- International format, digits only, as WhatsApp sends it ("923001234567").
  phone            text NOT NULL CHECK (phone ~ '^[0-9]{6,20}$'),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  linked_at        timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz,
  message_count    integer NOT NULL DEFAULT 0,
  revoked_at       timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_numbers_phone_live ON app.whatsapp_numbers (phone) WHERE revoked_at IS NULL;

-- Codes the owner sends to the bot ("link ABCD-2345") to link a number. Only an HMAC of each code is kept.
CREATE TABLE IF NOT EXISTS app.whatsapp_link_codes (
  code_digest  bytea PRIMARY KEY,
  name         text CHECK (name IS NULL OR char_length(name) <= 60),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  number_id    uuid REFERENCES app.whatsapp_numbers (id) ON DELETE SET NULL
);

-- Message ids already handled, because Meta delivers a webhook again when it isn't answered in time.
CREATE TABLE IF NOT EXISTS app.whatsapp_inbox (
  message_id   text PRIMARY KEY CHECK (char_length(message_id) <= 200),
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- The last few messages of each chat, so "and last month?" makes sense. Cleared after a day.
CREATE TABLE IF NOT EXISTS app.whatsapp_turns (
  id          bigserial PRIMARY KEY,
  number_id   uuid NOT NULL REFERENCES app.whatsapp_numbers (id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  body        text NOT NULL CHECK (char_length(body) <= 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_turns_number_idx ON app.whatsapp_turns (number_id, created_at DESC);

-- A change the assistant proposed (a split, an expense, settling a share) that waits for the owner to reply YES.
CREATE TABLE IF NOT EXISTS app.whatsapp_pending (
  number_id   uuid PRIMARY KEY REFERENCES app.whatsapp_numbers (id) ON DELETE CASCADE,
  action      jsonb NOT NULL,
  summary     text NOT NULL CHECK (char_length(summary) <= 1000),
  expires_at  timestamptz NOT NULL
);
