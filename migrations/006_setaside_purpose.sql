-- Set-asides can be for giving (charity) or for saving/spending, which changes how an
-- overpayment is described. "Start fresh" forgives an overpayment so future shares are not
-- used to fill it: remaining = allocated - used + forgiven.
ALTER TABLE app.set_asides ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'saving'
  CHECK (purpose IN ('giving', 'saving'));
ALTER TABLE app.set_asides ADD COLUMN IF NOT EXISTS forgiven_paisa bigint NOT NULL DEFAULT 0
  CHECK (forgiven_paisa >= 0 AND forgiven_paisa < 100000000000000);

UPDATE app.set_asides SET purpose = 'giving'
WHERE name ~* '(allah|charit|sadq|sadaq|zakat|donat|khair|fitr|qurban|masjid|mosque)';
