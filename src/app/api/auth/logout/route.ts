import { assertSameOrigin, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  headers.append("set-cookie", `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
  return new Response(JSON.stringify({ ok: true }), { headers });
});
