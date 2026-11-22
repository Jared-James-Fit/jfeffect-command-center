/**
 * Swipe to create (Nov 22 2026): on Crew's feed, the camera sits to the left
 * (where Crew's + is), Instagram's way, so a finger moving right pulls it in
 * over the feed and lets go of it the same way. Pure and tested: the hook in
 * swipe-to-create.tsx only reads the finger and paints.
 *
 * Why right and not left: most posts with a workout are carousels whose last
 * swipe left is the recap, so a leftward gesture would fight the feed's most
 * common sideways swipe; a carousel only scrolls right once it has moved on
 * from its first slide, and then the swipe is the carousel's.
 */

/** How far a finger moves before its direction is read. */
export const CREATE_SLOP_PX = 10;
/** Sideways enough to be this gesture: at least this many times as far across as up or down. */
export const CREATE_SIDEWAYS_RATIO = 1.3;
/** Let go past this share of the screen: the camera opens. */
export const CREATE_COMMIT_SHARE = 0.33;
/** ...or flicked at least this fast (px/ms) and this far. */
export const CREATE_FLICK_SPEED = 0.45;
export const CREATE_FLICK_MIN_PX = 40;
/** In Safari (not the home-screen app) a swipe from this close to the left edge is the browser's Back. */
export const SAFARI_EDGE_PX = 22;
/** How dark the feed gets under the camera as it comes in (at the camera fully in). */
export const FEED_DIM = 0.6;

export type CreateIntent = "wait" | "mine" | "theirs";

/**
 * What a finger that has moved (dx, dy) since it landed is doing: still
 * deciding, pulling the camera in, or someone else's (a scroll up or down, a
 * carousel or the stories moving left, a pinch). `scrolled`: the page moved
 * under it already (a scroll that started before the direction was clear).
 */
export function createSwipeIntent(dx: number, dy: number, scrolled = false): CreateIntent {
  if (scrolled) return "theirs";
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < CREATE_SLOP_PX && ay < CREATE_SLOP_PX) return "wait";
  if (dx > 0 && ax >= ay * CREATE_SIDEWAYS_RATIO) return "mine";
  return "theirs";
}

/** How far in the camera is (0 = off the screen to the left, 1 = covering it): the finger's travel, never past the screen. */
export function createProgress(dx: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.max(0, Math.min(1, dx / width));
}

/** Whether letting go opens the camera: far enough, or a flick toward it; a flick back the other way never does. */
export function createSwipeCommits(dx: number, width: number, speed: number): boolean {
  if (speed < -CREATE_FLICK_SPEED) return false;
  if (createProgress(dx, width) >= CREATE_COMMIT_SHARE) return true;
  return speed >= CREATE_FLICK_SPEED && dx >= CREATE_FLICK_MIN_PX;
}

/**
 * How long the rest of the slide takes once the finger lets go: the distance
 * left, never slower than the finger was going (a fast flick lands fast),
 * between 120 and 300 ms.
 */
export function createSettleMs(progress: number, opening: boolean, speed: number, width: number): number {
  const left = opening ? 1 - progress : progress;
  const px = left * Math.max(width, 1);
  const bySpeed = Math.abs(speed) > 0.05 ? px / Math.abs(speed) : Infinity;
  const byDistance = 300 * left;
  return Math.round(Math.max(120, Math.min(300, byDistance, bySpeed)));
}

/** The finger's speed (px/ms) over its last moments: the newest point against the oldest within `windowMs`. */
export function swipeSpeed(points: { x: number; t: number }[], windowMs = 90): number {
  if (points.length < 2) return 0;
  const last = points[points.length - 1];
  let first = last;
  for (let i = points.length - 2; i >= 0; i--) {
    if (last.t - points[i].t > windowMs) break;
    first = points[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

/**
 * Where a gesture may never start: a text box, a slider, a video's scrub bar,
 * anything marked off. A button is fine (a finger that moves is never its tap:
 * the click after a pull is swallowed), as on Instagram.
 */
export const CREATE_NO_START = "input, textarea, select, [contenteditable=true], [role=slider], [data-video-scrubber], [data-no-create-swipe]";
