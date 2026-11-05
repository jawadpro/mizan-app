import { requireSession } from "@/lib/auth";
import { HttpError, handle, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getPrefs } from "@/lib/repo";
import { deleteSecret, getSecret, setSecret } from "@/lib/secretbox";
import { AI_KEY_NAME, readWithAi, type AiProvider } from "@/lib/sms/ai";
import { aiKeyInput } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE = "PKR 1,250.00 debited from your A/C ****1234 at KFC GULBERG on 05-Nov-2026 13:40. Avl Bal PKR 40,210.55";

async function status() {
  const [claude, openai] = await Promise.all([getSecret(AI_KEY_NAME.claude), getSecret(AI_KEY_NAME.openai)]);
  // Only whether a key is saved, and its last four characters, ever leave the server.
  const hint = (k: string | null) => (k ? { saved: true, ending: k.slice(-4) } : { saved: false, ending: null });
  return { keys: { claude: hint(claude), openai: hint(openai) } };
}

export const GET = handle(async (req: Request) => {
  requireSession(req);
  return json({ ok: true, ...(await status()) });
});

/** PUT { provider, key } stores the key encrypted. */
export const PUT = handle(async (req: Request) => {
  requireSession(req);
  const parsed = aiKeyInput.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the API key");
  await setSecret(AI_KEY_NAME[parsed.data.provider], parsed.data.key);
  return json({ ok: true, ...(await status()) });
});

export const DELETE = handle(async (req: Request) => {
  requireSession(req);
  const body = (await readJson(req, 256)) as { provider?: unknown } | null;
  if (body?.provider !== "claude" && body?.provider !== "openai") throw new HttpError(400, "Choose Claude or OpenAI");
  await deleteSecret(AI_KEY_NAME[body.provider as AiProvider]);
  return json({ ok: true, ...(await status()) });
});

/** POST { provider } reads a made-up sample alert with the saved key and chosen model. */
export const POST = handle(async (req: Request) => {
  requireSession(req);
  if (!(await rateLimit("ai:test", 10, 600))) throw new HttpError(429, "Too many tests. Try again in a few minutes.");
  const body = (await readJson(req, 256)) as { provider?: unknown } | null;
  const provider: AiProvider = body?.provider === "openai" ? "openai" : "claude";
  const prefs = await getPrefs();
  const model = provider === "claude" ? prefs.aiModelClaude : prefs.aiModelOpenai;
  const out = await readWithAi({ provider, model, text: SAMPLE, receivedAt: new Date() });
  if (!out.ok) throw new HttpError(502, out.error);
  return json({ ok: true, sample: SAMPLE, model, reading: out.reading, why: out.reading ? null : out.why });
});
