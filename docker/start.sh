#!/bin/sh
# Starts Mizan inside Docker: applies migrations, then serves the app. A normal install opens the
# setup wizard. Only docker-compose.demo.yml sets DEMO_PASSWORD and SEED_DEMO, for a sample-data demo.
set -e
if [ -z "$ADMIN_PASSWORD_HASH" ] && [ -n "$DEMO_PASSWORD" ]; then
  ADMIN_PASSWORD_HASH="$(node scripts/hash-password.mjs "$DEMO_PASSWORD")"
  export ADMIN_PASSWORD_HASH
fi
node scripts/migrate.mjs
if [ "$SEED_DEMO" = "true" ]; then node scripts/seed-demo.mjs; fi
exec node_modules/.bin/next start -p "${PORT:-3000}" -H 0.0.0.0
