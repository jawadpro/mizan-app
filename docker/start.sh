#!/bin/sh
# Starts Mizan inside Docker: applies migrations, adds sample data for demos, then serves the app.
# With DEMO_PASSWORD set the demo signs in with it; without one (and no ADMIN_PASSWORD_HASH) it opens
# the first-run setup, like a brand-new install.
set -e
if [ -z "$ADMIN_PASSWORD_HASH" ] && [ -n "$DEMO_PASSWORD" ]; then
  ADMIN_PASSWORD_HASH="$(node scripts/hash-password.mjs "$DEMO_PASSWORD")"
  export ADMIN_PASSWORD_HASH
fi
node scripts/migrate.mjs
if [ "$SEED_DEMO" = "true" ]; then node scripts/seed-demo.mjs; fi
exec node_modules/.bin/next start -p "${PORT:-3000}" -H 0.0.0.0
