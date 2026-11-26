import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ERR, LATEST_VERSION, ToolInputError, date, handleBody, handleMessage, num, type ServerContext, type ToolDef } from "@/lib/mcp/protocol";
import { digestOf, looksLikeToken, newToken, tokenOf } from "@/lib/access-tokens";

const ran: string[] = [];
const tools: ToolDef[] = [
  { name: "look", title: "Look", description: "reads", inputSchema: { type: "object", properties: {} }, run: async () => { ran.push("look"); return { text: "42" }; } },
  { name: "add", title: "Add", description: "writes", write: true, inputSchema: { type: "object", properties: {} }, run: async () => { ran.push("add"); return { text: "added" }; } },
  { name: "picky", title: "Picky", description: "bad input", inputSchema: { type: "object", properties: {} }, run: async (a) => ({ text: String(date(a, "from")) }) },
  { name: "boom", title: "Boom", description: "fails", inputSchema: { type: "object", properties: {} }, run: async () => { throw new Error("secret detail"); } },
];
const ctx = (scope: "read" | "write"): ServerContext => ({ tools, scope, instructions: "hi", serverInfo: { name: "mizan", version: "1" } });
const call = (name: string, args: unknown = {}, scope: "read" | "write" = "read") =>
  handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, ctx(scope));

describe("MCP protocol", () => {
  it("initializes with the client's version when supported, else the latest", async () => {
    const a = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } } }, ctx("read"));
    expect(a?.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "mizan" }, instructions: "hi" });
    const b = await handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, ctx("read"));
    expect((b?.result as { protocolVersion: string }).protocolVersion).toBe(LATEST_VERSION);
  });

  it("gives notifications no reply, and a batch of only notifications no body", async () => {
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx("read"))).toBeNull();
    expect(await handleBody([{ jsonrpc: "2.0", method: "notifications/initialized" }], ctx("read"))).toBeNull();
  });

  it("hides write tools from a read-only token and refuses to run them", async () => {
    const list = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, ctx("read"));
    const names = (list?.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools.map((t) => t.name);
    expect(names).not.toContain("add");
    ran.length = 0;
    const r = await call("add", {}, "read");
    expect(r?.result).toMatchObject({ isError: true });
    expect(ran).toEqual([]);
  });

  it("lists and runs write tools for a read + write token, marking which change data", async () => {
    const list = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, ctx("write"));
    const tl = (list?.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools;
    expect(tl.find((t) => t.name === "add")?.annotations.readOnlyHint).toBe(false);
    expect(tl.find((t) => t.name === "look")?.annotations.readOnlyHint).toBe(true);
    expect(await call("add", {}, "write")).toMatchObject({ id: 7, result: { content: [{ type: "text", text: "added" }], isError: false } });
  });

  it("tells the AI about bad input, but not about internal errors", async () => {
    expect(await call("picky", { from: "yesterday" })).toMatchObject({ result: { isError: true, content: [{ text: "from must be a date like 2026-11-01" }] } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = await call("boom");
    expect(JSON.stringify(boom)).not.toContain("secret detail");
    expect(boom?.result).toMatchObject({ isError: true });
    err.mockRestore();
  });

  it("answers JSON-RPC errors for unknown methods, unknown tools and junk", async () => {
    expect((await handleMessage({ jsonrpc: "2.0", id: 1, method: "nope" }, ctx("read")))?.error?.code).toBe(ERR.methodNotFound);
    expect((await call("missing"))?.error?.code).toBe(ERR.invalidParams);
    expect((await call("look", [1, 2]))?.error?.code).toBe(ERR.invalidParams);
    expect((await handleMessage("hello", ctx("read")))?.error?.code).toBe(ERR.invalidRequest);
    expect((await handleMessage({ id: 1, method: "ping" }, ctx("read")))?.error?.code).toBe(ERR.invalidRequest);
    expect(await handleMessage({ jsonrpc: "2.0", id: "a", method: "ping" }, ctx("read"))).toEqual({ jsonrpc: "2.0", id: "a", result: {} });
  });

  it("answers each message of a batch", async () => {
    const r = await handleBody([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "look" } }], ctx("read"));
    expect(Array.isArray(r) && r.map((x) => x.id)).toEqual([1, 2]);
  });

  it("reads numbers and dates leniently but safely", () => {
    expect(num({ a: "1,250" }, "a")).toBe(1250);
    expect(num({}, "a")).toBeUndefined();
    expect(() => num({ a: "lots" }, "a")).toThrow(ToolInputError);
    expect(date({ d: "2026-11-01" }, "d")).toBe("2026-11-01");
    expect(() => date({ d: "01/11/2026" }, "d")).toThrow(ToolInputError);
  });
});

describe("access tokens", () => {
  it("makes long random tokens with a recognisable prefix", () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(looksLikeToken(a)).toBe(true);
    expect(looksLikeToken("mzn_short")).toBe(false);
    expect(looksLikeToken(`${a}x`)).toBe(false);
    expect(looksLikeToken(null)).toBe(false);
  });
  it("stores a fixed-length digest, never the token", () => {
    const t = newToken();
    expect(digestOf(t)).toHaveLength(32);
    expect(digestOf(t).equals(digestOf(t))).toBe(true);
    expect(digestOf(t).toString("utf8")).not.toContain(t.slice(4));
  });
  it("prefers the Authorization header over the token in the address", () => {
    const req = (h?: string) => new Request("https://x/api/mcp", { method: "POST", headers: h ? { authorization: h } : {} });
    expect(tokenOf(req("Bearer mzn_abc"), "mzn_path")).toBe("mzn_abc");
    expect(tokenOf(req(), "mzn_path")).toBe("mzn_path");
    expect(tokenOf(req("Basic zzz"), null)).toBeNull();
    expect(tokenOf(req("mzn_bare"), null)).toBe("mzn_bare");
  });
});
