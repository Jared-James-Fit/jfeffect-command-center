/**
 * The feed's post sheet (PostSheet, Reels'): when a drag down lets it go.
 * Pure so the rule is tested.
 */

/** How much of the screen the sheet takes; the post shrinks into the rest above it (Reels'). */
export const POST_SHEET_HEIGHT = "62svh";

/** A finger has to move this far before the sheet decides it's a drag (or a scroll). */
export const SHEET_DRAG_START_PX = 6;
/** Pulled this share of its own height down: it closes. */
export const SHEET_CLOSE_SHARE = 0.25;
/** Or flicked down at least this fast (px per ms) and this far. */
export const SHEET_FLICK_SPEED = 0.5;
export const SHEET_FLICK_MIN_PX = 30;

/** One swipe closes it: far enough down, or a quick flick; a little nudge springs back. */
export function sheetDragCloses({ dy, ms, height }: { dy: number; ms: number; height: number }): boolean {
  if (dy <= 0) return false;
  if (height > 0 && dy >= height * SHEET_CLOSE_SHARE) return true;
  return dy >= SHEET_FLICK_MIN_PX && dy / Math.max(1, ms) >= SHEET_FLICK_SPEED;
}
