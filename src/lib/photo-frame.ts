/**
 * Framing a photo or clip inside the shape it's posted at, Instagram's way.
 *
 * The feed shows a post at its own shape between 4:5 (tallest) and 16:9
 * (widest); the profile grid shows every post as a 3:4 tile cut from the
 * middle of it; a story is 9:16. So a post is framed before it goes up:
 *
 *   photo  drag to move it, pinch to zoom (never smaller than the frame),
 *          and the frame is baked into the file that's posted, so the feed,
 *          the grid and the post page all show exactly what was framed.
 *   clip   a video can't be re-cut on the phone, so it's posted whole with a
 *          `focus` (which part shows when the feed or grid crops it, as CSS
 *          object-position) and a cover frame picked from the clip.
 *
 * Everything here is plain math on sizes (no DOM), so it's tested on its own.
 */

export type Size = { w: number; h: number };
export type Point = { x: number; y: number };

/**
 * How a photo sits in its frame: `z` is the zoom over the smallest size that
 * fills the frame (1 = fills it exactly), `cx`/`cy` the middle of the part on
 * show, as a share of the photo's width / height (0.5 / 0.5 = centred).
 */
export type Framing = { z: number; cx: number; cy: number };

/** Which part of a cropped clip or photo shows (CSS object-position, 0..1 each way). */
export type MediaFocus = { x: number; y: number };

export const CENTRED: Framing = { z: 1, cx: 0.5, cy: 0.5 };
export const MAX_ZOOM = 5;

/** The shapes a post can be (width / height). */
export const POST_ASPECTS = { portrait: 4 / 5, square: 1, landscape: 16 / 9 } as const;
export type PostAspect = keyof typeof POST_ASPECTS;
export const POST_ASPECT_ORDER: PostAspect[] = ["portrait", "square", "landscape"];
export const POST_ASPECT_LABEL: Record<PostAspect, string> = { portrait: "4:5", square: "1:1", landscape: "16:9" };
export const STORY_ASPECT = 9 / 16;
/** The profile grid's tiles (Instagram's since 2025). */
export const GRID_ASPECT = 3 / 4;
/** The feed's limits: never taller than 4:5, never wider than 16:9. */
export const FEED_MIN_ASPECT = 0.8;
export const FEED_MAX_ASPECT = 1.78;
/** What's posted is this wide (Instagram's width); the height follows the shape. */
export const OUTPUT_WIDTH = 1080;

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const finite = (v: number, d: number) => (Number.isFinite(v) ? v : d);

/** The shape the feed shows something at (w/h), from its size. */
export function feedAspect(w: number | null | undefined, h: number | null | undefined): number {
  const a = (w ?? 4) / (h ?? 5);
  return clamp(finite(a, 0.8), FEED_MIN_ASPECT, FEED_MAX_ASPECT);
}

/** Next shape for the crop's shape button (4:5 → 1:1 → 16:9 → 4:5). */
export function nextAspect(a: PostAspect): PostAspect {
  return POST_ASPECT_ORDER[(POST_ASPECT_ORDER.indexOf(a) + 1) % POST_ASPECT_ORDER.length];
}

/** What's posted for a shape: 1080 wide. */
export function outputSize(aspect: number): Size {
  return { w: OUTPUT_WIDTH, h: Math.round(OUTPUT_WIDTH / aspect) };
}

/** The scale (photo px → frame px) at which the photo just fills the frame. */
export function coverScale(img: Size, frame: Size): number {
  if (!img.w || !img.h) return 1;
  return Math.max(frame.w / img.w, frame.h / img.h);
}

/** How much of the photo is on show at zoom `z`, as a share of its width / height (≤ 1). */
export function visibleShare(img: Size, frame: Size, z: number): Size {
  const s = coverScale(img, frame) * z;
  return { w: Math.min(1, frame.w / (img.w * s)), h: Math.min(1, frame.h / (img.h * s)) };
}

/** Keep the zoom in range and the photo covering the frame (no empty edges, ever). */
export function clampFraming(f: Framing, img: Size, frame: Size): Framing {
  const z = clamp(finite(f.z, 1), 1, MAX_ZOOM);
  const v = visibleShare(img, frame, z);
  return { z, cx: clamp(finite(f.cx, 0.5), v.w / 2, 1 - v.w / 2), cy: clamp(finite(f.cy, 0.5), v.h / 2, 1 - v.h / 2) };
}

/** Where the photo sits on screen: its drawn size and its top-left corner inside the frame. */
export function placement(f: Framing, img: Size, frame: Size): { w: number; h: number; x: number; y: number } {
  const s = coverScale(img, frame) * f.z;
  const w = img.w * s;
  const h = img.h * s;
  return { w, h, x: frame.w / 2 - f.cx * w, y: frame.h / 2 - f.cy * h };
}

/** Drag by (dx, dy) screen px: the photo follows the finger. */
export function panFraming(f: Framing, dx: number, dy: number, img: Size, frame: Size): Framing {
  const s = coverScale(img, frame) * f.z;
  return clampFraming({ z: f.z, cx: f.cx - dx / (img.w * s), cy: f.cy - dy / (img.h * s) }, img, frame);
}

/**
 * Two fingers: zoom by how far apart they are now against when they landed,
 * keeping the spot that was under them under them (so it zooms where you
 * pinch, and moving both fingers moves the photo). Points are in frame px.
 */
