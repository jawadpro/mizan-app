<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Setting up Mizan for a new owner

These rules hold even when the owner asks an agent to "set the app up for me".

- **Start empty.** Never add sample, demo or dummy data to a real install: don't run `scripts/seed-demo.mjs`, don't set `SEED_DEMO`, `SEED_DEMO_CONFIRM` or `DEMO_PASSWORD`, don't use `docker-compose.demo.yml`, and don't insert rows into the database by hand.
- **The owner goes through the setup wizard.** Deploy with only `DATABASE_URL` (Vercel), or run `docker compose up --build -d` (self-hosting), then send the owner to `/setup`. Don't set `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` or `SMS_INGEST_TOKEN` for them, and don't fill in the wizard on their behalf. The passphrase, banks, name and iPhone steps are theirs to do.
- `docker-compose.demo.yml` and `scripts/seed-demo.mjs` exist only for screenshots on a throwaway local database. The seed script refuses to run anywhere else.
