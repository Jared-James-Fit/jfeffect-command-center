/**
 * The POST · STORY selector's swipe (mode-selector.tsx), pure and tested.
 * A swipe this far, or a flick this fast, moves one mode; a flick back the
 * other way at the end of a drag wins (the finger changed its mind).
 */
export const MODE_SWIPE_PX = 24;
export const MODE_FLICK_SPEED = 0.3;

/**
 * Which mode a swipe on the selector lands on. `moves`: "row" (the labels
 * move with the finger, so a finger moving left brings in the next one) or
 * "thumb" (the pill's highlight moves with it, so a finger moving right goes
 * to the next one). Never past either end.
 */
export function modeAfterSwipe(index: number, count: number, dx: number, speed: number, moves: "row" | "thumb" = "row"): number {
  const s = moves === "row" ? -1 : 1;
  const d = dx * s;
  const v = speed * s;
  let step = 0;
  if (Math.abs(v) >= MODE_FLICK_SPEED) step = Math.sign(v);
  else if (Math.abs(d) >= MODE_SWIPE_PX) step = Math.sign(d);
  return Math.max(0, Math.min(count - 1, index + step));
}
