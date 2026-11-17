/**
 * Swipe down to close a bottom sheet (Instagram's, TikTok's): the post's sheet
 * (PostSheet, Reels') and every sheet that turns it on (SheetContent
 * `swipeToClose`, useSwipeDownToClose). When a finger is a drag of the sheet,
 * and when letting go closes it. Pure so the rules are tested.
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

/**
 * What a finger that has moved (dx, dy from where it went down) is doing:
 * "wait" until it's gone far enough to tell, "drag" the sheet when it's
 * mostly downward, else "pass" (up scrolls the sheet's list, sideways is a
 * row of tabs or a carousel inside it).
 */
export function sheetDragIntent(dx: number, dy: number): "wait" | "drag" | "pass" {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SHEET_DRAG_START_PX) return "wait";
  return dy > 0 && dy >= Math.abs(dx) ? "drag" : "pass";
}
