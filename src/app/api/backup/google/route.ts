import { requireSession } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { disconnect } from "@/lib/gdrive";

export const dynamic = "force-dynamic";

/** Revokes Mizan's Google access and forgets the token. Backups already in Drive stay there. */
export const DELETE = handle(async (req: Request) => {
  requireSession(req);
  await disconnect();
  return json({ ok: true });
});
