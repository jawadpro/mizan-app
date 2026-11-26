// The Model Context Protocol, as much of it as Mizan's AI-app server needs: JSON-RPC 2.0 over "Streamable HTTP",
// answered statelessly (every POST stands alone, no session id, plain JSON replies, no server-sent events).
// That is what Claude, ChatGPT and Grok custom connectors speak. Pure, so tests can use it without a database.

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_VERSION = PROTOCOL_VERSIONS[0];

export type Scope = "read" | "write";
export type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
export type ToolResult = { text: string; isError?: boolean };
export type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** Changes data: only listed and callable with a read + write token. */
  write?: boolean;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
};
export type ServerContext = {
  tools: ToolDef[];
  scope: Scope;
  instructions: string;
  serverInfo: { name: string; title?: string; version: string };
};

type Id = string | number | null;
type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
export type RpcReply = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export const ERR = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

const reply = (id: Id, result: unknown): RpcReply => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string): RpcReply => ({ jsonrpc: "2.0", id, error: { code, message } });
const validId = (v: unknown): v is string | number => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

export const visibleTools = (ctx: Pick<ServerContext, "tools" | "scope">) => ctx.tools.filter((t) => !t.write || ctx.scope === "write");

function describe(t: ToolDef) {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false },
  };
}

/** Answers one JSON-RPC message. Returns null for a notification (no id), which gets no reply. */
export async function handleMessage(msg: unknown, ctx: ServerContext): Promise<RpcReply | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail(null, ERR.invalidRequest, "Invalid request");
  const m = msg as Rpc;
  const isNotification = !("id" in m);
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return isNotification ? null : fail(validId(m.id) ? m.id : null, ERR.invalidRequest, "Invalid request");
  if (isNotification) return null; // notifications/initialized, notifications/cancelled… nothing to do statelessly.
  if (!validId(m.id)) return fail(null, ERR.invalidRequest, "Invalid request id");
  const id = m.id;
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;

  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST_VERSION;
      return reply(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: ctx.serverInfo, instructions: ctx.instructions });
    }
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: visibleTools(ctx).map(describe) });
    case "tools/call": {
      const name = params.name;
      const args = params.arguments ?? {};
      if (typeof name !== "string") return fail(id, ERR.invalidParams, "Missing tool name");
      if (typeof args !== "object" || args === null || Array.isArray(args)) return fail(id, ERR.invalidParams, "Tool arguments must be an object");
      const tool = ctx.tools.find((t) => t.name === name);
      if (!tool) return fail(id, ERR.invalidParams, `Unknown tool: ${name}`);
      if (tool.write && ctx.scope !== "write") {
        return reply(id, { content: [{ type: "text", text: "This connection is read-only. To add expenses, make a read + write token in Mizan › Settings › AI apps and reconnect with it." }], isError: true });
      }
      try {
        const r = await tool.run(args as Record<string, unknown>);
        return reply(id, { content: [{ type: "text", text: r.text }], isError: !!r.isError });
      } catch (e) {
        // Bad input is the AI's to fix, so it hears why. Anything else stays vague and is logged without details.
        if (e instanceof ToolInputError) return reply(id, { content: [{ type: "text", text: e.message }], isError: true });
        console.error("[mizan] mcp tool failed", name, (e as Error)?.name, (e as { code?: string })?.code ?? "");
        return reply(id, { content: [{ type: "text", text: "Mizan couldn't do that just now. Try again in a moment." }], isError: true });
      }
    }
    // Asked for by some clients even though they aren't offered; an empty list is friendlier than an error.
    case "resources/list":
      return reply(id, { resources: [] });
    case "resources/templates/list":
      return reply(id, { resourceTemplates: [] });
    case "prompts/list":
      return reply(id, { prompts: [] });
    default:
      return fail(id, ERR.methodNotFound, `Method not found: ${m.method}`);
  }
}

/** Answers a POST body: one message or a batch. null means "202 Accepted, no body" (only notifications). */
export async function handleBody(body: unknown, ctx: ServerContext): Promise<RpcReply | RpcReply[] | null> {
  if (Array.isArray(body)) {
    if (!body.length) return fail(null, ERR.invalidRequest, "Empty batch");
    const out = (await Promise.all(body.slice(0, 20).map((m) => handleMessage(m, ctx)))).filter((r): r is RpcReply => r !== null);
    return out.length ? out : null;
  }
  return handleMessage(body, ctx);
}

/** Thrown by a tool for input it can't use; the message goes back to the AI so it can fix the call. */
export class ToolInputError extends Error {}

// ---- Small argument readers for tools ----

export function str(args: Record<string, unknown>, key: string, max = 200): string | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new ToolInputError(`${key} must be text`);
  return v.trim().slice(0, max) || undefined;
}

export function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ToolInputError(`${key} must be a number`);
  return n;
}

export function date(args: Record<string, unknown>, key: string): string | undefined {
  const v = str(args, key, 20);
  if (v === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new ToolInputError(`${key} must be a date like 2026-11-01`);
  return v;
}

export function oneOf<T extends string>(args: Record<string, unknown>, key: string, options: readonly T[]): T | undefined {
  const v = str(args, key, 40);
  if (v === undefined) return undefined;
  if (!(options as readonly string[]).includes(v)) throw new ToolInputError(`${key} must be one of: ${options.join(", ")}`);
  return v as T;
}
