-- Monthly spending limits per expense category, used by the dashboard's spending check.
CREATE TABLE IF NOT EXISTS app.category_limits (
  category      text PRIMARY KEY CHECK (char_length(category) BETWEEN 1 AND 60),
  monthly_paisa bigint NOT NULL CHECK (monthly_paisa > 0 AND monthly_paisa < 100000000000000),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
