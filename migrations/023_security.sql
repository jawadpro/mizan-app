-- Security: signed-in devices, email codes for new devices, a passphrase check before sensitive actions,
-- and a recycle bin for deleted transactions. Only adds tables, so an older deployment on the same database
-- keeps working unchanged.

-- One row per sign-in. A device signed out from Settings gets revoked_at and stops working at once.
-- confirmed_at is when the passphrase was last entered on it, for actions that ask for it again.
CREATE TABLE IF NOT EXISTS app.sessions (
  sid           text PRIMARY KEY CHECK (char_length(sid) BETWEEN 10 AND 64),
  device_id     uuid,
  user_agent    text CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  ip            text CHECK (ip IS NULL OR char_length(ip) <= 64),
  remembered    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  confirmed_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_active_idx ON app.sessions (last_seen_at DESC) WHERE revoked_at IS NULL;

-- Devices that passed an email code and asked to be remembered. They skip the code next time.
CREATE TABLE IF NOT EXISTS app.trusted_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL CHECK (char_length(token_hash) BETWEEN 20 AND 200),
  user_agent    text CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

-- Email codes waiting to be typed in (signing in on a new device, or turning email codes on).
CREATE TABLE IF NOT EXISTS app.email_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose       text NOT NULL CHECK (purpose IN ('login', 'enable')),
  code_hash     text NOT NULL,
  email         text NOT NULL CHECK (char_length(email) <= 254),
  remember      boolean NOT NULL DEFAULT true,
  attempts      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz
);

-- Email codes for new devices: on once an address is confirmed. Recovery codes are stored hashed and
-- each works once, for when the email can't arrive.
CREATE TABLE IF NOT EXISTS app.security (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email           text CHECK (email IS NULL OR char_length(email) <= 254),
  email_codes_on  boolean NOT NULL DEFAULT false,
  recovery_hashes text[] NOT NULL DEFAULT '{}',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Deleted transactions wait here for 30 days and can be put back. The row is kept as it was, with what
-- was linked to it (bill split shares, paid-back links, monthly payment marks, the charges under a transfer).
CREATE TABLE IF NOT EXISTS app.transaction_bin (
  id            uuid PRIMARY KEY,
  row           jsonb NOT NULL,
  links         jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_bin_deleted_idx ON app.transaction_bin (deleted_at DESC);
