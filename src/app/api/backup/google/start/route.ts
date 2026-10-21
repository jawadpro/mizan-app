import crypto from "node:crypto";
import { requireSession } from "@/lib/auth";
import { handle } from "@/lib/http";
import { authUrl } from "@/lib/gdrive";
import { STATE_COOKIE, publicOrigin } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

/** Sends the signed-in owner to Google's consent screen, with a one-time state value to stop forged callbacks. */
export const GET = handle(async (req: Request) => {
  requireSession(req);
  const origin = publicOrigin(req);
  const state = crypto.randomBytes(24).toString("base64url");
  const secure = origin.startsWith("https://") ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      location: authUrl(origin, state),
      "set-cookie": `${STATE_COOKIE}=${state}; Path=/api/backup/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
      "cache-control": "no-store",
    },
  });
});
