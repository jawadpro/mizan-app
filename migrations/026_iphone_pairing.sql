-- iPhone pairing. Each iPhone gets its own token by pairing with a short, single-use code shown in Mizan, so
-- nobody copies a URL or token into a Shortcut. Mizan keeps only a SHA-256 digest of each device token and an
-- HMAC of each pairing code. Only adds tables: the SMS token and the older Shortcut keep working as before.

CREATE TABLE IF NOT EXISTS app.paired_devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  kind             text NOT NULL DEFAULT 'shortcut' CHECK (kind IN ('shortcut')),
  token_digest     bytea NOT NULL UNIQUE,
  token_hint       text NOT NULL DEFAULT '' CHECK (char_length(token_hint) <= 8),
  paired_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz,
  last_sms_at      timestamptz,
  last_test_at     timestamptz,
  revoked_at       timestamptz,
  imported_count   integer NOT NULL DEFAULT 0,
  review_count     integer NOT NULL DEFAULT 0,
  duplicate_count  integer NOT NULL DEFAULT 0,
  ignored_count    integer NOT NULL DEFAULT 0,
  failed_count     integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS paired_devices_active_idx ON app.paired_devices (revoked_at, paired_at DESC);

CREATE TABLE IF NOT EXISTS app.pairing_codes (
  code_digest  bytea PRIMARY KEY,
  device_name  text CHECK (device_name IS NULL OR char_length(device_name) <= 60),
  replaces_id  uuid REFERENCES app.paired_devices (id) ON DELETE SET NULL,
  device_id    uuid REFERENCES app.paired_devices (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);
CREATE INDEX IF NOT EXISTS pairing_codes_created_idx ON app.pairing_codes (created_at DESC);
