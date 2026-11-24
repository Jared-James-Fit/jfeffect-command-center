/**
 * Which of Crew's paged feed posts are on the page (Nov 23 2026). Only the
 * posts around the one on screen are mounted, the first always (the stories
 * sit on it), FEED_BEHIND behind and FEED_AHEAD ahead; the rest are a black
 * box of the same height, so the scroll, its snap points and every link to a
 * post stay where they were.
 *
 * Why: with every post loaded so far on the page, each new page of posts
 * mounted at once (frames of up to half a second on a throttled phone, while a
 * finger was on the screen), and every frame re-layered all of them; measured
 * late in a 45-post feed, 4,971 DOM nodes and 82 compositor layers against
 * 1,468 and 44 with the window.
 */
export const FEED_BEHIND = 2;
export const FEED_AHEAD = 3;

/** Whether post number `k` (posts only, moments not counted) is on the page while post `around` is on screen. */
export function feedPostMounted(k: number, around: number): boolean {
  if (k < 0) return true;
  return k === 0 || (k >= around - FEED_BEHIND && k <= around + FEED_AHEAD);
}
