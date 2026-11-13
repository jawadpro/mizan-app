import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { parseAmountToPaisa, setDisplayCurrency } from "@/lib/money";
import { getPrefs, listSetAsides, savingsData, updatePrefs } from "@/lib/repo";
import { buildSavingsPlan } from "@/lib/savings";
import { todayPkt } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession(req);
  const today = todayPkt();
  const [data, funds, prefs] = await Promise.all([savingsData(today), listSetAsides(), getPrefs()]);
  setDisplayCurrency(prefs.currency);
  const savingFunds = funds
    .filter((f) => f.purpose === "saving" && !f.ended_on)
    .map((f) => ({ id: f.id, name: f.name, percent_bp: f.percent_bp, applies_to: f.applies_to, remaining: f.remaining }));
  return json({ ok: true, ...buildSavingsPlan({ today, ...data, savingFunds, target: prefs.savingsTarget }) });
});

const targetInput = z.object({ target: z.string().max(20) });

/** PUT { target: "25,000" } sets the monthly savings target; an empty target goes back to the suggestion. */
export const PUT = handle(async (req: Request) => {
  await requireSession(req);
  const parsed = targetInput.safeParse(await readJson(req, 512));
  if (!parsed.success) throw new HttpError(400, "Enter a monthly amount like 25,000");
  const t = parsed.data.target.trim();
  const paisa = t === "" ? 0 : parseAmountToPaisa(t);
  if (paisa === null) throw new HttpError(400, "Enter a monthly amount like 25,000", { fields: { target: ["Enter a monthly amount like 25,000"] } });
  await updatePrefs({ savingsTarget: paisa });
  return json({ ok: true });
});
