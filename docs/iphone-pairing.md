# Connecting an iPhone with a pairing code

**SMS setup › Connected iPhones › Connect iPhone** walks through four steps: add the Mizan Shortcut, pair, create
the Message automation, and test. Nothing is copied or typed by hand.

## How pairing works

1. Mizan makes an 8-character code (for example `8PTP-KRVR`). It works once, for 10 minutes. Mizan stores only an
   HMAC of it.
2. The iPhone gets the code by scanning the QR code (it opens `/pair#CODE`; the code stays in the `#` part, which
   browsers never send to a server), by tapping **Connect this iPhone** on the iPhone itself, or by typing it into the
   Shortcut.
3. The Shortcut opens `<this Mizan>/api/devices/pair?code=CODE` (or POSTs `{ "code", "name" }` there). Mizan replies,
   once:

   ```json
   { "ok": true, "endpoint": "https://<this Mizan>/api/sms", "authorization": "Bearer mzd_…", "token": "mzd_…", "deviceId": "…" }
   ```

   The Shortcut saves that reply on the iPhone and sends each alert to `endpoint` with the `Authorization` header set
   to `authorization`. Because the address comes from this reply, the same shared Shortcut works with any Mizan.
4. Each iPhone has its own token. Mizan keeps only its SHA-256 digest. **Remove** stops it at once; **Reconnect**
   gives the iPhone a new token and stops the old one. Up to 5 iPhones can be connected.

Running the paired Shortcut by hand sends a test alert with `"test": true`: Mizan reads it, saves nothing, and the
setup dialog shows "Connection test received".

## Settings

| Variable | Default | What it does |
|---|---|---|
| `MIZAN_SHORTCUT_URL` | the shared Mizan Shortcut on iCloud | The **Add the Shortcut** link and QR code. |
| `MIZAN_SHORTCUT_NAME` | `Mizan` | The Shortcut name the **Connect this iPhone** button runs. |
| `APP_URL` | the address the request came in on | The address handed to the iPhone, if people reach Mizan on a different one. |

## The older Shortcut

The Expense Manager Shortcut, with the URL and SMS token typed in by hand, keeps working unchanged. Its details stay
on the SMS setup page under "Using the older Shortcut".

## Database

`migrations/026_iphone_pairing.sql` only adds two tables (`app.paired_devices`, `app.pairing_codes`). It runs with
the other migrations on a production deploy. Vercel preview builds skip migrations unless `MIGRATE_ON_PREVIEW=1`, so
a branch or pull request never changes a database it shares with the live app.
