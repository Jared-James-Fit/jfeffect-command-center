import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createSignedUrlCache } from "@/lib/signed-url-cache";

const BUCKET = "message-attachments";

/** App-wide cache: shared by every thread, survives navigating between chats. */
export const chatUrlCache = createSignedUrlCache(async (paths) => {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const item of data ?? []) if (item?.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
});

export function clearChatSignedUrls() {
  chatUrlCache.clear();
}

const EMPTY: Record<string, string> = {};

/**
 * Signed URLs for a thread's attachment paths. Only paths we don't already
 * have are requested (one batched call), and a path keeps the same URL string
 * for its whole life, so adding a message never makes existing media reload.
 * `pending` is true while URLs for these paths are still being fetched, so
 * individual images don't each fire their own signing request meanwhile.
 */
export function useChatSignedUrls(paths: string[]) {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const key = useMemo(() => Array.from(new Set(paths.filter(Boolean))).sort().join("|"), [paths]);
  const prev = useRef<Record<string, string>>(EMPTY);
  // The key whose batch request has finished (successfully or not). If it failed,
  // `pending` ends so images fall back to signing themselves instead of waiting forever.
  const [settledKey, setSettledKey] = useState<string | null>(null);

  useEffect(() => {
    const list = key ? key.split("|") : [];
    if (!chatUrlCache.missing(list).length) return;
    let cancelled = false;
    void chatUrlCache.ensure(list).then(() => {
      if (cancelled) return;
      setSettledKey(key);
      bump();
    });
    return () => { cancelled = true; };
  }, [key]);

  return useMemo(() => {
    const list = key ? key.split("|") : [];
    const next = chatUrlCache.snapshot(list);
    const pending = settledKey !== key && chatUrlCache.missing(list).length > 0;
    // Keep the same object when nothing changed so consumers don't re-render.
    const a = Object.keys(next);
    const same = a.length === Object.keys(prev.current).length && a.every((k) => prev.current[k] === next[k]);
    if (same) return { urls: prev.current, pending };
    prev.current = next;
    return { urls: next, pending };
    // `version` bumps when the cache gained URLs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, settledKey]);
}

// Per-attachment callers (group chat) all ask in the same render pass; coalesce
// them into one batched signing call instead of one request per attachment.
let queued: { paths: Set<string>; promise: Promise<void> } | null = null;
function ensureSoon(path: string): Promise<void> {
  if (!queued) {
    const paths = new Set<string>();
    const promise = new Promise<void>((resolve) => {
      setTimeout(() => {
        queued = null;
        void chatUrlCache.ensure(Array.from(paths)).then(resolve);
      }, 16);
    });
    queued = { paths, promise };
  }
  queued.paths.add(path);
  return queued.promise;
}

/** Signed URL for one attachment path, from the shared cache. */
export function useChatSignedUrl(path?: string): string | undefined {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const current = path ? chatUrlCache.get(path) : undefined;
  useEffect(() => {
    if (!path || chatUrlCache.get(path)) return;
    let cancelled = false;
    void ensureSoon(path).then(() => { if (!cancelled) bump(); });
    return () => { cancelled = true; };
  }, [path, current]);
  return current;
}
