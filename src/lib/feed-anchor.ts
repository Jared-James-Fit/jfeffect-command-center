/**
 * When this visit to the Crew started: the moment the feed measures "new to
 * you" against (community_feed_ranked's `seen_before`). It stays put for the
 * whole visit, so posts you scroll past don't jump out from under you when the
 * feed reloads; a new visit starts it again: opening the app, coming back
 * after RESUME_NEW_VISIT_MS away, or asking for the newest (tapping Crew while
 * you're on it, or the New posts pill: `rollFeedAnchor`).
 */
export const RESUME_NEW_VISIT_MS = 30 * 60_000;

let anchor = 0;
let hiddenAt: number | null = null;
let listening = false;

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
    if (isNewVisit(hiddenAt, now)) anchor = now;
    hiddenAt = null;
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
  anchor = now;
}
