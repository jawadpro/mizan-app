import { requireSession } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { latestPairing, listDevices, phoneUrl, shortcutConfig } from "@/lib/paired-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Paired iPhones (or with ?kind=widget, widgets), the state of the latest pairing code, and what the setup needs. */
export const GET = handle(async (req: Request) => {
  await requireSession(req);
  const kind = new URL(req.url).searchParams.get("kind") === "widget" ? "widget" : "shortcut";
  const [items, pairing] = await Promise.all([listDevices(kind), latestPairing(kind)]);
  return json({ ok: true, items, pairing, shortcut: shortcutConfig(), phoneUrl: phoneUrl(req) });
});
