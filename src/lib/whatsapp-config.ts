import "server-only";
import crypto from "node:crypto";
import { getSecret, setSecret } from "./secretbox";

// The WhatsApp assistant's settings: the owner pastes them in Settings › WhatsApp, and they are kept encrypted in
// app.app_secrets. An environment variable, when set, wins over the saved value (and Settings shows it as set there).

export const AI_MODELS = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Fast and very cheap" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Balanced" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Smartest, costs the most" },
] as const;
export type AiModel = (typeof AI_MODELS)[number]["id"];
export const DEFAULT_MODEL: AiModel = "claude-haiku-5-5";
export const isAiModel = (v: unknown): v is AiModel => AI_MODELS.some((m) => m.id === v);

export type WhatsAppSettings = {
  phoneNumberId: string | null;
  accessToken: string | null;
  appSecret: string | null;
  /** The word Meta sends back when the webhook is first set up. Made by Mizan, shown in Settings to paste into Meta. */
  verifyToken: string;
  anthropicKey: string | null;
  model: AiModel;
};

type Saved = Partial<Omit<WhatsAppSettings, "verifyToken">> & { verifyToken?: string };
const NAME = "whatsapp.settings";

const ENV = {
  phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID",
  accessToken: "WHATSAPP_ACCESS_TOKEN",
  appSecret: "WHATSAPP_APP_SECRET",
  verifyToken: "WHATSAPP_VERIFY_TOKEN",
  anthropicKey: "ANTHROPIC_API_KEY",
  model: "MIZAN_AI_MODEL",
} as const;
export type SettingKey = keyof typeof ENV;

const fromEnv = (k: SettingKey) => process.env[ENV[k]]?.trim() || null;
export const setInEnv = (k: SettingKey) => !!fromEnv(k);

async function readSaved(): Promise<Saved> {
  const raw = await getSecret(NAME).catch(() => null);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Saved;
  } catch {
    return {};
  }
}

let cache: { at: number; value: WhatsAppSettings } | null = null;

export async function getWhatsAppSettings(fresh = false): Promise<WhatsAppSettings> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.value;
  const saved = await readSaved();
  let verifyToken = fromEnv("verifyToken") ?? saved.verifyToken ?? null;
  if (!verifyToken) {
    // Made once and kept, so the value pasted into Meta keeps working.
    verifyToken = `mizan-${crypto.randomBytes(12).toString("base64url")}`;
    await setSecret(NAME, JSON.stringify({ ...saved, verifyToken }));
  }
  const model = fromEnv("model") ?? saved.model;
  const value: WhatsAppSettings = {
    phoneNumberId: fromEnv("phoneNumberId") ?? saved.phoneNumberId ?? null,
    accessToken: fromEnv("accessToken") ?? saved.accessToken ?? null,
    appSecret: fromEnv("appSecret") ?? saved.appSecret ?? null,
    verifyToken,
    anthropicKey: fromEnv("anthropicKey") ?? saved.anthropicKey ?? null,
    model: isAiModel(model) ? model : DEFAULT_MODEL,
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Saves what Settings sent. A field left out stays as it was; an empty string clears it. */
export async function saveWhatsAppSettings(patch: Partial<Record<Exclude<SettingKey, "verifyToken">, string>>) {
  const saved = await readSaved();
  const next: Saved = { ...saved };
  for (const [k, v] of Object.entries(patch) as [Exclude<SettingKey, "verifyToken">, string | undefined][]) {
    if (v === undefined) continue;
    const t = v.trim();
    if (k === "model") next.model = isAiModel(t) ? t : DEFAULT_MODEL;
    else next[k] = t || null;
  }
  await setSecret(NAME, JSON.stringify(next));
  cache = null;
  return getWhatsAppSettings(true);
}

/** Whether the bot can receive and answer messages. */
export function readyParts(s: WhatsAppSettings) {
  return {
    meta: !!(s.phoneNumberId && s.accessToken && s.appSecret),
    ai: !!s.anthropicKey,
  };
}
