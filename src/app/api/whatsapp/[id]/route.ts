import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { HttpError, handle, json } from "@/lib/http";
import { unlinkNumber } from "@/lib/whatsapp-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Unlinks a WhatsApp number: messages from it get no answers from then on, and its chat memory is cleared. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireSession(req);
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success || !(await unlinkNumber(id.data))) throw new HttpError(404, "Number not found");
  return json({ ok: true });
});
