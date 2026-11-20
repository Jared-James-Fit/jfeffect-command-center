/**
 * The photo viewer's gestures (Nov 19 2026, media-viewer.tsx): pinch to
 * zoom, double-tap to zoom in and back, one finger to move a zoomed photo,
 * and a swipe up or down on an unzoomed photo to put it away. Pure, so the
 * rules are tested; the viewer only paints what these return.
 *
 * A view is where the photo is drawn: moved by (x, y) from its place and `s`
 * times its size, from its top-left corner (the same ZoomView the feed's
 * pinch uses, so pinchView / panView work on both).
 */
import { pinchView, panView, type ZoomView } from "@/hooks/use-media-pinch-zoom";
import { sheetDragCloses } from "@/lib/post-sheet";

export { pinchView, panView, type ZoomView };

/** Where the photo sits unzoomed, on screen. */
export type Box = { left: number; top: number; w: number; h: number };
/** The screen. */
export type Viewport = { w: number; h: number };
type Pt = { x: number; y: number };

export const IDENTITY: ZoomView = { x: 0, y: 0, s: 1 };
/** As far as a pinch goes (pinchView's own cap). */
export const PHOTO_MAX_SCALE = 4;
/** A double tap zooms in this far, on the spot tapped. */
export const DOUBLE_TAP_SCALE = 2.5;
/** Two taps this close in time and place are a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 28;
/** A finger that moves less than this and lifts quickly is a tap. */
export const TAP_SLOP_PX = 8;
export const TAP_MAX_MS = 350;
/** Under this the photo counts as unzoomed (a swipe puts it away, a pinch that ends here springs back). */
export const ZOOMED_MIN = 1.02;
/** How much of a pull past the edge the photo follows (a rubber band). */
export const RUBBER = 0.35;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The range x (or y) may take at scale `s`: a photo bigger than the screen
 * can be moved until its edge meets the screen's, never past it (no gap it
 * could fill); one that still fits stays centred where it was.
 */
function axis(len: number, start: number, screen: number, s: number): [number, number] {
  const scaled = len * s;
  if (scaled <= screen) {
    const centred = (len - scaled) / 2;
    return [centred, centred];
  }
  return [screen - start - scaled, -start];
}

export function viewBounds(s: number, box: Box, vp: Viewport) {
  const [minX, maxX] = axis(box.w, box.left, vp.w, s);
  const [minY, maxY] = axis(box.h, box.top, vp.h, s);
  return { minX, maxX, minY, maxY };
}

/** Where the photo settles when the fingers lift: back to its place under ZOOMED_MIN, else inside its bounds. */
export function clampView(view: ZoomView, box: Box, vp: Viewport): ZoomView {
  const s = clamp(view.s, 1, PHOTO_MAX_SCALE);
  if (s < ZOOMED_MIN) return IDENTITY;
  const b = viewBounds(s, box, vp);
  return { s, x: clamp(view.x, b.minX, b.maxX), y: clamp(view.y, b.minY, b.maxY) };
}

/** While a finger moves it: past an edge the photo follows a little (RUBBER), so the edge is felt, never hit. */
export function rubberView(view: ZoomView, box: Box, vp: Viewport): ZoomView {
  const b = viewBounds(view.s, box, vp);
  const band = (v: number, lo: number, hi: number) => (v < lo ? lo + (v - lo) * RUBBER : v > hi ? hi + (v - hi) * RUBBER : v);
  return { s: view.s, x: band(view.x, b.minX, b.maxX), y: band(view.y, b.minY, b.maxY) };
}

/** A double tap: zoomed in → back to its place; else DOUBLE_TAP_SCALE with the spot tapped kept under the finger. */
export function doubleTapView(view: ZoomView, box: Box, vp: Viewport, at: Pt): ZoomView {
  if (view.s >= ZOOMED_MIN) return IDENTITY;
  const s = DOUBLE_TAP_SCALE;
  // the photo's own point (unscaled, from its top-left) under the finger
  const lx = (at.x - box.left - view.x) / view.s;
  const ly = (at.y - box.top - view.y) / view.s;
  return clampView({ s, x: at.x - box.left - s * lx, y: at.y - box.top - s * ly }, box, vp);
}

/** A trackpad pinch or a scroll wheel over the photo: zoom around the pointer. */
export function wheelView(view: ZoomView, box: Box, vp: Viewport, at: Pt, deltaY: number, pinch: boolean): ZoomView {
  const s = clamp(view.s * Math.exp(-deltaY * (pinch ? 0.01 : 0.002)), 1, PHOTO_MAX_SCALE);
  const lx = (at.x - box.left - view.x) / view.s;
  const ly = (at.y - box.top - view.y) / view.s;
  return clampView({ s, x: at.x - box.left - s * lx, y: at.y - box.top - s * ly }, box, vp);
}

/** Two taps close enough in time and place. */
export function isDoubleTap(prev: { t: number; x: number; y: number } | null, now: { t: number; x: number; y: number }): boolean {
  if (!prev) return false;
  return now.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(now.x - prev.x, now.y - prev.y) <= DOUBLE_TAP_SLOP_PX;
}

/**
 * What one finger on an unzoomed photo is doing once it has moved (dx, dy):
 * "wait" until it's gone far enough to tell, "drag" the photo away when it's
 * mostly up or down, else "pass" (sideways does nothing).
 */
export function dismissIntent(dx: number, dy: number): "wait" | "drag" | "pass" {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < TAP_SLOP_PX) return "wait";
  return Math.abs(dy) >= Math.abs(dx) ? "drag" : "pass";
}

/** Letting go of a photo pulled away: far enough (a quarter of its height) or a flick puts it away, else it springs back. */
export function dismissCloses(dy: number, ms: number, photoHeight: number): boolean {
  return sheetDragCloses({ dy: Math.abs(dy), ms, height: photoHeight });
}

/** How the photo and the dark behind it look while it's pulled away (`dy` px): a little smaller, the page showing through. */
export function dismissLook(dy: number, screenHeight: number): { scale: number; shade: number } {
  const p = Math.min(1, Math.abs(dy) / Math.max(1, screenHeight * 0.5));
  return { scale: 1 - 0.18 * p, shade: 1 - 0.85 * p };
}

/**
 * The morph between the small avatar and the open photo (FLIP): how to move
 * and scale the photo, from its open place, to sit exactly over `from`.
 */
export function flipFrom(from: { left: number; top: number; width: number; height: number }, to: Box): { x: number; y: number; s: number } {
  const s = to.w > 0 ? from.width / to.w : 1;
  const x = from.left + from.width / 2 - (to.left + to.w / 2);
  const y = from.top + from.height / 2 - (to.top + to.h / 2);
  return { x, y, s };
}

/**
 * A Crew photo is saved twice (community-media.ts): 512 px for every face
 * in the app, and a full-size copy beside it (`…-full.jpg`) that only the
 * photo viewer loads. Null for anything else (an account photo is already
 * saved full size, a link is what it is).
 */
export function fullAvatarPath(path: string | null | undefined): string | null {
  if (!path || /^(https?:|data:|blob:)/i.test(path)) return null;
  const m = /^(.*\/community-\d+)\.jpg$/.exec(path);
  return m ? `${m[1]}-full.jpg` : null;
}
