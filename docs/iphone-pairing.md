# Connecting an iPhone with a pairing code

**Connect iPhone** in the menu shows one QR code. Scanning it on the iPhone adds the Mizan Shortcut (first time only)
and pairs it. Then the page shows the second and last step: turning on the Message automation. Nothing is copied or typed by
hand. The menu item has a red dot until an iPhone is connected, and a green one after.

## How pairing works

1. Mizan makes an 8-character code (for example `8PTP-KRVR`). It works once, for 10 minutes. Mizan stores only an
   HMAC of it.
2. The iPhone gets the code by scanning the QR code (it opens `/pair#CODE`; the code stays in the `#` part, which
   browsers never send to a server), or from the **Connect this iPhone** button when Mizan is open on the iPhone. The
   button runs `shortcuts://x-callback-url/run-shortcut?name=Mizan&input=text&text=<pair link>` (current iOS needs
   the x-callback-url form).
3. The Shortcut opens `<this Mizan>/api/devices/pair?code=CODE` with **Get Contents of URL** (GET or POST; a JSON body
   `{ "code", "name" }` also works). Mizan replies:

   ```json
   { "ok": true, "endpoint": "https://<this Mizan>/api/sms", "authorization": "Bearer mzd_…", "confirm": "https://<this Mizan>/api/devices/confirm", "token": "mzd_…", "deviceId": "…" }
   ```

   The Shortcut saves that reply on the iPhone and sends each alert to `endpoint` with the `Authorization` header set
   to `authorization`. Because the address comes from this reply, the same shared Shortcut works with any Mizan.
4. Right after saving, the Shortcut calls `confirm` (GET or POST, no body) with that `Authorization` header. Only
   then does Mizan show the iPhone as connected. Any later alert or test run confirms it too, so a Shortcut without
   this step still connects the first time you run it by hand.
5. Until it's confirmed, opening the pair link again within the 10 minutes replaces the unconfirmed pairing. So a link
   preview, a browser or a Shortcut run that fails before saving can't use up the code. Once confirmed, the code is
   spent.
6. Each iPhone has its own token. Mizan keeps only its SHA-256 digest. **Remove** stops it at once; **Reconnect**
   gives the iPhone a new token, and the old one stops working once the iPhone confirms the new one. Up to 5 iPhones
   can be connected.

Running the paired Shortcut by hand sends a test alert with `"test": true`: Mizan reads it and saves nothing. It's
optional; the app doesn't wait for it.

## Import queued messages

With no internet, the Shortcut saves each bank alert as a JSON file in its queue folder. **Review inbox › Import
queued messages** (shown only on the iPhone) starts an import and opens the Shortcut with the text
`mizan-import:<id>`. The Shortcut sends each queued alert to `/api/sms` as usual, adding `"importRun"` set to that
input as it is (`mizan-import:<id>` or just `<id>`),
deletes the file once Mizan has accepted it, and finally sends `{ "importRun": "mizan-import:<id>", "finished": true }`. Mizan
replies with a `message` such as "14 queued messages: 12 imported, 2 already in Mizan." for the Shortcut to show,
and the app shows the same once you're back. Mizan stores only the counts.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `MIZAN_SHORTCUT_URL` | the shared Mizan Shortcut on iCloud (`DEFAULT_SHORTCUT_URL` in `src/lib/paired-devices.ts`) | The **Get the Shortcut** link. To publish a new Shortcut version, change that one constant or set this variable. |
| `MIZAN_SHORTCUT_NAME` | `Mizan` | The Shortcut name the **Connect this iPhone** button runs. |
| `APP_URL` | the address the request came in on | The address handed to the iPhone, if people reach Mizan on a different one. |

## The older Shortcut

The app no longer shows the URL and SMS token for setting up a Shortcut by hand. A Shortcut already set up that way
keeps working: `/api/sms` still accepts the SMS token.

## Database

`migrations/026_iphone_pairing.sql` only adds three tables (`app.paired_devices`, `app.pairing_codes`, `app.import_runs`). It runs with
the other migrations on a production deploy. Vercel preview builds skip migrations unless `MIGRATE_ON_PREVIEW=1`, so
a branch or pull request never changes a database it shares with the live app.
## Building the Mizan Shortcut

One Shortcut does four jobs. It looks at what it was given and picks one:

| What it receives | Comes from | What it does |
|---|---|---|
| A link containing `/api/devices/pair` | **Connect this iPhone** in Mizan | Pairs: saves this Mizan's address and this iPhone's key |
| Text starting with `mizan-import:` | **Import queued messages** in Mizan | Sends every alert in the queue folder, then reports how many were imported |
| A bank SMS | The Message automation | Sends it to Mizan; with no internet, saves it to the queue folder |
| Nothing | You tap it in Shortcuts | Sends a test alert (nothing is saved) |

You can edit the shared **Mizan** Shortcut or your existing **Expense Manager** Shortcut. The app opens the Shortcut by
name, `Mizan` by default. To keep the name **Expense Manager**, set `MIZAN_SHORTCUT_NAME=Expense Manager` on Vercel and
redeploy, or just rename the Shortcut to `Mizan`.

Before you start, in the Shortcut's details (the **ⓘ** button), set **Receive** to *Text* and *Messages*, and
**If there's no input** to *Continue*.

### Step 1. Pairing (top of the Shortcut)

