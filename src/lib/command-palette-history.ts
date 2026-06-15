/**
 * Lightweight localStorage-backed history for the command palette:
 *  - Recent picks (entries the user has opened recently)
 *  - Recent searches (free-text queries)
 *  - Frequent picks (counted)
 */

const RECENT_PICKS_KEY = "jf-cp-recents-v1";
const RECENT_QUERIES_KEY = "jf-cp-queries-v1";
const FREQUENT_PICKS_KEY = "jf-cp-frequent-v1";
const MAX_RECENTS = 12;
const MAX_QUERIES = 8;

export type RecentPick = {
  id: string;
  label: string;
  to: string;
  category?: string;
  parent?: string;
  at: number;
};

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export function getRecentPicks(): RecentPick[] {
  return safeRead<RecentPick[]>(RECENT_PICKS_KEY, []);
}

export function pushRecentPick(pick: Omit<RecentPick, "at">) {
  const list = getRecentPicks().filter((r) => r.id !== pick.id);
  list.unshift({ ...pick, at: Date.now() });
  safeWrite(RECENT_PICKS_KEY, list.slice(0, MAX_RECENTS));
  // Bump frequency counter
  const freq = safeRead<Record<string, { count: number; pick: Omit<RecentPick, "at"> }>>(
    FREQUENT_PICKS_KEY, {},
  );
  freq[pick.id] = { count: (freq[pick.id]?.count ?? 0) + 1, pick };
  safeWrite(FREQUENT_PICKS_KEY, freq);
}

export function getFrequentPicks(limit = 6): Omit<RecentPick, "at">[] {
  const freq = safeRead<Record<string, { count: number; pick: Omit<RecentPick, "at"> }>>(
    FREQUENT_PICKS_KEY, {},
  );
  return Object.values(freq)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => e.pick);
}

export function getRecentQueries(): string[] {
  return safeRead<string[]>(RECENT_QUERIES_KEY, []);
}

export function pushRecentQuery(q: string) {
  const clean = q.trim();
  if (clean.length < 2) return;
  const list = getRecentQueries().filter((s) => s.toLowerCase() !== clean.toLowerCase());
  list.unshift(clean);
  safeWrite(RECENT_QUERIES_KEY, list.slice(0, MAX_QUERIES));
}

export function clearRecentQueries() {
  safeWrite(RECENT_QUERIES_KEY, []);
}

export function clearRecentPicks() {
  safeWrite(RECENT_PICKS_KEY, []);
}