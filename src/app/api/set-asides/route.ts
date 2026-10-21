import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { createSetAside, listSetAsides } from "@/lib/repo";
import { setAsideInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  requireSession(req);
  return json({ ok: true, items: await listSetAsides() });
});

export const POST = handle(async (req: Request) => {
  requireSession(req);
  const parsed = setAsideInput.safeParse(await readJson(req, 2048));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  return json({ ok: true, id: await createSetAside(parsed.data) }, 201);
});
