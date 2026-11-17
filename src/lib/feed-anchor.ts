/**
 * When this visit to the Crew started: the moment the feed measures "new to
 * you" against (community_feed_ranked's `seen_before`). It stays put for the
 * whole visit, so posts you scroll past don't jump out from under you when the
 * feed reloads; a new visit starts it again: opening the app, coming back
 * after RESUME_NEW_VISIT_MS away, or asking for the newest (tapping Crew while
 * you're on it, or the New posts pill: `rollFeedAnchor`). A new visit also
 * puts the feed back on Crew (`onNewVisit`): Following is a look you choose,
 * never where the feed opens.
 */
export const RESUME_NEW_VISIT_MS = 30 * 60_000;

let anchor = 0;
let hiddenAt: number | null = null;
let listening = false;
const visitListeners = new Set<() => void>();

function startVisit(now: number) {
  anchor = now;
  visitListeners.forEach((fn) => fn());
}

/** Away this long counts as a new visit. */
export function isNewVisit(awaySince: number | null, now: number): boolean {
  return awaySince !== null && now - awaySince >= RESUME_NEW_VISIT_MS;
}

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    const now = Date.now();
    if (document.visibilityState === "hidden") {
      hiddenAt = now;
      return;
    }
    const fresh = isNewVisit(hiddenAt, now);
    hiddenAt = null;
    if (fresh) startVisit(now);
  });
}

/** The visit's moment (ISO), started on first use. */
export function feedAnchor(now = Date.now()): string {
  listen();
  if (!anchor) anchor = now;
  return new Date(anchor).toISOString();
}

/** A new visit from now: the next load leads with what's new since. */
export function rollFeedAnchor(now = Date.now()): void {
  startVisit(now);
}

/**
 * Called each time a new visit starts after this (back after
 * RESUME_NEW_VISIT_MS away, a tap on Crew while on it, the New posts pill);
 * never for the first one, which a fresh screen already is. Returns the
 * unsubscribe.
 */
export function onNewVisit(fn: () => void): () => void {
  listen();
  visitListeners.add(fn);
  return () => {
    visitListeners.delete(fn);
  };
}
