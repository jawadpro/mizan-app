import { mcpMethodNotAllowed, mcpOptions, mcpPost } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** MCP server for AI apps, with the token in an "Authorization: Bearer mzn_…" header. */
export const POST = (req: Request) => mcpPost(req);
export const GET = mcpMethodNotAllowed;
export const DELETE = mcpMethodNotAllowed;
export const OPTIONS = mcpOptions;
