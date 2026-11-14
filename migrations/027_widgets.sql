-- Home-screen widgets (Scriptable on iPhone). A widget pairs like the Mizan Shortcut, with a one-time code, and gets
-- its own key. That key can read the monthly payments checklist and mark payments, nothing else: it can't send
-- bank alerts. Widgets are listed apart from iPhones and have their own limit.
ALTER TABLE app.paired_devices DROP CONSTRAINT IF EXISTS paired_devices_kind_check;
ALTER TABLE app.paired_devices ADD CONSTRAINT paired_devices_kind_check CHECK (kind IN ('shortcut', 'widget'));

ALTER TABLE app.pairing_codes ADD COLUMN IF NOT EXISTS device_kind text NOT NULL DEFAULT 'shortcut';
ALTER TABLE app.pairing_codes DROP CONSTRAINT IF EXISTS pairing_codes_device_kind_check;
ALTER TABLE app.pairing_codes ADD CONSTRAINT pairing_codes_device_kind_check CHECK (device_kind IN ('shortcut', 'widget'));
