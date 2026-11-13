import { assertSameOrigin, SESSION_COOKIE, CSRF_COOKIE, sessionIdOf } from "@/lib/auth";
import { handle } from "@/lib/http";
import { revokeSession } from "@/lib/security";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  // The session stops working on the server too, not only in this browser.
  const sid = sessionIdOf(req);
  if (sid) await revokeSession(sid);
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  headers.append("set-cookie", `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
  return new Response(JSON.stringify({ ok: true }), { headers });
});