export function pinchFraming(start: Framing, m0: Point, d0: number, m: Point, d: number, img: Size, frame: Size): Framing {
  const base = coverScale(img, frame);
  const z = clamp(start.z * (d / (d0 || 1)), 1, MAX_ZOOM);
  const s0 = base * start.z;
  const s = base * z;
  const px = start.cx + (m0.x - frame.w / 2) / (img.w * s0);
  const py = start.cy + (m0.y - frame.h / 2) / (img.h * s0);
  return clampFraming({ z, cx: px - (m.x - frame.w / 2) / (img.w * s), cy: py - (m.y - frame.h / 2) / (img.h * s) }, img, frame);
}

/**
 * Centring help: within `px` screen pixels of dead centre (on an axis the
 * photo can move along) it snaps there. Says which lines it's on, so the
 * guide can light up.
 */
export function snapToCentre(f: Framing, img: Size, frame: Size, px = 8): { framing: Framing; v: boolean; h: boolean } {
  const vis = visibleShare(img, frame, f.z);
  const s = coverScale(img, frame) * f.z;
  const v = vis.w < 0.999 && Math.abs(f.cx - 0.5) * img.w * s <= px;
  const h = vis.h < 0.999 && Math.abs(f.cy - 0.5) * img.h * s <= px;
  return { framing: { z: f.z, cx: v ? 0.5 : f.cx, cy: h ? 0.5 : f.cy }, v, h };
}

/**
 * The part of the photo a frame of this shape shows, in photo px (what's
 * drawn when it's posted). The frame's size doesn't matter, only its shape.
 */
export function cropRect(f: Framing, img: Size, aspect: number): { sx: number; sy: number; sw: number; sh: number } {
  const frame = { w: aspect, h: 1 };
  const c = clampFraming(f, img, frame);
  const vis = visibleShare(img, frame, c.z);
  const sw = vis.w * img.w;
  const sh = vis.h * img.h;
  return { sx: (c.cx - vis.w / 2) * img.w, sy: (c.cy - vis.h / 2) * img.h, sw, sh };
}

/**
 * The framing that shows what the camera's guide showed: the viewfinder
 * fills `view` with the shot (cover), and the guide is the frame-shaped part
 * in its middle. Centred, zoomed in by however much the viewfinder was.
 */
export function framingFromGuide(img: Size, view: Size, guide: Size): Framing {
  if (!guide.w || !guide.h || !view.w || !view.h) return CENTRED;
  return clampFraming({ z: coverScale(img, view) / coverScale(img, guide), cx: 0.5, cy: 0.5 }, img, guide);
}

/** The middle frame-shaped band of a box (the post's part of a 9:16 viewfinder). */
export function guideBand(box: Size, aspect: number): { x: number; y: number; w: number; h: number } {
  const w = Math.min(box.w, box.h * aspect);
  const h = w / aspect;
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
}

/**
 * The profile grid's tile inside a frame of this shape, as shares of the
 * frame: the middle 3:4 of it.
 */
export function gridWindow(aspect: number): { x: number; y: number; w: number; h: number } {
  if (aspect > GRID_ASPECT) {
    const w = GRID_ASPECT / aspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = aspect / GRID_ASPECT;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/* ---- clips (and older posts): which part shows when they're cropped ---- */

export const CENTRE_FOCUS: MediaFocus = { x: 0.5, y: 0.5 };

/** A stored focus, checked (anything odd → centred). */
export function cleanFocus(f: unknown): MediaFocus | null {
  if (!f || typeof f !== "object") return null;
  const x = Number((f as { x?: unknown }).x);
  const y = Number((f as { y?: unknown }).y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/** CSS object-position for a focus ("50% 30%"); undefined when centred or unset (the default). */
export function focusPosition(f: MediaFocus | null | undefined): string | undefined {
  const c = cleanFocus(f);
  if (!c || (Math.abs(c.x - 0.5) < 0.005 && Math.abs(c.y - 0.5) < 0.005)) return undefined;
  return `${Math.round(c.x * 1000) / 10}% ${Math.round(c.y * 1000) / 10}%`;
}

/** How far a cropped (object-cover) picture overflows its frame each way, in frame px. */
export function coverOverflow(media: Size, frame: Size): Size {
  const s = coverScale(media, frame);
  return { w: Math.max(0, media.w * s - frame.w), h: Math.max(0, media.h * s - frame.h) };
}

/** Drag a cropped picture by (dx, dy) px: it follows the finger (object-position moves the other way). */
export function panFocus(f: MediaFocus, dx: number, dy: number, media: Size, frame: Size): MediaFocus {
  const o = coverOverflow(media, frame);
  return {
    x: o.w > 0.5 ? clamp(f.x - dx / o.w, 0, 1) : f.x,
    y: o.h > 0.5 ? clamp(f.y - dy / o.h, 0, 1) : f.y,
  };
}

/** Within `px` of centre on an axis it can move along: snap there (and say so). */
export function snapFocus(f: MediaFocus, media: Size, frame: Size, px = 8): { focus: MediaFocus; v: boolean; h: boolean } {
  const o = coverOverflow(media, frame);
  const v = o.w > 0.5 && Math.abs(f.x - 0.5) * o.w <= px;
  const h = o.h > 0.5 && Math.abs(f.y - 0.5) * o.h <= px;
  return { focus: { x: v ? 0.5 : f.x, y: h ? 0.5 : f.y }, v, h };
}
