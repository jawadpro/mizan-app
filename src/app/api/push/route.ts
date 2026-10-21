import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { deleteSubscription, isPushEndpoint, saveSubscription, vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

const endpoint = z.string().max(1000).refine(isPushEndpoint, "Unsupported push service");
const subscribeInput = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
});

export const GET = handle(async (req: Request) => {
  requireSession(req);
  return json({ ok: true, publicKey: vapidPublicKey() });
});

export const POST = handle(async (req: Request) => {
  requireSession(req);
  const parsed = subscribeInput.safeParse(await readJson(req, 4096));
  if (!parsed.success) throw new HttpError(400, "This browser's notification details were not accepted");
  await saveSubscription(parsed.data);
  return json({ ok: true });
});

export const DELETE = handle(async (req: Request) => {
  requireSession(req);
  const parsed = z.object({ endpoint }).safeParse(await readJson(req, 2048));
  if (!parsed.success) throw new HttpError(400, "Unknown device");
  await deleteSubscription(parsed.data.endpoint);
  return json({ ok: true });
});
