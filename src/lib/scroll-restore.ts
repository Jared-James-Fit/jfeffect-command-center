import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Per-user, per-route sessionStorage scroll restoration.
 *
 * - Saves the window scrollY for the supplied key with rAF-throttled writes.
 * - Restores once `ready` flips true and again whenever the supplied
 *   `dependencies` change (e.g. active week / tab), so the editor remembers
 *   the position for each sub-view independently.
 * - Clamps restored positions to the current document height so we never
 *   jump past the bottom of a shorter page.
 * - Skips restore when the URL contains an anchor or the user has already
 *   moved the page (intentional navigation wins).
 * - Cleans up entries older than 7 days to keep sessionStorage tidy.
 */

const KEY_PREFIX = "lov.scroll.v1";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StoredEntry = { y: number; at: number };

function storageKey(userId: string, key: string) {
  return `${KEY_PREFIX}:${userId}:${key}`;
}

function read(key: string): StoredEntry | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.y !== "number" || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function write(key: string, y: number) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ y, at: Date.now() } satisfies StoredEntry));
  } catch {
    /* quota — ignore */
  }
}

/**
 * @param key         Stable scope key, e.g. `tpl:<id>:w<week>` or `block:<id>:w<week>`.
 * @param ready       Whether the page has loaded enough content for the saved
 *                    position to be meaningful (typically `!isLoading && payload != null`).
 * @param dependencies Values that should trigger a re-restore (week/tab changes).
 */
export function useScrollRestoration(opts: {
  key: string | null | undefined;
  ready: boolean;
  dependencies?: ReadonlyArray<unknown>;
}) {
  const { key, ready } = opts;
  const deps = opts.dependencies ?? [];
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const lastSavedRef = useRef<number>(-1);
  const restoredForRef = useRef<string | null>(null);

  const fullKey = userId && key ? storageKey(userId, key) : null;

  // Save on scroll (rAF-throttled).
  useEffect(() => {
    if (!fullKey) return;
    let rafId: number | null = null;
    const handler = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const y = window.scrollY;
        if (Math.abs(y - lastSavedRef.current) < 8) return;
        lastSavedRef.current = y;
        write(fullKey, y);
      });
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("scroll", handler);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [fullKey]);

  // Restore once content is ready. Re-restore when the scope or dependencies
  // change (e.g. user switches week).
  useEffect(() => {
    if (!fullKey || !ready) return;
    const sig = `${fullKey}|${JSON.stringify(deps)}`;
    if (restoredForRef.current === sig) return;

    // Intentional anchor navigation wins.
    if (typeof window !== "undefined" && window.location.hash) {
      restoredForRef.current = sig;
      return;
    }

    const entry = read(fullKey);
    if (!entry) {
      restoredForRef.current = sig;
      return;
    }

    // Wait one frame for layout, then clamp and restore. Don't override a
    // scroll the user already did themselves.
    const id = requestAnimationFrame(() => {
      if (window.scrollY > 50) {
        restoredForRef.current = sig;
        return;
      }
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const target = Math.min(entry.y, max);
      window.scrollTo({ top: target, behavior: "auto" });
      lastSavedRef.current = target;
      restoredForRef.current = sig;
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, ready, ...deps]);
}

/** Imperatively drop a stored position (e.g. when the template/block was deleted). */
export function clearScrollPositionFor(userId: string, key: string) {
  try { sessionStorage.removeItem(storageKey(userId, key)); } catch { /* noop */ }
}