1. **If** *Shortcut Input* **contains** `/api/devices/pair`
2. ↳ **Get Contents of URL**: *Shortcut Input* (method GET)
3. ↳ **Save File**: *Contents of URL* → folder `Shortcuts/Mizan`, name `device.json`. Turn **Ask Where to Save** off and
   **Overwrite If File Exists** on.
4. ↳ **Get Dictionary Value** `confirm` from *Contents of URL*, then **Get Contents of URL**: *Dictionary Value*,
   method POST, Header `Authorization` = *Dictionary Value* `authorization` (from *Contents of URL*). This tells Mizan
   the key is saved; until then Mizan shows "Waiting for the iPhone to save its key".
5. ↳ **Show Notification**: `This iPhone is connected to Mizan.`
6. ↳ **Stop This Shortcut**
7. **End If**

### Step 2. Read the saved address and key (right below Step 1)

1. **Get File** `Shortcuts/Mizan/device.json` (turn **Error If Not Found** off)
2. **Get Dictionary from Input**
3. **Get Dictionary Value** `endpoint` → **Set Variable** `Endpoint`
4. **Get Dictionary Value** `authorization` (from the same dictionary) → **Set Variable** `Auth`

Every request below is **Get Contents of URL** with URL = `Endpoint`, Method **POST**, Header `Authorization` = `Auth`,
Request Body **JSON**.

> If you'd rather keep your typed URL and SMS token for now: set `Endpoint` to your `…/api/sms` URL and `Auth` to
> `Bearer <your SMS token>` instead. Everything below still works.

### Step 3. Import queued messages (new)

Every action in this step goes **inside** the If, between **If** and **End If**.

1. Add **If**. Tap *Input* and pick **Shortcut Input**. Tap the condition and pick **begins with**, then type
   `mizan-import:`
2. Add **Get Contents of Folder**. Tap *Folder* and pick your queue folder (the one the Shortcut saves to when
   offline, e.g. `Shortcuts/Mizan/queue`).
3. Add **Repeat with Each**. It uses *Contents of Folder* by itself. Inside the repeat, add:
   1. **Get Dictionary from Input**. Tap *Input* and pick **Repeat Item**.
   2. **Get Contents of URL**. URL = `Endpoint`, Method **POST**, add Header `Authorization` = `Auth`, Request Body
      **JSON** with four Text fields:
      - `sender` = *Dictionary Value* `sender` (tap the field, pick **Select Variable** › *Dictionary*, then tap it
        and type the key `sender`; same for the next two)
      - `text` = *Dictionary Value* `text`
      - `receivedAt` = *Dictionary Value* `receivedAt`
      - `importRun` = **Shortcut Input** (just pick the variable; send it exactly as it is)
   3. **Get Dictionary Value**: key `status`, from *Contents of URL*. Mizan sends `status` only when it accepted
      the alert.
   4. **If** *Dictionary Value* **has any value** → **Delete Files**: *Repeat Item* → **End If**
4. After **End Repeat**, add **Get Contents of URL** once more: URL = `Endpoint`, POST, Header `Authorization` =
   `Auth`, Request Body **JSON** with two fields:
   - `importRun` (Text) = **Shortcut Input**
   - `finished` (Boolean) = **True**
5. **Get Dictionary Value**: key `message`, from *Contents of URL* → **Show Notification**: *Dictionary Value*
6. **Stop This Shortcut**
7. **End If** (Shortcuts adds this one for you)

A file is deleted only after Mizan accepted it, so a failed send stays in the queue for next time. Mizan skips an alert
it already has, so sending one twice is safe. When you go back to Mizan, it shows for example
"14 queued messages: 12 imported, 2 already in Mizan."

If your queue files use other key names than `sender`, `text` and `receivedAt`, use those names in 4.2.
`receivedAt` must be a date with time and time zone, e.g. `2026-11-13T18:35:00+05:00` (**Format Date** → ISO 8601).

### Step 4. Run by hand: connection test

1. **If** *Shortcut Input* **does not have any value**
2. ↳ **Get Contents of URL** (`Endpoint`, POST, `Authorization` = `Auth`), JSON body: `sender` = `MIZAN-TEST`,
   `text` = `PKR 1.00 debited from A/C ****0000 at MIZAN TEST`, `receivedAt` = *Current Date* as ISO 8601,
   `test` (Boolean) = **true**
3. ↳ **Get Dictionary Value** `message` → **Show Result**
4. ↳ **Stop This Shortcut**
5. **End If**

### Step 5. A bank SMS from the automation (your existing steps)

Keep what your Shortcut already does here: read the sender and text of the message, send them to `Endpoint` with
`Authorization` = `Auth`, and when there's no internet save the alert as a JSON file in the queue folder. The only
change is to use `Endpoint` and `Auth` from Step 2 instead of the typed URL and token.

You can delete the separate **Import Queued Messages** Shortcut once this works. It keeps working if you keep it.

### Then

1. In Shortcuts › **Settings** (or iPhone Settings › Apps › Shortcuts) › **Advanced**: turn on
   **Allow Deleting Without Confirmation**.
2. In Mizan, open **Connect iPhone** and scan the QR code.
3. Optional: run the Shortcut once by hand to send a test alert (nothing is saved). Choose **Always Allow** when iPhone asks.
4. To check the import: turn on Airplane Mode, send yourself a test, turn it off, then tap **Import queued messages** in
   Mizan's Review inbox on the iPhone.
