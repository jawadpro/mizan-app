import { z } from "zod";
import { requireConfirmed, requireSession } from "@/lib/auth";
import { HttpError, errorJson, handle, json, readJson } from "@/lib/http";
import { phoneUrl } from "@/lib/paired-devices";
import { rateLimit } from "@/lib/ratelimit";
import { formatPhone, hint } from "@/lib/whatsapp";
import { AI_MODELS, getWhatsAppSettings, readyParts, saveWhatsAppSettings, setInEnv, type SettingKey } from "@/lib/whatsapp-config";
import { LINK_TTL_MIN, MAX_NUMBERS, WhatsAppSendError, createLinkCode, getNumber, listNumbers, sendText } from "@/lib/whatsapp-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function status(req: Request) {
  const s = await getWhatsAppSettings();
  const env = (k: SettingKey) => setInEnv(k);
  const numbers = await listNumbers();
  return {
    ok: true,
    ready: readyParts(s),
    webhookUrl: `${phoneUrl(req)}/api/whatsapp/webhook`,
    verifyToken: s.verifyToken,
    phoneNumberId: s.phoneNumberId,
    accessToken: hint(s.accessToken),
    appSecret: hint(s.appSecret),
    anthropicKey: hint(s.anthropicKey),
    model: s.model,
    models: AI_MODELS,
    fromEnv: {
      phoneNumberId: env("phoneNumberId"), accessToken: env("accessToken"), appSecret: env("appSecret"),
      verifyToken: env("verifyToken"), anthropicKey: env("anthropicKey"), model: env("model"),
    },
    numbers: numbers.map((n) => ({ ...n, display: formatPhone(n.phone) })),
    maxNumbers: MAX_NUMBERS,
  };
}

/** What's set up, the webhook address and verify token for Meta, and the linked numbers. Keys show only their last 4 characters. */
export const GET = handle(async (req: Request) => {
  await requireSession(req);
  return json(await status(req));
});

const field = (max: number) => z.string().max(max).optional();
const settingsInput = z.object({
  phoneNumberId: z.string().max(40).regex(/^\d*$/, "The Phone number ID is digits only").optional(),
  accessToken: field(1000),
  appSecret: field(200),
  anthropicKey: field(300),
  model: z.enum(AI_MODELS.map((m) => m.id) as [string, ...string[]]).optional(),
}).strict();

/** Saves the Meta and Anthropic keys (encrypted). Asks for the passphrase, as these keys can read and send messages. */
export const PUT = handle(async (req: Request) => {
  await requireConfirmed(req);
  const parsed = settingsInput.safeParse(await readJson(req, 4096));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  if (parsed.data.anthropicKey && !/^sk-ant-/.test(parsed.data.anthropicKey.trim())) throw new HttpError(400, "That doesn't look like an Anthropic API key (they start with sk-ant-)");
  await saveWhatsAppSettings(parsed.data);
  return json(await status(req));
});

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("code"), name: z.string().max(60).optional() }),
  z.object({ action: z.literal("test"), numberId: z.string().uuid() }),
]);

/** { action: "code" } makes a linking code to send to the bot; { action: "test", numberId } sends a test message. */
export const POST = handle(async (req: Request) => {
  await requireSession(req);
  const parsed = action.safeParse(await readJson(req, 1024));
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  if (parsed.data.action === "code") {
    if (!(await rateLimit("wa-code", 20, 3600))) return errorJson(429, "Too many codes in an hour. Try again later.");
    const c = await createLinkCode(parsed.data.name);
    return json({ ok: true, code: c.display, expiresAt: c.expiresAt, minutes: LINK_TTL_MIN });
  }
  if (!(await rateLimit("wa-test", 10, 3600))) return errorJson(429, "Too many test messages. Try again later.");
  const n = await getNumber(parsed.data.numberId);
  if (!n) throw new HttpError(404, "Number not found");
  const s = await getWhatsAppSettings();
  try {
    await sendText(s, n.phone, "👋 Test from Mizan. WhatsApp is working. Send *help* to see what I can do.");
  } catch (e) {
    if (e instanceof WhatsAppSendError) throw new HttpError(502, `WhatsApp didn't send it: ${e.message}`);
    throw e;
  }
  return json({ ok: true });
});
