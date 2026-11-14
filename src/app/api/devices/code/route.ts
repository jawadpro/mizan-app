import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { HttpError, errorJson, handle, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { createPairingCode, phoneUrl, shortcutConfig } from "@/lib/paired-devices";
import { WIDGET_SCRIPT_NAME, pairPayload, scriptableRunUrl, shortcutRunUrl } from "@/lib/shortcut-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z.object({
  name: z.string().max(60).optional(),
  replaces: z.string().uuid().optional(),
  kind: z.enum(["shortcut", "widget"]).optional(),
}).strict();

/** A fresh pairing code, plus the links that carry it to the Shortcut (or, with kind "widget", to the Scriptable widget). */
export const POST = handle(async (req: Request) => {
  await requireSession(req);
  if (!(await rateLimit("paircode", 20, 3600))) return errorJson(429, "Too many codes in an hour. Try again later.");
  const parsed = input.safeParse(await readJson(req, 1024).catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { code, display, expiresAt } = await createPairingCode(parsed.data);
  const server = phoneUrl(req);
  // What the Shortcut receives as input: the link that pairs it, with the one-time code. Never a device token.
  const payload = pairPayload(server, code);
  if (parsed.data.kind === "widget") {
    // The widget script opens this link itself and keeps the key it gets back in the iPhone's Keychain.
    const runUrl = scriptableRunUrl(WIDGET_SCRIPT_NAME, { pair: payload });
    return json({ ok: true, code: display, expiresAt, runUrl, pairPageUrl: `${server}/pair/widget#${code}`, payload, server });
  }
  const runUrl = shortcutRunUrl(shortcutConfig().name, payload);
  // Opened on the iPhone from the QR code: the code stays in the #fragment, which browsers never send to a server.
  const pairPageUrl = `${server}/pair#${code}`;
  return json({ ok: true, code: display, expiresAt, runUrl, pairPageUrl, payload });
});
