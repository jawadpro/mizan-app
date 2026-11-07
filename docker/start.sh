#!/bin/sh
# Starts Mizan inside Docker: applies migrations, adds sample data for demos, then serves the app.
set -e
if [ -z "$ADMIN_PASSWORD_HASH" ]; then
  ADMIN_PASSWORD_HASH="$(node scripts/hash-password.mjs "${DEMO_PASSWORD:-mizan-demo-2026}")"
  export ADMIN_PASSWORD_HASH
fi
node scripts/migrate.mjs
if [ "$SEED_DEMO" = "true" ]; then node scripts/seed-demo.mjs; fi
exec node_modules/.bin/next start -p "${PORT:-3000}" -H 0.0.0.0
