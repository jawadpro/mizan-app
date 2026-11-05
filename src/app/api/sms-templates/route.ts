import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { listSmsTemplates, saveSmsTemplates } from "@/lib/repo";
import { compileTemplate } from "@/lib/sms/templates";
import { smsTemplatesInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  requireSession(req);
  return json({ ok: true, items: await listSmsTemplates() });
});

/** PUT { items: [...] } saves the whole list. Every example must turn into a working pattern. */
export const PUT = handle(async (req: Request) => {
  requireSession(req);
  const parsed = smsTemplatesInput.safeParse(await readJson(req, 64 * 1024));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Please check the message types");
  for (const [i, t] of parsed.data.items.entries()) {
    const c = compileTemplate(t);
    if (!c.ok) throw new HttpError(400, `Message type ${i + 1} (${t.bank}): ${c.error}`);
  }
  return json({ ok: true, items: await saveSmsTemplates(parsed.data.items) });
});
