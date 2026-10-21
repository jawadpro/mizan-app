import "server-only";
import { q } from "./db";

/**
 * Fixed-window counter stored in Postgres, so limits hold across serverless instances.
 * Returns true when the request is allowed.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { rows } = await q<{ hits: number }>(
    `INSERT INTO app.rate_limits (bucket, window_start, hits)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET hits = app.rate_limits.hits + 1
     RETURNING hits`,
    [bucket, windowSeconds],
  );
  if (Math.random() < 0.02) {
    q(`DELETE FROM app.rate_limits WHERE window_start < now() - interval '1 day'`).catch(() => {});
  }
  return rows[0].hits <= limit;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return ip.slice(0, 64);
}
