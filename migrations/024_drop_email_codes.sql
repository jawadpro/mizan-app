-- Email codes for new devices were tried in a preview and dropped before release. A database that ran the
-- earlier 023 has these tables, all unused and empty of anything needed; remove them.
DROP TABLE IF EXISTS app.email_codes;
DROP TABLE IF EXISTS app.trusted_devices;
DROP TABLE IF EXISTS app.security;
ALTER TABLE app.sessions DROP COLUMN IF EXISTS device_id;
