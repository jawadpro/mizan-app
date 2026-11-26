import { z } from "zod";
import { requireConfirmed, requireSession } from "@/lib/auth";
import { MAX_TOKENS, createToken, listTokens } from "@/lib/access-tokens";
import { HttpError, errorJson, handle, json, readJson } from "@/lib/http";
import { phoneUrl } from "@/lib/paired-devices";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tokens AI apps connect with (never the tokens themselves, only their last 4 characters) and the MCP address. */
export const GET = handle(async (req: Request) => {
  await requireSession(req);
  return json({ ok: true, serverUrl: `${phoneUrl(req)}/api/mcp`, tokens: await listTokens(), maxTokens: MAX_TOKENS });
});

const input = z.object({
  name: z.string().trim().min(1, "Give it a name, e.g. Claude").max(60),
  scope: z.enum(["read", "write"]),
}).strict();

/** Makes a token. Asks for the passphrase, as it opens the whole wallet to an AI app. The token is returned only here, once. */
export const POST = handle(async (req: Request) => {
  await requireConfirmed(req);
  const parsed = input.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  if (!(await rateLimit("ai-token", 20, 3600))) return errorJson(429, "Too many new tokens in an hour. Try again later.");
  const r = await createToken(parsed.data.name, parsed.data.scope);
  if ("error" in r) throw new HttpError(409, `You can have up to ${MAX_TOKENS} tokens. Revoke one you no longer use first.`);
  const serverUrl = `${phoneUrl(req)}/api/mcp`;
  return json({ ok: true, token: r.token, row: r.row, serverUrl, connectorUrl: `${serverUrl}/${r.token}` });
});
