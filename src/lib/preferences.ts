import { z } from "zod";

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9.:_\-]{1,63}$/;

/** Model choices offered on the Settings page; any other model ID can be typed in. */
export const AI_MODELS = {
  claude: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most accurate)" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (cheapest)" },
  ],
  openai: [
    { id: "gpt-5-mini", label: "GPT-5 mini" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  ],
};

/** Feature switches from the Settings page. Unknown or missing keys fall back to these defaults. */
export const DEFAULT_PREFS = {
  spendingCheck: true,
  limitWarnPercent: 80,
  dua: true,
  duaUrdu: true,
  duaEnglish: true,
  ramadanNotice: true,
  defaultRange: "30d" as "7d" | "30d" | "month" | "12m" | "year",
  aiEnabled: false,
  aiProvider: "claude" as "claude" | "openai",
  aiModelClaude: "claude-opus-5-5",
  aiModelOpenai: "gpt-5-mini",
  aiAutoImport: false,
};
export type Prefs = typeof DEFAULT_PREFS;

export const prefsPatch = z
  .object({
    spendingCheck: z.boolean(),
    limitWarnPercent: z.union([z.literal(70), z.literal(80), z.literal(90)]),
    dua: z.boolean(),
    duaUrdu: z.boolean(),
    duaEnglish: z.boolean(),
    ramadanNotice: z.boolean(),
    defaultRange: z.enum(["7d", "30d", "month", "12m", "year"]),
    aiEnabled: z.boolean(),
    aiProvider: z.enum(["claude", "openai"]),
    aiModelClaude: z.string().regex(MODEL_ID),
    aiModelOpenai: z.string().regex(MODEL_ID),
    aiAutoImport: z.boolean(),
  })
  .partial()
  .strict();

/** Reads stored settings leniently: a bad or old value for one key never breaks the others. */
export function normalizePrefs(raw: unknown): Prefs {
  const out = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    const one = prefsPatch.safeParse({ [k]: v });
    if (one.success) Object.assign(out, one.data);
  }
  return out;
}
