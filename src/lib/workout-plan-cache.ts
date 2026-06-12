// Offline-friendly cache for workout plan data. Caches whatever the loggers
// fetch — pl_days, pl_exercise_rows, pl_row_results, completion — plus the
// member-plan day payload — so a returning client on a weak connection can
// still open today's (and the next ~7 days') workout and start logging.
//
// Storage: localStorage. Small JSON blobs, namespaced by user + scope key.

const PREFIX = "lov:wo-cache:v1:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // keep 7 days
const MAX_ENTRIES = 64;

type Entry<T> = { v: T; t: number };

function safeKey(scope: string, key: string) {
  return `${PREFIX}${scope}:${key}`;
}

export function writePlanCache<T>(scope: string, key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(safeKey(scope, key), JSON.stringify({ v: value, t: Date.now() } satisfies Entry<T>));
    pruneIfNeeded();
  } catch {
    /* quota — best-effort */
  }
}

export function readPlanCache<T>(scope: string, key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(safeKey(scope, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry<T>;
    if (Date.now() - parsed.t > TTL_MS) {
      window.localStorage.removeItem(safeKey(scope, key));
      return null;
    }
    return parsed.v;
  } catch {
    return null;
  }
}

function pruneIfNeeded() {
  if (typeof window === "undefined") return;
  try {
    const keys: { k: string; t: number }[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(k) ?? "{}");
        keys.push({ k, t: parsed?.t ?? 0 });
      } catch {
        /* ignore */
      }
    }
    if (keys.length <= MAX_ENTRIES) return;
    keys.sort((a, b) => a.t - b.t);
    const over = keys.length - MAX_ENTRIES;
    for (let i = 0; i < over; i++) window.localStorage.removeItem(keys[i].k);
  } catch {
    /* ignore */
  }
}

/**
 * Read-through helper for TanStack Query: returns cached data as `initialData`
 * so the page renders instantly offline; the live `queryFn` then refreshes it.
 */
export function cachedInitialData<T>(scope: string, key: string): T | undefined {
  const v = readPlanCache<T>(scope, key);
  return v ?? undefined;
}