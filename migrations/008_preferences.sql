-- App settings chosen on the Settings page (feature switches), shared by every device.
CREATE TABLE IF NOT EXISTS app.preferences (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  value       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(value::text) <= 4000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
