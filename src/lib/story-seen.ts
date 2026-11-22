import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Story moments this viewer has watched that the rings should already know
 * about. Someone else's: the server keeps them (community_post_views → `seen`
 * on the post), and this holds the ones watched since the feed loaded, so a
 * ring turns grey the moment you've watched it, everywhere it shows. Your
 * own: views never count the author (the counts stay honest), so watching
 * your own story is kept on this phone for two days (a story lasts one),
 * Instagram's "Your story" going grey once you've seen it.
 */
const KEY = "jf-own-story-seen-v1";
const KEEP_MS = 2 * 86_400_000;

let session = new Set<string>();
let own: Record<string, number> = load();
let snapshot: ReadonlySet<string> = build();
const listeners = new Set<() => void>();

function load(): Record<string, number> {
  try {
    if (typeof window === "undefined") return {};
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => typeof t === "number" && now - t < KEEP_MS));
  } catch {
    return {};
  }
}

function save() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(own));
  } catch {
    /* private mode or blocked storage: it still holds for this visit */
  }
}

function build(): ReadonlySet<string> {
  return new Set([...session, ...Object.keys(own)]);
}

/** A moment shown in the story viewer (`mine`: your own, remembered on this phone). */
export function markStorySeen(postId: string, mine = false) {
  if (snapshot.has(postId)) return;
  session = new Set(session).add(postId);
  if (mine) {
    own = { ...own, [postId]: Date.now() };
    save();
  }
  snapshot = build();
  listeners.forEach((f) => f());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const EMPTY: ReadonlySet<string> = new Set();

/** What's been watched (this visit, and your own on this phone): stable until something new is watched. */
export function useSeenStories(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

/** For tests: start over. */
export function resetSeenStories() {
  session = new Set();
  own = {};
  snapshot = build();
}

/** The clock rings are read against, a minute at a time, so a story that runs out loses its ring by itself. */
export function useStoryClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}
