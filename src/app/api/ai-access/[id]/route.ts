import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { revokeToken } from "@/lib/access-tokens";
import { HttpError, handle, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Revokes a token: the AI app using it loses access on its next request. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success || !(await revokeToken(id.data))) throw new HttpError(404, "Token not found");
  return json({ ok: true });
});
