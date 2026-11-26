# Connect Mizan to Claude, ChatGPT or Grok

Mizan has a built-in **MCP server** (Model Context Protocol), so an AI app can answer questions from your real
data, like "What did I spend on groceries last month?" or "Show my spending month by month this year", and,
if you allow it, add an expense for you ("Add 1,200 for petrol").

It works with any app that supports remote MCP servers over Streamable HTTP. Each app gets its own token, which you
make and revoke in **Settings › AI apps**. Nothing else changes: you still sign in to Mizan with your passphrase.

## 1. Make a token

1. In Mizan, open **Settings › AI apps**.
2. Type a name (for example *Claude*) and pick the access:
   - **Read-only**: look up spending, balances, transactions and splits. It can never change anything.
   - **Read + add expenses**: the same, plus the `add_expense` tool.
3. Choose **Make token** and enter your passphrase.
4. Copy the **connector address** it shows. It looks like `https://your-mizan.example.com/api/mcp/mzn_…` and is
   shown only once. It includes the token, so treat it like a password.

Mizan keeps only a SHA-256 fingerprint of each token. If you lose one, revoke it and make a new one.

## 2. Add it to your AI app

### Claude (claude.ai, desktop and mobile apps)

1. Open **Customize › Connectors** and choose **Add custom connector**.
   On a Team or Enterprise plan an Owner adds it under **Organization settings › Connectors**.
2. Name it *Mizan* and paste the connector address as the URL.
3. Leave authentication as **No sign-in** and choose **Add**.
4. In a chat, turn Mizan on under **+ › Connectors**.

Claude Code: `claude mcp add --transport http mizan https://your-mizan.example.com/api/mcp --header "Authorization: Bearer mzn_…"`

### ChatGPT

Custom MCP servers need ChatGPT's **Developer mode**, on the web app, and depend on your plan and workspace settings.

1. Open **chatgpt.com/plugins**, press **+** and choose **Add custom MCP server**.
2. Name it *Mizan* and paste the connector address as the **Server URL**.
3. Set authentication to **No authentication**. The token is already part of the address.
4. Accept the warning ("I understand and want to continue"), choose **Create as a plugin**, install it, and pick
   Mizan in a chat. ChatGPT asks you before it runs `add_expense`.

OpenAI API (Responses API): `{ "type": "mcp", "server_label": "mizan", "server_url": "https://your-mizan.example.com/api/mcp", "authorization": "mzn_…", "require_approval": "always" }`

### Grok

1. Open **grok.com/connectors**, choose **New Connector › Custom**.
2. Paste the connector address as the MCP server URL and save. No sign-in is needed.
   On Grok Business or Enterprise, a team admin may need to add the connector first.

xAI API (Responses API): add `{ "type": "mcp", "server_label": "mizan", "server_url": "https://your-mizan.example.com/api/mcp", "authorization": "Bearer mzn_…" }` to `tools`.

## What the AI can do

| Tool | What it does | Token |
| --- | --- | --- |
| `get_overview` | This month so far against your usual pace, income kept, balance, limits and warnings | read |
| `get_balances` | Bank balance, in total and per account | read |
| `spending_summary` | Spent, income, net flow, top categories and places for a period; optionally one category or payee | read |
| `spending_by_category` | Spending per category for a period, as JSON | read |
| `spending_by_month` | Spent, income, remittances and net per month, as JSON (default: last 12 months) | read |
| `cash_flow` | Money in and out and what was left | read |
| `money_in` | Income and remittances, and where they came from | read |
| `search_transactions` | Individual transactions by text, category, kind and dates, as JSON, with paging | read |
| `list_categories` | Mizan's categories, including your own | read |
| `splits_owed` | Who owes you from split bills | read |
| `add_expense` | Saves a new expense (amount, what for, category, payee, date) | read + add expenses |

Dates are Pakistan time (YYYY-MM-DD) and amounts are in the currency chosen in Settings.

## Security notes

- Every token can read your whole Mizan. Give an app a read-only token unless you want it to add expenses.
- Revoke a token in **Settings › AI apps** and the app loses access on its next request. The list shows when each
  token was last used and by which app.
- The connector address carries the token, which is what Claude's and ChatGPT's connector forms need (they take a
  URL and offer OAuth or nothing). Where an app lets you set a header, prefer the plain server address
  (`/api/mcp`) with `Authorization: Bearer mzn_…`, so the token stays out of request logs.
- Requests are limited to 120 a minute per token, and wrong tokens are limited per address.
- Text from bank messages (payee names, notes) is passed to the AI as data and the server tells it so, but an AI
  app can still be fooled by text it reads elsewhere. That's one more reason to keep writes behind a separate token.
- The AI app's provider sees what its tools return, under that provider's own privacy terms.

## For developers

- Endpoint: `POST /api/mcp` (Bearer token) or `POST /api/mcp/<token>`. Stateless Streamable HTTP: every request is
  answered with plain JSON, there is no session id and no event stream (`GET` returns 405).
- Protocol versions 2024-11-05 to 2025-11-25 are accepted. Methods: `initialize`, `ping`, `tools/list`,
  `tools/call` (plus empty `resources/list` and `prompts/list`).
- Code: `src/lib/mcp/protocol.ts` (JSON-RPC, pure and tested in `tests/mcp.test.ts`), `src/lib/mcp/tools.ts`,
  `src/lib/mcp/server.ts`, `src/lib/access-tokens.ts`, migration `030_ai_access.sql`.

Try it with the MCP Inspector: `npx @modelcontextprotocol/inspector`, transport *Streamable HTTP*, URL = your
connector address.
