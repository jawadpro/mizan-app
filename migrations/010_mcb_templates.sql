-- MCB's alert formats become editable rows in Settings > Bank messages instead of living only in code.
-- "hold" keeps a message type's alerts in the Review inbox (MCB transfers can carry a separate charge).
ALTER TABLE app.sms_templates ADD COLUMN IF NOT EXISTS hold boolean NOT NULL DEFAULT false;

-- Seed once, ahead of any rows already there. Mirrors src/lib/sms/mcb-defaults.ts.
INSERT INTO app.sms_templates (position, bank, sender, kind, category, example, payee, hold)
SELECT v.position, v.bank, v.sender, v.kind, v.category, v.example, v.payee, v.hold
FROM (VALUES
  (-100, 'MCB', 'MCB*, 6222', 'expense', NULL, 'PKR 6,392.60 was charged at NANDOS - MAIN BLVD, LAHORE PAK via MCB Debit Card 4321 on 16-10-2026 at 19:49. Helpline: 042111000622', 'NANDOS - MAIN BLVD, LAHORE PAK', false),
  (-99, 'MCB', 'MCB*, 6222', 'expense', 'Bank charges', 'PKR 250.00 plus tax has been deducted from your account as the monthly fee for SMS Alerts Service on branch transactions', '', false),
  (-98, 'MCB', 'MCB*, 6222', 'income', NULL, 'PKR 1,000.00 received via IBFT from ALI RAZA KHAN A/C*9012 on 18-10-2026 19:59. Tx ID 000000123456', 'ALI RAZA KHAN', false),
  (-97, 'MCB', 'MCB*, 6222', 'income', NULL, 'PKR 500.00 received from Ali Raza Khan SadaPay in your MCB A/C*1234 via RAAST on 19-10-2026 16:35 Tx ID:112233445', 'Ali Raza Khan SadaPay', false),
  (-96, 'MCB', 'MCB*, 8222', 'expense', 'Transfers', 'PKR20,000.00 sent to ALI RAZA KHAN A/C *5678 from A/C *1234 via IBFT on 17-10-2026 03:59 Tx ID PC1100000000000001', 'ALI RAZA KHAN', true),
  (-95, 'MCB', 'MCB*, 8222', 'expense', 'Transfers', 'PKR12,000.00 sent to SARA AHMED UBL from A/C *1234 via RAAST on 17-10-2026 12:22 Tx ID PC1100000000000002', 'SARA AHMED UBL', true)
) AS v(position, bank, sender, kind, category, example, payee, hold)
WHERE NOT EXISTS (SELECT 1 FROM app.sms_templates WHERE bank = 'MCB');
