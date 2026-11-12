-- An earlier version of 020 removed the single balance row once it was copied to the first bank. Put it back
-- (from that copy), so a deployment still reading app.balance_anchor shows the balance; newer code ignores it
-- once banks exist.
INSERT INTO app.balance_anchor (id, amount_paisa, as_of, updated_at)
SELECT 1, bb.amount_paisa, bb.as_of, bb.updated_at
FROM app.bank_balances bb
WHERE bb.bank_id = (SELECT id FROM app.banks ORDER BY position, created_at LIMIT 1)
ON CONFLICT (id) DO NOTHING;
