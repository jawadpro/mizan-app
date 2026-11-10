"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

/**
 * Last response per URL, kept for the life of the tab. A page you come back to shows what it showed
 * before straight away and refreshes in the background, so switching tabs never flashes skeletons.
 */
const cache = new Map<string, unknown>();
const CACHE_MAX = 60;
function remember(url: string, data: unknown) {
  cache.delete(url);
  cache.set(url, data);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

export function useData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(() => (url && cache.has(url) ? (cache.get(url) as T) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !(url && cache.has(url)));
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    const cached = cache.has(url);
    if (cached) setData(cache.get(url) as T);
    // A quiet refresh when something is already on screen; the loading state only when there is nothing yet.
    setLoading(!cached);
    setError(null);
    try {
      const d = await apiFetch<T>(url);
      remember(url, d);
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load };
}
