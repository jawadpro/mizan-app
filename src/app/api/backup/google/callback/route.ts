import { readCookie, requireSession } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";
import { handle } from "@/lib/http";
import { DriveError, connect } from "@/lib/gdrive";
import { STATE_COOKIE, publicOrigin } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  requireSession(req);
  const origin = publicOrigin(req);
  const url = new URL(req.url);
  const back = (result: string) =>
    new Response(null, {
      status: 302,
      headers: {
        location: `${origin}/app/backup?drive=${result}`,
        "set-cookie": `${STATE_COOKIE}=; Path=/api/backup/google; HttpOnly; SameSite=Lax; Max-Age=0`,
        "cache-control": "no-store",
      },
    });
  const expected = readCookie(req.headers.get("cookie") ?? "", STATE_COOKIE);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!expected || !state || !safeEqual(state, expected)) return back("expired");
  if (!code) return back("declined");
  try {
    await connect(origin, code);
    return back("connected");
  } catch (e) {
    if (e instanceof DriveError) return back("failed");
    throw e;
  }
});
