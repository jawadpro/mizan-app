import "server-only";
import { looksLikeToken, tokenOf, verifyToken } from "../access-tokens";
import { loadConfig } from "../config";
import { ConfigError } from "../env";
import { setDisplayCurrency } from "../money";
import { clientIp, rateLimit } from "../ratelimit";
import { getPrefs } from "../repo";
import { ERR, handleBody } from "./protocol";
import { MCP_TOOLS, serverInstructions } from "./tools";

// The HTTP side of Mizan's MCP server, shared by /api/mcp (token in an Authorization header) and
// /api/mcp/<token> (token in the address, for apps whose connector form only takes a URL).

const MAX_BODY = 64 * 1024;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

function out(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { "content-type": "application/json; charset=utf-8" }), "cache-control": "no-store", ...CORS, ...extra },
  });
}
const rpcError = (status: number, code: number, message: string, extra: Record<string, string> = {}) =>
  out({ jsonrpc: "2.0", id: null, error: { code, message } }, status, extra);

const UNAUTHORIZED = { "www-authenticate": 'Bearer realm="mizan", error="invalid_token"' };

async function readBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return { ok: false, res: rpcError(413, ERR.invalidRequest, "Request too large") };
  const buf = await req.arrayBuffer().catch(() => null);
  if (!buf) return { ok: false, res: rpcError(400, ERR.parse, "Unreadable body") };
  if (buf.byteLength > MAX_BODY) return { ok: false, res: rpcError(413, ERR.invalidRequest, "Request too large") };
  try {
    return { ok: true, body: JSON.parse(Buffer.from(buf).toString("utf8")) };
  } catch {
    return { ok: false, res: rpcError(400, ERR.parse, "Body is not valid JSON") };
  }
}

/** The app's name from an initialize message, kept on the token so Settings shows what used it. */
function clientName(body: unknown): string | null {
  const first = Array.isArray(body) ? body[0] : body;
  const info = (first as { method?: string; params?: { clientInfo?: { name?: unknown } } })?.method === "initialize" ? (first as { params?: { clientInfo?: { name?: unknown } } }).params?.clientInfo?.name : null;
  return typeof info === "string" ? info.replace(/[^\w .@/-]/g, "").slice(0, 80) || null : null;
}

export async function mcpPost(req: Request, pathToken?: string | null): Promise<Response> {
  try {
    await loadConfig();
    const raw = tokenOf(req, pathToken);
    const ip = clientIp(req);
    // Wrong or missing tokens are limited per address, so nobody can try tokens at speed.
    if (!looksLikeToken(raw)) {
      if (!(await rateLimit(`mcp-bad:${ip}`, 30, 600))) return rpcError(429, ERR.invalidRequest, "Too many attempts. Try again later.");
      return rpcError(401, ERR.invalidRequest, "Missing or invalid Mizan access token. Make one in Mizan › Settings › AI apps.", UNAUTHORIZED);
    }
    const parsed = await readBody(req);
    if (!parsed.ok) return parsed.res;
    const token = await verifyToken(raw, clientName(parsed.body));
    if (!token) {
      if (!(await rateLimit(`mcp-bad:${ip}`, 30, 600))) return rpcError(429, ERR.invalidRequest, "Too many attempts. Try again later.");
      return rpcError(401, ERR.invalidRequest, "This Mizan access token was revoked or doesn't exist.", UNAUTHORIZED);
    }
    if (!(await rateLimit(`mcp:${token.id}`, 120, 60))) return rpcError(429, ERR.invalidRequest, "Too many requests. Slow down a little.", { "retry-after": "60" });
    const prefs = await getPrefs();
    setDisplayCurrency(prefs.currency);
    const result = await handleBody(parsed.body, {
      tools: MCP_TOOLS,
      scope: token.scope,
      instructions: serverInstructions(),
      serverInfo: { name: "mizan", title: "Mizan", version: "1.0.0" },
    });
    return result === null ? out(null, 202) : out(result);
  } catch (e) {
    if (e instanceof ConfigError) return rpcError(503, ERR.internal, "Mizan isn't fully set up yet");
    console.error("[mizan] mcp request failed", (e as Error)?.name, (e as { code?: string })?.code ?? "");
    return rpcError(500, ERR.internal, "Something went wrong in Mizan");
  }
}

/** Stateless server: no event stream to open (GET) and no session to end (DELETE). */
export const mcpMethodNotAllowed = () => rpcError(405, ERR.invalidRequest, "Mizan's MCP server takes POST requests only", { allow: "POST, OPTIONS" });
export const mcpOptions = () => new Response(null, { status: 204, headers: { ...CORS, "access-control-max-age": "86400" } });
