/**
 * Swipe down to close a bottom sheet (Instagram's, TikTok's): the post's sheet
 * (PostSheet, Reels') and every sheet that turns it on (SheetContent
 * `swipeToClose`, useSwipeDownToClose). When a finger is a drag of the sheet,
 * and when letting go closes it. The post's sheet also opens up to nearly the
 * whole screen (Nov 21 2026): a drag up grows it, a drag down from full brings
 * it back to half or closes it. Pure so the rules are tested.
 */

/** How much of the screen the sheet takes; the post shrinks into the rest above it (Reels'). */
export const POST_SHEET_HEIGHT = "62svh";
/** Opened up (a drag up, or a tap on the grip): the whole screen under the status bar, for a long caption or thread. */
export const POST_SHEET_FULL_HEIGHT = "calc(100svh - var(--app-safe-top, 0px) - var(--app-chrome-top, 0px) - 0.75rem)";

/** A finger has to move this far before the sheet decides it's a drag (or a scroll). */
export const SHEET_DRAG_START_PX = 6;
/** Pulled this share of its own height down: it closes. */
export const SHEET_CLOSE_SHARE = 0.25;
/** Or flicked down at least this fast (px per ms) and this far. */
export const SHEET_FLICK_SPEED = 0.5;
export const SHEET_FLICK_MIN_PX = 30;
/** Grown this far up (or flicked up), it opens to full; less springs back to half. */
export const SHEET_GROW_PX = 56;
/** From full, pulled down this far without closing: back to half. */
export const SHEET_SHRINK_PX = 64;

/** One swipe closes it: far enough down, or a quick flick; a little nudge springs back. */
export function sheetDragCloses({ dy, ms, height }: { dy: number; ms: number; height: number }): boolean {
  if (dy <= 0) return false;
  if (height > 0 && dy >= height * SHEET_CLOSE_SHARE) return true;
  return dy >= SHEET_FLICK_MIN_PX && dy / Math.max(1, ms) >= SHEET_FLICK_SPEED;
}

/** A drag up (`up` px, positive) opens it to full: far enough, or a quick flick. */
export function sheetDragGrows({ up, ms }: { up: number; ms: number }): boolean {
  if (up <= 0) return false;
  if (up >= SHEET_GROW_PX) return true;
  return up >= SHEET_FLICK_MIN_PX && up / Math.max(1, ms) >= SHEET_FLICK_SPEED;
}

/**
 * Where a full sheet goes when a drag down (dy px) lets go: "close" (far, or
 * a flick), "half" (a real pull that didn't close it), else back to "full".
 */
export function sheetFullRelease({ dy, ms, height }: { dy: number; ms: number; height: number }): "close" | "half" | "full" {
  if (sheetDragCloses({ dy, ms, height })) return "close";
  return dy >= SHEET_SHRINK_PX ? "half" : "full";
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

/**
 * The same, for a sheet that can open up: mostly upward while it's at half
 * is "grow" (the sheet grows with the finger before anything inside it
 * scrolls, Instagram's), whatever's scrolled inside it.
 */
export function sheetDragMode(dx: number, dy: number, o: { canGrow: boolean }): "wait" | "drag" | "grow" | "pass" {
  const intent = sheetDragIntent(dx, dy);
  if (intent !== "pass") return intent;
  return o.canGrow && dy < 0 && -dy >= Math.abs(dx) ? "grow" : "pass";
}
