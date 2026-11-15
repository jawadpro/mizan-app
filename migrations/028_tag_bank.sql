-- A transaction without a bank used to count toward the bank when there was only one, and toward none once a
-- second bank was added, so the first bank's balance drifted (and a bank deleted for good handed its
-- transactions to the one left). From now on "no bank" always means cash or other, counted in no bank balance,
-- and a transaction saved while there is only one bank is filed under it.

-- 1. Repair: untagged transactions saved before a second bank existed belonged to the first bank.
WITH ordered AS (SELECT id, created_at, row_number() OVER (ORDER BY created_at, position) AS n FROM app.banks),
     first AS (SELECT id FROM ordered WHERE n = 1),
     second AS (SELECT created_at FROM ordered WHERE n = 2)
UPDATE app.transactions t SET bank_id = (SELECT id FROM first)
WHERE t.bank_id IS NULL
  AND EXISTS (SELECT 1 FROM first)
  AND (NOT EXISTS (SELECT 1 FROM second) OR t.created_at < (SELECT created_at FROM second));

-- 2. With only one bank in use, a transaction saved without a bank (the form doesn't ask) is filed under it.
CREATE OR REPLACE FUNCTION app.file_under_lone_bank() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lone uuid;
BEGIN
  IF NEW.bank_id IS NULL THEN
    SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid END INTO lone FROM app.banks WHERE archived_at IS NULL;
    NEW.bank_id := lone;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS transactions_lone_bank ON app.transactions;
CREATE TRIGGER transactions_lone_bank BEFORE INSERT ON app.transactions FOR EACH ROW EXECUTE FUNCTION app.file_under_lone_bank();
