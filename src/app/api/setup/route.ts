import { z } from "zod";
import { assertSameOrigin, requireSession, sessionHeaders } from "@/lib/auth";
import { claimInstall, finishSetup, MIN_PASSPHRASE, regenerateSmsToken, savedSmsToken, setupState } from "@/lib/config";
import { env } from "@/lib/env";
import { HttpError, errorJson, handle, json, readJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the setup page needs to know. Says nothing secret; the SMS token only goes to the signed-in owner. */
export const GET = handle(async (req: Request) => {
  const state = await setupState();
  let token: string | null = null;
  let signedIn = false;
  if (state.hasPassword) {
    try {
      requireSession(req);
      signedIn = true;
      token = savedSmsToken();
    } catch {
      signedIn = false;
    }
  }
  return json({ ok: true, ...state, signedIn, smsToken: token, smsTokenFromEnv: env.fromEnv("SMS_INGEST_TOKEN") });
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), password: z.string().min(MIN_PASSPHRASE, `Use at least ${MIN_PASSPHRASE} characters`).max(256), remember: z.boolean().optional() }),
  z.object({ action: z.literal("finish") }),
  z.object({ action: z.literal("new-token") }),
]);

export const POST = handle(async (req: Request) => {
  const parsed = input.safeParse(await readJson(req, 2048));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const body = parsed.data;

  if (body.action === "claim") {
    assertSameOrigin(req);
    if (!(await rateLimit(`setup:ip:${clientIp(req)}`, 10, 900))) return errorJson(429, "Too many attempts. Try again in 15 minutes.");
    const state = await setupState();
    if (state.db !== "ok") throw new HttpError(503, "The database isn't ready yet");
    if (state.hasPassword) throw new HttpError(409, "Mizan already has a passphrase. Sign in instead.");
    const origin = new URL(req.headers.get("origin")!).origin;
    if (!(await claimInstall(body.password, origin))) throw new HttpError(409, "Mizan already has a passphrase. Sign in instead.");
    return new Response(JSON.stringify({ ok: true, smsToken: savedSmsToken() }), { status: 200, headers: sessionHeaders(body.remember !== false) });
  }

  requireSession(req);
  if (body.action === "finish") {
    await finishSetup();
    return json({ ok: true });
  }
  if (env.fromEnv("SMS_INGEST_TOKEN")) throw new HttpError(409, "The SMS token is set in your environment variables; change it there.");
  return json({ ok: true, smsToken: await regenerateSmsToken() });
});
