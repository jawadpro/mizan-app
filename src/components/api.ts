"use client";

export type Space = "app" | "demo";

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string[]>) {
    super(message);
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)mizan_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/** Fired after a review item is confirmed or dismissed, so the inbox badge refreshes. */
export const REVIEW_CHANGED = "mizan:review-changed";

export function apiBase(space: Space) {
  return space === "demo" ? "/api/demo" : "/api";
}

export function resourceUrl(space: Space, resource: "analytics" | "transactions" | "recipients" | "review" | "export", params?: Record<string, string | number | undefined>) {
  const path = space === "demo" ? `/api/demo/${resource}` : resource === "export" ? "/api/transactions/export" : `/api/${resource}`;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET") headers.set("x-csrf-token", csrf());
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; fields?: Record<string, string[]> };
    if (res.status === 401 && typeof window !== "undefined" && !url.includes("/auth/")) {
      window.location.href = "/login?expired=1";
    }
    throw new ApiError(res.status, d.error ?? `Request failed (${res.status})`, d.fields);
  }
  return data as T;
}
