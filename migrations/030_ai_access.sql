-- AI app access: personal access tokens that let an AI app (Claude, ChatGPT, Grok…) read this Mizan, and add
-- expenses when allowed, through the MCP server at /api/mcp. The owner makes and revokes them in Settings › AI apps.
-- Only a SHA-256 digest of each token is kept, so a database copy can't be used to sign in.
-- Only adds a table, so an older deployment on the same database keeps working unchanged.

CREATE TABLE IF NOT EXISTS app.access_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  token_digest   bytea NOT NULL UNIQUE,
  -- The last 4 characters, so the owner can tell tokens apart.
  hint           text NOT NULL CHECK (char_length(hint) <= 8),
  scope          text NOT NULL CHECK (scope IN ('read', 'write')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  use_count      integer NOT NULL DEFAULT 0,
  -- What the app said it was when it last connected ("claude-ai", "openai-mcp"…), for the list in Settings.
  last_client    text CHECK (last_client IS NULL OR char_length(last_client) <= 80),
  revoked_at     timestamptz
);
CREATE INDEX IF NOT EXISTS access_tokens_live_idx ON app.access_tokens (created_at DESC) WHERE revoked_at IS NULL;
