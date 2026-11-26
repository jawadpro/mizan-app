import { mcpMethodNotAllowed, mcpOptions, mcpPost } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** The same MCP server, with the token in the address, for connector forms that only take a URL (ChatGPT, Claude). */
export const POST = async (req: Request, ctx: Ctx) => mcpPost(req, (await ctx.params).token);
export const GET = mcpMethodNotAllowed;
export const DELETE = mcpMethodNotAllowed;
export const OPTIONS = mcpOptions;
