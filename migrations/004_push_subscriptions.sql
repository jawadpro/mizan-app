-- Browsers (one per phone or computer) that asked for a notification when an SMS alert needs review.
CREATE TABLE IF NOT EXISTS app.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint    text NOT NULL UNIQUE CHECK (char_length(endpoint) <= 1000),
  p256dh      text NOT NULL CHECK (char_length(p256dh) <= 200),
  auth        text NOT NULL CHECK (char_length(auth) <= 100),
  created_at  timestamptz NOT NULL DEFAULT now()
);
