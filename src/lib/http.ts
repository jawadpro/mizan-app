import "server-only";
import { AuthError } from "./auth";
import { ConfigError } from "./env";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorJson(status: number, message: string, extra: Record<string, unknown> = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Reads a JSON body with a hard byte cap, independent of Content-Length honesty. */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "Request body too large");
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) throw new HttpError(415, "Content-Type must be application/json");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Empty body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      reader.cancel().catch(() => {});
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
}

/** Wraps a route handler with uniform, non-leaky error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return errorJson(e.status, e.message, e.extra);
      if (e instanceof AuthError) return errorJson(e.status, e.message);
      if (e instanceof ConfigError) {
        console.error("[mizan] configuration error:", e.message);
        return errorJson(503, "Server is not fully configured yet");
      }
      // Log only the error class/code, never request bodies or headers.
      const code = (e as { code?: string })?.code;
      console.error("[mizan] unhandled error", (e as Error)?.name, code ?? "");
      return errorJson(500, "Something went wrong on the server");
    }
  };
}
