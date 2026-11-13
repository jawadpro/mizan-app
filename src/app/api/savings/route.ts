import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { bankParam, showsForBank } from "@/lib/banks";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { parseAmountToPaisa, setDisplayCurrency } from "@/lib/money";
import { getPrefs, listSetAsides, savingsData, updatePrefs } from "@/lib/repo";
import { buildSavingsPlan } from "@/lib/savings";
import { todayPkt } from "@/lib/time";

export const dynamic = "force-dynamic";

/** GET ?bank=<id|none> works the plan out from one bank's transactions, with its own target and set-asides. */
export const GET = handle(async (req: Request) => {
  await requireSession(req);
  const bank = bankParam(new URL(req.url).searchParams.get("bank"));
  const today = todayPkt();
  const [data, funds, prefs] = await Promise.all([savingsData(today, bank), listSetAsides(), getPrefs()]);
  setDisplayCurrency(prefs.currency);
  const savingFunds = funds
    .filter((f) => f.purpose === "saving" && !f.ended_on && showsForBank(f.bank_id, bank))
    .map((f) => ({ id: f.id, name: f.name, percent_bp: f.percent_bp, applies_to: f.applies_to, remaining: f.remaining }));
  const target = bank ? prefs.savingsTargets[bank] ?? 0 : prefs.savingsTarget;
  return json({ ok: true, bank, ...buildSavingsPlan({ today, ...data, savingFunds, target }) });
});

const targetInput = z.object({ target: z.string().max(20), bank: z.string().max(40).optional() });

/** PUT { target: "25,000", bank? } sets the monthly savings target, overall or for one bank; empty goes back to the suggestion. */
export const PUT = handle(async (req: Request) => {
  await requireSession(req);
  const parsed = targetInput.safeParse(await readJson(req, 512));
  if (!parsed.success) throw new HttpError(400, "Enter a monthly amount like 25,000");
  const t = parsed.data.target.trim();
  const paisa = t === "" ? 0 : parseAmountToPaisa(t);
  if (paisa === null) throw new HttpError(400, "Enter a monthly amount like 25,000", { fields: { target: ["Enter a monthly amount like 25,000"] } });
  const bank = bankParam(parsed.data.bank);
  if (!bank) {
    await updatePrefs({ savingsTarget: paisa });
  } else {
    const targets = { ...(await getPrefs()).savingsTargets };
    if (paisa > 0) targets[bank] = paisa;
    else delete targets[bank];
    await updatePrefs({ savingsTargets: targets });
  }
  return json({ ok: true });
});
