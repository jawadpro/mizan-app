# Mizan

Mizan is a private, single-owner personal finance app. It turns your bank's SMS alerts into a categorised
expense record, keeps your bank balance up to date, tracks money you set aside (for charity, a goal, a purchase),
helps you calculate zakat, and backs everything up to your Google Drive.

It is built with Next.js, TypeScript and PostgreSQL, and runs on free tiers of [Vercel](https://vercel.com) and
[Neon](https://neon.tech). Amounts are in PKR and dates follow Asia/Karachi time.

## Features

- **Automatic SMS import.** An iPhone Shortcuts automation forwards each bank alert to Mizan, which reads the amount,
  direction, date, counterparty and category. Anything ambiguous waits in a **Review inbox** instead of being guessed.
- **Live bank balance.** Set it once; every transaction after that moves it. Editing or deleting a transaction corrects it.
- **Dashboard.** Spending trend, spending by category and top recipients for any period.
- **Transactions.** Search, filter, edit, add cash spending by hand, and export to CSV.
- **Recipients.** Everyone named in an alert ("from AYESHA KHAN", "at FOODPANDA") gets running sent and received totals.
- **Set-asides.** Rules such as "10% of every remittance for Charity". Mizan tracks what has built up and what you paid out.
- **Zakat.** Checks today's gold and silver prices against nisab, works out what is due, and keeps a record per year.
- **Push notifications.** Get notified when an alert needs your review (installed web app on iPhone, or any modern browser).
- **Backups.** Nightly backup to a "Mizan backups" folder in your Google Drive, plus a download button.

## What you need

| Thing | Why | Cost |
| --- | --- | --- |
| GitHub account | Holds your copy of the code | Free |
| Vercel account | Hosts the app | Free (Hobby) |
| Neon account (or any Postgres 14+) | Stores your data | Free tier |
| A computer with Node.js 20+ and Git | To create your passphrase hash once | Free |
| An iPhone with the Shortcuts app | Forwards bank alerts | — |
| Google Cloud project (optional) | Google Drive backups | Free |

Setup takes about 20 minutes.

## Setup

### 1. Fork the repository

Click **Fork** at the top of this page, then **Create fork**. You will deploy your own fork.

### 2. Create the database

1. Sign in to [Neon](https://console.neon.tech) and create a project (any name, nearest region).
2. Open **Connection details**, turn on **Pooled connection**, and copy the connection string.
   It looks like `postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.
   This is your `DATABASE_URL`.

You don't create any tables yourself: the migrations in `migrations/` run automatically on every Vercel build.

### 3. Create your passphrase hash and secrets

On your computer:

```bash
git clone https://github.com/<your-username>/mizan-app.git
cd mizan-app

# Your sign-in passphrase (12+ characters). Prints a line starting with scrypt$ ...
node scripts/hash-password.mjs 'a long passphrase only you know'

# Three random secrets: SESSION_SECRET, SMS_INGEST_TOKEN and CRON_SECRET
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

No `openssl`? Use `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` instead.
Only the hash is stored; remember the passphrase itself, because it is what you type to sign in.

### 4. Deploy on Vercel

1. In Vercel, choose **Add New → Project** and import your `mizan-app` fork. Leave the build settings as detected (Next.js).
2. Open **Environment Variables** and add at least the required ones from the table below.
3. Click **Deploy**. The build runs `npm run vercel-build`, which applies the database migrations and then builds the app.
4. Open the deployment, sign in with your passphrase, and tick **Remember me** on your own devices.

### Environment variables

All variables are server-side only. Set them in Vercel under **Project → Settings → Environment Variables**,
then redeploy for changes to take effect. `.env.example` lists the same variables for local development.

| Name | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Pooled Postgres connection string with `sslmode=require` |
| `ADMIN_PASSWORD_HASH` | Yes | The `scrypt$...` line from `node scripts/hash-password.mjs` |
| `SESSION_SECRET` | Yes | 32+ random characters. Signs session cookies, CSRF tokens and SMS fingerprints |
| `SMS_INGEST_TOKEN` | Yes | 32+ random characters. The bearer token your iPhone Shortcut sends |
| `SMS_TRUSTED_SENDERS` | Usually | Comma-separated SMS sender IDs or contact names of your bank, e.g. `MYBANK,8222` |
| `SMS_OWN_NAMES` | No | Your name as the bank prints it, so transfers between your own accounts aren't counted as spending |
| `SMS_AUTO_IMPORT` | No | Set to `false` to send every alert to the Review inbox first. Default `true` |
| `CRON_SECRET` | For backups | 32+ random characters. Vercel Cron sends it to `/api/cron/backup` every night |
| `GOOGLE_CLIENT_ID` | For backups | Google OAuth client ID (see below) |
| `GOOGLE_CLIENT_SECRET` | For backups | Google OAuth client secret |
| `VAPID_PUBLIC_KEY` | For push | From `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | For push | From the same command |
| `VAPID_SUBJECT` | For push | A contact URI, e.g. `mailto:you@example.com` |

Rotating `SESSION_SECRET` signs every device out and changes future SMS fingerprints. To change the passphrase,
generate a new hash, replace `ADMIN_PASSWORD_HASH` and redeploy.

### 5. Set your starting balance

On the dashboard, tap the balance card and enter the balance your bank app shows right now. From that moment on,
income and remittances add to it and expenses subtract from it. You can re-set it at any time.

## iPhone Shortcut: forward bank alerts

The app's **More → SMS setup** page shows your exact endpoint, `https://<your-app>.vercel.app/api/sms`.

1. Open **Shortcuts → Automation → + → Message**.
2. Set **Sender** to your bank's alert sender or contact, and **Message Contains** to `PKR` (or `Rs`).
   Choose **Run Immediately**, then **Next → New Blank Automation**.
3. Add **Current Date**, then **Format Date** with Date Format **ISO 8601** and **Include Time** on.
4. Add **Get Contents of URL** with your endpoint. Under **Show More**, set Method to **POST**.
5. Add two headers:
   - `Authorization` = `Bearer <your SMS_INGEST_TOKEN>`
   - `Content-Type` = `application/json`
6. Set Request Body to **JSON** with three text fields:
   - `sender` = Shortcut Input → **Sender**
   - `text` = Shortcut Input → **Content**
   - `receivedAt` = **Formatted Date**
7. Optional: add **Show Notification** with **Contents of URL**, so each alert shows "imported", "review" or "duplicate".

Make sure the sender your iPhone reports (the number or the contact name) is in `SMS_TRUSTED_SENDERS`.
Alerts from senders that aren't trusted are never imported automatically; they wait in the Review inbox.

### Test it without a phone

```bash
curl -X POST https://<your-app>.vercel.app/api/sms \
  -H "Authorization: Bearer $SMS_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sender":"MYBANK","text":"PKR 2,450.00 debited from A/C ****4821 on 03-Nov-2026 14:22 at FOODPANDA. Avl Bal PKR 82,851.17","receivedAt":"2026-11-03T14:22:31+05:00"}'
```

Use a date within the last few days, and a `sender` that is in `SMS_TRUSTED_SENDERS`.

| Status | Meaning |
| --- | --- |
| `201` | Imported as a transaction |
| `202` | Sent to the Review inbox (the response includes the reason) |
| `200` | Duplicate, or ignored (OTPs and promotions are dropped without storing anything) |
| `401` | Missing or wrong token |
| `400` / `413` / `415` | Invalid body, body over 4 KB, or wrong content type |
| `429` | Rate limited |

### Which bank's alerts work?

The parser in `src/lib/sms/parser.ts` was written and tested against MCB (Pakistan) alert wording, such as
"PKR 1,000.00 received via IBFT from ... on 18-10-2026 19:59". Other banks with similar wording usually work once
their sender ID is in `SMS_TRUSTED_SENDERS`. Alerts it can't read cleanly go to the Review inbox, where you confirm
them by hand. To support another format, add sample alerts to `tests/sms-parser.test.ts` and adjust the parser.

An alert is held for review instead of imported when it:

- comes from a sender that isn't trusted
- mentions a reversal, refund, pending or failed payment, or a foreign currency
- has no amount, more than one amount, or no clear debit or credit wording
- is an outgoing transfer (so you can add any bank charge before confirming)
- has a date in the future or more than 60 days old

## Optional: push notifications

1. Run `npx web-push generate-vapid-keys` and add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in Vercel. Redeploy.
2. On iPhone, open the app in Safari, tap **Share → Add to Home Screen**, and open Mizan from the Home Screen icon.
3. Open **Review inbox** (under **More** on a phone), and in the **Notifications** card tap **Turn on**, then **Send test**.

## Optional: Google Drive backups

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Google Drive API**.
2. Configure the OAuth consent screen (External, add yourself as a test user).
3. Create an **OAuth client ID** of type **Web application** with the authorised redirect URI
   `https://<your-app>.vercel.app/api/backup/google/callback`.
4. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `CRON_SECRET` in Vercel and redeploy.
5. In Mizan, open **More → Backups → Connect Google Drive**.

Mizan uses the `drive.file` scope, so it can only see files it created. The schedule in `vercel.json` runs a backup
every night at 22:00 UTC. **Download a copy** saves the same backup file to your device at any time.

## Local development

```bash
npm ci
cp .env.example .env.local   # fill in the values
npm run migrate              # applies migrations/*.sql
npm run dev                  # http://localhost:3000
npm test                     # unit tests (SMS parser, money, zakat, ...)
npm run typecheck
BASE_URL=http://localhost:3000 MIZAN_PASSWORD='your passphrase' SMS_INGEST_TOKEN=... npm run e2e
```

`npm run e2e` creates and then deletes its own test records. Point it at a test database, not your real one.

## Security and privacy

- One owner, one passphrase, stored only as a scrypt hash. Sessions use HMAC-signed, HttpOnly, Secure cookies.
- Every private page and API route checks the session on the server. Every write needs a CSRF token and a same-origin request.
- `/api/sms` needs the bearer token, is rate limited per IP, and rejects bodies over 4 KB.
- SMS text is treated only as data and matched with fixed patterns. Imported transactions don't keep the raw message;
  review items keep a redacted copy (long numbers and balances masked) that is deleted once resolved.
- Tokens and message bodies are never logged.
- Amounts are stored as integer paisa, so there are no rounding errors.

## Limitations

- Single user. There is no account recovery other than setting a new `ADMIN_PASSWORD_HASH`.
- Built around PKR, Asia/Karachi time and MCB-style alert wording.
- Re-running the Shortcut on an alert that has no reference number or time, a minute or more later, can create a duplicate.
- Free Neon databases pause when idle, so the first request after a pause is slower.
- Rate limits are per IP and fixed-window: fine for one person, not a DDoS defence.
