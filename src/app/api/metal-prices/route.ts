import { requireSession } from "@/lib/auth";
import { FAITH_FEATURES } from "@/lib/features";
import { errorJson, handle, json } from "@/lib/http";
import { fetchMetalPrices } from "@/lib/metals";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  if (!FAITH_FEATURES) return errorJson(404, "Not found");
  requireSession(req);
  try {
    return json({ ok: true, ...(await fetchMetalPrices()) });
  } catch {
    return errorJson(502, "Live prices are unavailable right now. Enter today's price by hand.");
  }
});
