import { after } from "next/server";
import { errorJson, handle } from "@/lib/http";
import { parseWebhook, verifyMetaSignature } from "@/lib/whatsapp";
import { getWhatsAppSettings, readyParts } from "@/lib/whatsapp-config";
import { handleInbound } from "@/lib/whatsapp-bot";
import { safeEqual } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Answers are worked out after Meta has had its quick 200, within this route's time limit.
export const maxDuration = 60;

const MAX_BODY = 256 * 1024;

/** Meta checks the webhook once when it's set up: it sends the verify token and expects the challenge back. */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const s = await getWhatsAppSettings();
  const token = sp.get("hub.verify_token") ?? "";
  if (sp.get("hub.mode") !== "subscribe" || !token || !safeEqual(token, s.verifyToken)) return errorJson(403, "Verification failed");
  const challenge = (sp.get("hub.challenge") ?? "").slice(0, 200);
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
});

/** Incoming WhatsApp messages. Only bodies signed with the Meta app secret are read. */
export const POST = handle(async (req: Request) => {
  const s = await getWhatsAppSettings();
  if (!readyParts(s).meta) return errorJson(503, "WhatsApp is not set up");
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return errorJson(413, "Too large");
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.byteLength > MAX_BODY) return errorJson(413, "Too large");
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), s.appSecret!)) return errorJson(401, "Bad signature");
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return errorJson(400, "Not JSON");
  }
  const messages = parseWebhook(body).filter((m) => !m.phoneNumberId || m.phoneNumberId === s.phoneNumberId);
  if (messages.length) {
    after(async () => {
      for (const m of messages) await handleInbound(s, m);
    });
  }
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
});
