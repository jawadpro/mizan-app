-- A monthly payment can be paid in parts (school fees in two transfers): any number of transactions per item per month.
CREATE TABLE IF NOT EXISTS app.monthly_mark_txs (
  item_id         uuid NOT NULL,
  month           date NOT NULL,
  transaction_id  uuid NOT NULL REFERENCES app.transactions(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, month, transaction_id),
  FOREIGN KEY (item_id, month) REFERENCES app.monthly_marks(item_id, month) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS monthly_mark_txs_tx_idx ON app.monthly_mark_txs (transaction_id);

-- "paid_in_full": ticked off as fully paid by hand. Until then a payment with a usual amount counts as part paid
-- while its parts add up to less than that amount.
ALTER TABLE app.monthly_marks ADD COLUMN IF NOT EXISTS paid_in_full boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'monthly_marks' AND column_name = 'transaction_id') THEN
    INSERT INTO app.monthly_mark_txs (item_id, month, transaction_id)
      SELECT item_id, month, transaction_id FROM app.monthly_marks WHERE transaction_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    -- Everything ticked off before parts existed stays paid exactly as it was.
    UPDATE app.monthly_marks SET paid_in_full = true WHERE status = 'paid';
    ALTER TABLE app.monthly_marks DROP COLUMN transaction_id;
  END IF;
END $$;
