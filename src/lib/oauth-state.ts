import "server-only";

export const STATE_COOKIE = "mizan_gstate";

/** The public origin Google redirects back to; must match the redirect URI registered in Google Cloud. */
export function publicOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}
