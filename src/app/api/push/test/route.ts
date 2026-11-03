import { requireSession } from "@/lib/auth";
import { HttpError, handle, json } from "@/lib/http";
import { notifyAll } from "@/lib/push";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  requireSession(req);
  const sent = await notifyAll({ title: "Pocketbook", body: "Notifications are working. You'll hear from Pocketbook when an alert needs review.", url: "/app/review" });
  if (sent === 0) throw new HttpError(503, "No notification could be sent. Try turning notifications off and on again.");
  return json({ ok: true, sent });
});
