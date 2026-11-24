/**
 * Which slide each post's carousel on its screen was left on, for the visit
 * (Nov 23 2026). Crew's paged feed keeps only the posts near the one on
 * screen (feed-window.ts), so scrolling back to a post it let go remounts it:
 * it opens on the slide it was left on instead of the first, as Instagram's
 * do. In memory only, the most recent last, capped.
 */
const places = new Map<string, number>();
export const CAROUSEL_PLACES_MAX = 300;

export function rememberCarouselPlace(key: string, slide: number): void {
  places.delete(key);
  if (slide > 0) places.set(key, slide);
  if (places.size > CAROUSEL_PLACES_MAX) places.delete(places.keys().next().value as string);
}

/** The slide to open on: where it was left, within the carousel's `count` slides; 0 with no key or nothing remembered. */
export function carouselPlace(key: string | undefined, count: number): number {
  if (!key || count < 1) return 0;
  return Math.max(0, Math.min(count - 1, places.get(key) ?? 0));
}

/** Tests only. */
export function forgetCarouselPlaces(): void {
  places.clear();
}
