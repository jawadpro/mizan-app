import { requireSession } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getReview } from "@/lib/handlers";

export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => {
  requireSession(req);
  return getReview("app");
});
