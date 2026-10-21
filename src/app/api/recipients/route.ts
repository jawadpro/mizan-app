import { requireSession } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getRecipients } from "@/lib/handlers";

export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => {
  requireSession(req);
  return getRecipients("app", req);
});
