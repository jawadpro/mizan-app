import { requireSession } from "@/lib/auth";
import { errorJson, handle, json } from "@/lib/http";
import { fetchMetalPrices } from "@/lib/metals";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  requireSession(req);
  try {
    return json({ ok: true, ...(await fetchMetalPrices()) });
  } catch {
    return errorJson(502, "Live prices are unavailable right now. Enter today's price by hand.");
  }
});
