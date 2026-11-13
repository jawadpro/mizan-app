import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { getSmsWords, saveSmsWords } from "@/lib/repo";
import { DEFAULT_SMS_WORDS, smsWordsInput } from "@/lib/sms/keywords";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession(req);
  return json({ ok: true, words: await getSmsWords(), defaults: DEFAULT_SMS_WORDS });
});

/** PUT { expense, income, remittance, transfer } replaces all four lists. */
export const PUT = handle(async (req: Request) => {
  await requireSession(req);
  const parsed = smsWordsInput.safeParse(await readJson(req, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Please check the word lists");
  if (!parsed.data.expense.length || !parsed.data.income.length) throw new HttpError(400, "Keep at least one expense word and one income word");
  return json({ ok: true, words: await saveSmsWords(parsed.data) });
});
