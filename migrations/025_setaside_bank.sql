-- A set-aside can belong to one bank: only money coming into that bank fills it, and it shows when that bank is
-- picked. Empty means all banks, which is how every existing set-aside stays. Bill splits need no column: a split
-- belongs to the bank of the payment that was split. Removing a bank for good puts its set-asides back on all banks.
ALTER TABLE app.set_asides ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES app.banks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS set_asides_bank_idx ON app.set_asides (bank_id) WHERE bank_id IS NOT NULL;
