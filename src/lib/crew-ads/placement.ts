/**
 * Crew promos (T01): where JF Effect's own promotions go in the Crew feed and
 * which one. Pure and tested in crew-ads.test.ts; the feed (community-screen)
 * places them, crew_promos_for_me() says which are live for the person
 * (nothing for a service they already have, nothing they dismissed) and how
 * many they've seen today.
 *
 * The rules: the first after 8 to 10 posts (the same number all visit), then
 * one every 12 posts or more; at most 2 a visit and 3 a day; none until the
 * feed has that many posts of its own; none while a workout is going.
 */
export const FIRST_AFTER_MIN = 8;
export const FIRST_AFTER_MAX = 10;
export const EVERY = 12;
export const MAX_PER_SESSION = 2;
export const MAX_PER_DAY = 3;
export const SPONSORED_LABEL = "Sponsored · JF Effect";

export type Promo = { id: string; headline: string; body: string | null; cta_label: string; cta_path: string };

/** A visit's own number from its key, 8 to 10, so the first promo doesn't move as pages load. */
export function firstAfter(sessionKey: string): number {
  let h = 0;
  for (let i = 0; i < sessionKey.length; i++) h = (h * 31 + sessionKey.charCodeAt(i)) >>> 0;
  return FIRST_AFTER_MIN + (h % (FIRST_AFTER_MAX - FIRST_AFTER_MIN + 1));
}

/**
 * After which posts (0-based index of the post the promo follows) a promo
 * goes, given how many posts are loaded. `shownToday` counts promos already
 * seen today (other visits); `shownThisVisit` those this visit has shown.
 */
export function promoSlots(o: {
  posts: number;
  sessionKey: string;
  shownToday: number;
  workoutGoing: boolean;
  available: number;
}): number[] {
  if (o.workoutGoing || o.available <= 0) return [];
  const room = Math.max(0, Math.min(MAX_PER_SESSION, MAX_PER_DAY - o.shownToday));
  const out: number[] = [];
  let after = firstAfter(o.sessionKey);
  while (out.length < room) {
    // a promo only ever follows real posts: the feed must have that many of its own first
    if (after > o.posts) break;
    out.push(after - 1);
    after += EVERY;
  }
  return out;
}

/** Which promo fills the n-th slot this visit: a different one each time, never the same one twice in a visit. */
export function promoFor(promos: readonly Promo[], slot: number): Promo | null {
  return promos[slot] ?? null;
}

/** Only links inside the app (the database checks the same). */
export function safePromoPath(path: string): string | null {
  return /^\/[A-Za-z0-9/_?=&.#-]*$/.test(path) && !path.startsWith("//") ? path : null;
}
