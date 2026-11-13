-- Security: signed-in devices, a passphrase check before sensitive actions,
-- and a recycle bin for deleted transactions. Only adds tables, so an older deployment on the same database
-- keeps working unchanged.

-- One row per sign-in. A device signed out from Settings gets revoked_at and stops working at once.
-- confirmed_at is when the passphrase was last entered on it, for actions that ask for it again.
CREATE TABLE IF NOT EXISTS app.sessions (
  sid           text PRIMARY KEY CHECK (char_length(sid) BETWEEN 10 AND 64),
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

-- Deleted transactions wait here for 30 days and can be put back. The row is kept as it was, with what
-- was linked to it (bill split shares, paid-back links, monthly payment marks, the charges under a transfer).
CREATE TABLE IF NOT EXISTS app.transaction_bin (
  id            uuid PRIMARY KEY,
  row           jsonb NOT NULL,
  links         jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_bin_deleted_idx ON app.transaction_bin (deleted_at DESC);
