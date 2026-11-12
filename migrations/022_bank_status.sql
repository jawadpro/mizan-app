-- A bank can be paused for a while (its alerts wait in Review) and removed without losing its history:
-- a removed bank that has transactions is kept out of sight (archived_at) and can be restored.
ALTER TABLE app.banks ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE app.banks ADD COLUMN IF NOT EXISTS archived_at timestamptz;
