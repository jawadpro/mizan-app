-- Changing the passphrase in Settings signs out every other device: sessions issued before this time stop working.
ALTER TABLE app.config ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;
