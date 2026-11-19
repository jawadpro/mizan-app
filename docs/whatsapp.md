# WhatsApp assistant

Ask Mizan about your money from WhatsApp, and split bills by name:

> **You:** food this month
> **Mizan:** *Food & dining* this month: *Rs 3,000* across 1 payment. The 16 days before: Rs 2,500 (+20%).
>
> **You:** split 3000 dinner with Ali and Sara
> **Mizan:** *Split this?* Payment: Rs 3,000 · Kolachi · 15 Nov. Ali owes Rs 1,000 · Sara owes Rs 1,000 · Your part: Rs 1,000. Reply *YES* to save or *NO* to cancel.
>
> **You:** yes
> **Mizan:** ✅ Split saved. Ali and Sara owe you Rs 2,000 in total.

Everything is set up in **Settings › WhatsApp**. Nothing goes in environment variables.

## Two modes

| | Free command mode | AI chat |
|---|---|---|
| Needs | Nothing extra | An Anthropic API key |
| Understands | Set phrases (below) | Any question, in English, Urdu or Roman Urdu |
| Cost | Free | Paid to Anthropic per message. Haiku is a fraction of a rupee, Opus a few rupees |

Without a key, the bot answers these (send **help** to see them):

- **Spending:** `summary`, `spending last month`, `food this month`, `petrol in october`, `last 5 payments`, `find daraz`
- **How you're doing:** `how am I doing`, `balance`, `net flow this month`, `remittance this month`, `salary last month`
- **Splits:** `split 3000 dinner with Ali and Sara`, `split 5000 with Ali (not me)`, `who owes me`, `what does Ali owe`, `Ali paid`
- **Add:** `spent 500 on lunch`
- **Invoices:** `invoice for the last payment`, `invoice kolachi`, `invoices for the last 3 payments`, `invoices this month`

If the AI can't be reached, the bot falls back to command mode, so it keeps answering.

**Changes always wait for YES.** A split, a new expense or marking someone as paid is shown first and only saved
when you reply YES (or ok, haan, 👍). Anything else cancels it. A waiting change expires after 15 minutes.

**Splits by name.** "Ali" is matched to someone you've split with before ("Ali Raza"). When the name fits two people,
the bot asks which. Mizan looks for the bank payment of that amount from the last week and splits it. If there
isn't one, it adds the payment (and says so before you confirm).

**Invoices as pictures.** Ask for one invoice or several (up to 10 at a time) and each comes back as an image, the
same one the app's Share button makes, with a one-line caption. Bank charges and tax deducted on a transfer are shown
in their own box and never added to the amount, and they never get an invoice of their own.

## Set it up

You need a free Meta developer account and a phone number that isn't already on WhatsApp (Meta gives you a free
test number to start with).

1. **Create the app.** At [developers.facebook.com](https://developers.facebook.com/apps) create an app of type
   *Business*, then add the **WhatsApp** product.
2. **Copy the IDs.** Under **WhatsApp › API Setup**, copy the **Phone number ID** into Mizan. While you test with
   Meta's test number, add your own WhatsApp number as a recipient there.
3. **Get a permanent token.** The token on the API Setup page stops working after a day. In
   [Business settings](https://business.facebook.com/settings) › **System users**, add a system user, give it the app
   and your WhatsApp account, and generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`. Paste it into **Access token**.
4. **App secret.** From **App settings › Basic**, copy the **App secret** into Mizan. Mizan uses it to check that
   every message really comes from Meta. Press **Save** (Mizan asks for your passphrase).
5. **Webhook.** Under **WhatsApp › Configuration › Webhook**, paste the **Webhook address** and **Verify token** shown
   in Mizan, press **Verify and save**, then **Manage** and subscribe to **messages**.
6. **Link your number.** In Mizan, tap **Link a number**. From your WhatsApp, send the message it shows
   (`link ABCD-2345`) to the bot's number. Mizan confirms, and that number can now chat with it. Use **Test** to check
   that sending works.
7. **Optional: AI chat.** Create a key at [console.anthropic.com](https://console.anthropic.com), set a monthly spend
   limit there, and paste the key into **Anthropic API key**. Pick a model: Haiku is cheapest, Opus is smartest.

To go live with your own number instead of Meta's test number, add it under **WhatsApp › API Setup** and follow
Meta's verification steps.

## Privacy and security

- **Only linked numbers get answers.** A number is linked with a single-use code that lasts 15 minutes. A stranger
  messaging the bot is told the number isn't linked, at most once every few hours, and sees nothing else. Unlink a
  number in Settings and it stops at once.
- **Signed webhooks.** Every incoming message must carry Meta's signature made with your app secret. Anything else is
  refused.
- **Keys are encrypted** in your database (AES-256-GCM, keyed from the session secret) and only their last four
  characters are ever shown. Saving them asks for your passphrase.
- **What leaves your server.** Your messages and the bot's replies go through Meta's WhatsApp servers. With AI chat on,
  your question and the figures the bot looks up for it (totals, payee names, amounts) are sent to Anthropic to write
  the answer. Anthropic doesn't train on API data. In free command mode nothing goes to an AI.
- **Short memory.** The last few messages of a chat are kept for six hours, so follow-ups like "and last month?"
  work. They are deleted after a day.
- **Rate limits.** At most 60 messages an hour per number, and linking codes are limited per sender.

## Costs

- **WhatsApp:** replies to messages you send are free. Mizan never starts a conversation, so Meta shouldn't charge
  you.
- **Anthropic** (only with AI chat): billed per message. These are rough estimates for short questions with a
  couple of lookups each: about Rs 0.3 per question on Haiku, Rs 5 on Sonnet, and Rs 8 to 10 on Opus. Set a spend
  limit in the Anthropic console.

## Settings in the environment instead

Each setting can also come from the server's environment, which wins over the saved value:
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
`ANTHROPIC_API_KEY` and `MIZAN_AI_MODEL` (`claude-haiku-5-5`, `claude-sonnet-5-5` or `claude-opus-5-5`).
`WHATSAPP_GRAPH_VERSION` picks the Graph API version (default `v23.0`).
