# Monthly payments widget (iPhone)

This month's payments on your iPhone's Home Screen or Lock Screen: what's paid, what's due and what's late. Tap a
payment and the checklist opens, where you mark it paid and link the bank transaction that paid it. Mizan suggests
the likely transaction by payee, amount and date.


The widget runs in [Scriptable](https://apps.apple.com/app/scriptable/id1405459188), a free iPhone app that runs small
JavaScript files and shows them as widgets. A web app can't put widgets on the Home Screen by itself.

## Set it up

1. In Mizan, open **Monthly payments** and tap **Home Screen widget**.
2. **On a computer**, scan the QR code with the iPhone camera. It opens a page with the next three steps.
   **On the iPhone**, the steps are right there in the dialog.
3. **Get Scriptable** from the App Store.
4. **Copy the script**, open Scriptable, tap **+**, paste, tap the title at the top and name it **Mizan Payments**,
   then tap **Done**. (The script is served by your Mizan at `/widgets/mizan-payments.js`.)
5. **Connect the widget.** Scriptable opens the script with a one-time code. It saves this Mizan's address and its own
   key in the iPhone's Keychain, and Mizan shows "connected". If the button does nothing, run **Mizan Payments** in
   Scriptable and type the address and code shown in Mizan.
6. **Add it to the Home Screen.** Touch and hold the Home Screen, tap **Edit › Add Widget**, pick **Scriptable**, choose
   the medium or large size and add it. Tap the widget while it jiggles and set **Script** to **Mizan Payments** and
   **When Interacting** to **Run Script**.

Lock Screen widgets work too (rectangular, inline and circular sizes): **Customize** the Lock Screen and add a
Scriptable widget the same way.

## Using it

- **Small:** paid count, a progress bar and the next payments due.
- **Medium (3 rows) and large (9 rows), with big text and tap targets:** unpaid payments first with their status (`Due 20 Nov`, `4 days late`) and
  amount, then the paid ones.
- **Tap a payment** to open its options:
  - **Paid: link Rs 12,340 · 9 Nov · K-Electric** when Mizan found a likely match,
  - **Paid: choose the transaction…** lists that month's unlinked spending, best match first, with a search,
  - **Paid, nothing to link** for cash or another account,
  - **Skip this month**, or **Mark as not paid** to undo,
  - **Open in Mizan**.
- **Tap elsewhere on the widget** to open the whole checklist, with ‹ › to look at past months.

A part-paid payment (say school fees paid in two transfers) shows what's left, and you can link another transaction to
it. Everything you do here shows up on the Monthly payments page, and the other way round.

**Updates:** the script checks your Mizan every few hours and replaces itself when there's a newer version, so you
paste it only once. (Copies added before version 2 have to be pasted once more.)

iOS decides when widgets refresh, usually every 15 to 30 minutes, so a change can take a little while to show on the
widget. The checklist inside Scriptable is always current. Without internet the widget shows the last copy and says
"offline".

## Security

- The widget pairs like the Mizan Shortcut: a one-time code that works once, for 10 minutes. Mizan stores only a hash
  of the widget's key.
- **A widget's key can read the monthly payments checklist and mark payments, nothing else.** It can't send bank
  alerts or read other data. The endpoints accept the Mizan Shortcut's key from the same iPhone too.
- Widgets are listed in the **Home Screen widget** dialog, apart from iPhones, with their own limit of 5. **Remove**
  stops a widget's key at once.
- The script itself holds no address or key, so it's the same for everyone and safe to share.

## API

All requests take `Authorization: Bearer <device key>`.

| Request | What it does |
|---|---|
| `GET /api/widgets/monthly?month=YYYY-MM` | The checklist (default this month): `summary`, `items` with `status`, `tone`, formatted `amount`, linked transactions and `suggestion`. |
| `GET /api/widgets/monthly/<id>?month=YYYY-MM&q=…` | That month's unlinked spending to link the payment to, best match first; `q` searches name or amount. |
| `POST /api/widgets/monthly/<id>` `{ "month", "action": "paid" \| "skipped" \| "undo", "transactionId"? }` | Marks it paid (linking the transaction if given, otherwise fully paid), skips the month, or puts it back to not paid. |

Pairing: `POST /api/devices/code` with `{ "kind": "widget" }` (signed in) returns the code, `runUrl`
(`scriptable:///run/Mizan%20Payments?pair=<pair link>`) and `pairPageUrl` (`/pair/widget#CODE`). The script opens the
pair link, which replies with `kind: "widget"`, `token`, `server` and `confirm`.
