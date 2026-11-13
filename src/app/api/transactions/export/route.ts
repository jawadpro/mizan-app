import { requireSession } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getExport } from "@/lib/handlers";

export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => {
  await requireSession(req);
  return getExport("app", req);
});
