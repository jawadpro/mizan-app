-- Nightly transaction backups go straight to the owner's Google Drive; nothing is kept here
-- except the Google access token, encrypted (AES-256-GCM, key derived from SESSION_SECRET).
CREATE TABLE IF NOT EXISTS app.app_secrets (
  name        text PRIMARY KEY CHECK (char_length(name) <= 64),
  value_enc   text NOT NULL CHECK (char_length(value_enc) <= 4000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
