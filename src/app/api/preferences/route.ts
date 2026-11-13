import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { prefsPatch } from "@/lib/preferences";
import { getPrefs, updatePrefs } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession(req);
  return json({ ok: true, prefs: await getPrefs() });
});

/** PATCH with any subset of the settings; the rest stay as they are. */
export const PATCH = handle(async (req: Request) => {
  await requireSession(req);
  const parsed = prefsPatch.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, "That setting isn't valid");
  return json({ ok: true, prefs: await updatePrefs(parsed.data) });
});
