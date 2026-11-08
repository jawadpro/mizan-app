-- Settings the setup page creates, so a new install only needs DATABASE_URL in its environment.
-- Environment variables still win: an install configured with SESSION_SECRET, ADMIN_PASSWORD_HASH,
-- SMS_INGEST_TOKEN or VAPID keys keeps using them, and this table stays empty.
CREATE TABLE IF NOT EXISTS app.config (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  session_secret text CHECK (session_secret IS NULL OR char_length(session_secret) BETWEEN 32 AND 200),
  password_hash  text CHECK (password_hash IS NULL OR char_length(password_hash) BETWEEN 20 AND 300),
  sms_token      text CHECK (sms_token IS NULL OR char_length(sms_token) BETWEEN 32 AND 200),
  vapid_public   text CHECK (vapid_public IS NULL OR char_length(vapid_public) <= 200),
  vapid_private  text CHECK (vapid_private IS NULL OR char_length(vapid_private) <= 200),
  vapid_subject  text CHECK (vapid_subject IS NULL OR char_length(vapid_subject) <= 300),
  setup_done_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
