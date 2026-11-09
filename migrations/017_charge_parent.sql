-- A bank charge or tax added on a transfer remembers which transfer it belongs to,
-- so the activity list can show it tucked under that transfer. If the transfer is deleted
-- the charge stays as an ordinary expense.
ALTER TABLE app.transactions ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES app.transactions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transactions_parent_idx ON app.transactions (parent_id) WHERE parent_id IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('demo.transactions') IS NOT NULL THEN
    ALTER TABLE demo.transactions ADD COLUMN IF NOT EXISTS parent_id uuid;
  END IF;
END $$;

-- Link charges saved before this change. They were always written with the transfer's exact time and a note "Charges on transfer to <name>" / "Tax on transfer to <name>".
UPDATE app.transactions c SET parent_id = (
  SELECT t.id FROM app.transactions t
  WHERE t.occurred_at = c.occurred_at
    AND t.id <> c.id
    AND t.kind = 'expense'
    AND t.category NOT IN ('Bank charges', 'Tax deducted')
    AND (c.note IN ('Charges on transfer', 'Tax on transfer')
         OR c.note = 'Charges on transfer to ' || t.counterparty
         OR c.note = 'Tax on transfer to ' || t.counterparty)
  ORDER BY t.created_at DESC
  LIMIT 1
)
WHERE c.parent_id IS NULL
  AND c.source = 'manual'
  AND c.category IN ('Bank charges', 'Tax deducted')
  AND (c.note LIKE 'Charges on transfer%' OR c.note LIKE 'Tax on transfer%');
