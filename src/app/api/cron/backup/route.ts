import { safeEqual } from "@/lib/crypto";
import { errorJson, handle, json } from "@/lib/http";
import { runBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called once a night by Vercel Cron, which sends `Authorization: Bearer <CRON_SECRET>`. */
export const GET = handle(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32 || !safeEqual(auth, `Bearer ${secret}`)) return errorJson(401, "Unauthorized");
  const r = await runBackup();
  return json({ ok: r.ok }, r.ok ? 200 : 502);
});
