import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { getTransactions } from "@/lib/handlers";
import { createTransaction } from "@/lib/repo";
import { transactionInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  requireSession(req);
  return getTransactions("app", req);
});

export const POST = handle(async (req: Request) => {
  requireSession(req);
  const parsed = transactionInput.safeParse(await readJson(req, 4096));
  if (!parsed.success) throw new HttpError(400, "Please fix the highlighted fields", { fields: parsed.error.flatten().fieldErrors });
  return json({ ok: true, item: await createTransaction(parsed.data) }, 201);
});
