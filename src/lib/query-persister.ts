import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";

// Bumping the buster invalidates all previously persisted caches across
// every browser/PWA. Bump when the persisted query shapes change in a
// breaking way.
// Bumped to v3 to evict pre-existing broken caches where a Set-valued
// query (pl-exercise-favorites) had been JSON.stringify'd into `{}`.
export const QUERY_PERSIST_BUSTER = "v3";
export const QUERY_PERSIST_KEY = "jfeffect-rq-cache";
export const QUERY_PERSIST_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

// Query keys we never want to persist to disk. These are either large,
// sensitive, or change too often for a cached copy to be useful.
const DO_NOT_PERSIST_PREFIXES = [
  "messages",
  "thread",
  "conversation",
  "notifications",
  "event-popup-",
  "form-popup-",
  "setup-prompts-",
  "broadcasts-",
  "admin-",
  "chat-gif-favorites",
  "chat-sound-favorites",
  // React Query's sync-storage persister uses JSON.stringify, which
  // silently turns Set/Map values into `{}`. This query stores a
  // `Set<string>` of favorite exercise ids; if we persist it, the next
  // page load rehydrates `favs` as a plain object and `favs.has(...)`
  // throws "h.has is not a function" during the program-builder render,
  // which the block editor's error boundary surfaces as
  // "Couldn't open this block". Keep it out of disk cache; the in-hook
  // localStorage fallback (writeFavCache) already provides instant load.
  "pl-exercise-favorites",
];

export function shouldPersistQueryKey(queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  if (typeof first !== "string") return false;
  return !DO_NOT_PERSIST_PREFIXES.some((p) => first.startsWith(p));
}

export function createQueryPersister(): Persister | null {
  if (typeof window === "undefined") return null;
  try {
    return createSyncStoragePersister({
      storage: window.localStorage,
      key: QUERY_PERSIST_KEY,
      throttleTime: 1000,
    });
  } catch {
    return null;
  }
}

export function clearPersistedQueryCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(QUERY_PERSIST_KEY);
  } catch { /* best-effort */ }
}