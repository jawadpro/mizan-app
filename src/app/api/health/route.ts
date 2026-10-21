import { q } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await q("SELECT 1 FROM app.transactions LIMIT 1");
  return json({ ok: true, database: "ok" });
});
