/**
 * Framing a photo or clip inside the shape it's posted at, Instagram's way.
 *
 * A post has one shape for every slide (Instagram's carousel rule): 9:16
 * (the Crew feed's full screen), 4:5, 1:1 or 16:9. The profile grid shows
 * every post as a 3:4 tile cut from the middle of it; a story is 9:16. So
 * every slide is framed before it goes up (drag to move it, pinch to zoom,
 * never smaller than the frame):
 *
 *   photo  the frame is baked into the file that's posted, so the feed, the
 *          grid and the post page all show exactly what was framed.
 *   clip   a video can't be re-cut on the phone, so it goes up whole with its
 *          frame (`ClipFrame`, kept in the slide's `focus`): the shape, the
 *          zoom and the middle of what shows. Every screen that plays it
 *          shows just that part (framedMediaStyle), and its poster is baked
 *          to the frame like a photo.
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

/**
 * Which part of a cropped clip or photo shows. Without `a` it's the older
 * focus: CSS object-position, 0..1 each way. With `a` it's a clip framed in
 * the studio (ClipFrame): shown at the shape `a` (w / h), zoomed `z` over just
 * filling it, centred on (x, y) as shares of the clip's width / height.
 */
export type MediaFocus = { x: number; y: number; z?: number; a?: number };
/** A clip's frame from the studio: what every screen shows of it. */
export type ClipFrame = { a: number; z: number; x: number; y: number };

export const CENTRED: Framing = { z: 1, cx: 0.5, cy: 0.5 };
export const MAX_ZOOM = 5;

/** The shapes a post can be (width / height): 9:16 fills a phone's screen in the Crew feed. */
export const POST_ASPECTS = { full: 9 / 16, portrait: 4 / 5, square: 1, landscape: 16 / 9 } as const;
export type PostAspect = keyof typeof POST_ASPECTS;
export const POST_ASPECT_ORDER: PostAspect[] = ["full", "portrait", "square", "landscape"];
export const POST_ASPECT_LABEL: Record<PostAspect, string> = { full: "9:16", portrait: "4:5", square: "1:1", landscape: "16:9" };
export const STORY_ASPECT = 9 / 16;
/**
 * Where a full-screen (9:16) post is covered on its screen in the Crew feed,
 * as shares of the frame (the studio's safe-zone guide, TikTok's): Crew's bar
 * over its top, the name and caption over its bottom, the buttons down the
 * right from about halfway down.
 */
export const SCREEN_ZONES = { top: 0.11, bottom: 0.17, right: 0.14, buttonsTop: 0.5 } as const;
/** The profile grid's tiles (Instagram's since 2025). */
export const GRID_ASPECT = 3 / 4;
/** The feed's limits for a picture: never taller than 4:5, never wider than 16:9. */
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

/**
 * A clip in the feed shows whole, at its own shape (a phone's 9:16 to a
 * 16:9), never cropped to the picture limits: the frame is as tall as the
 * screen allows (FEED_VIDEO_MAX_HEIGHT) and the clip fits inside it.
 * Unknown size: 4:5, the shape a clip was shown at before.
 */
export const VIDEO_MIN_ASPECT = STORY_ASPECT;
export function videoAspect(w: number | null | undefined, h: number | null | undefined): number {
  if (!w || !h || w <= 0 || h <= 0) return FEED_MIN_ASPECT;
  return clamp(finite(w / h, FEED_MIN_ASPECT), VIDEO_MIN_ASPECT, FEED_MAX_ASPECT);
}
/** How tall a clip's frame gets in the feed: the screen less the post's name row, the buttons under it and the bars. */
export const FEED_VIDEO_MAX_HEIGHT = "calc(100svh - 15rem)";

/**
 * On a post's own screen of the Crew feed the screen is the canvas (TikTok /
 * Reels): a clip close to the screen's shape fills it, centred, trimmed
 * evenly off whichever sides stick out (top and bottom when it's taller, the
 * sides when it's wider, as a phone's 9:16 clip is on a tall phone's screen),
 * but never more than this share of the clip.
 */
export const SCREEN_FILL_MAX_TRIM = 0.25;

/**
 * How one slide sits on a post's screen (`screenRatio` = the screen's width /
 * height): "cover" fills it (a clip within SCREEN_FILL_MAX_TRIM of the
 * screen's shape: a 9:16 clip loses ~18% of its sides on a 390×844 screen,
 * TikTok's way), "contain" shows it whole, centred: the full width with black
 * above and below for anything wider (16:9, square, 4:5), which is every
 * photo (a photo is never trimmed: it was framed in the editor,
 * framedCanvas), an unknown shape, or a clip that would lose more than that.
 */
export function screenFit(
  slide: { type: "image" | "video"; width: number | null | undefined; height: number | null | undefined; focus?: MediaFocus | null },
  screenRatio: number | null | undefined,
): "cover" | "contain" {
  if (!screenRatio || !(screenRatio > 0)) return "contain";
  const media = slideAspect(slide);
  if (!media || !Number.isFinite(media) || media <= 0) return "contain";
  const trim = media < screenRatio ? 1 - media / screenRatio : 1 - screenRatio / media;
  // a photo or a clip framed in the studio only fills the screen when it was framed for it (9:16): what was
  // framed is never cut by more than a sliver; an unframed clip may lose up to a quarter (TikTok's)
  const framedByHand = slide.type === "image" || !!clipFrame(slide.focus);
  return trim <= (framedByHand ? PHOTO_FILL_MAX_TRIM : SCREEN_FILL_MAX_TRIM) ? "cover" : "contain";
}

/**
 * A photo, or a clip framed in the studio, fills a post's screen only when
 * it's the screen's own shape (framed 9:16): it loses a sliver on a tall
 * phone and ~10% on the shortest; anything else (4:5, 1:1, an older photo)
 * shows whole.
 */
export const PHOTO_FILL_MAX_TRIM = 0.12;

/** The shape a slide shows at (w / h): a framed clip's frame, else its own. Null when unknown. */
export function slideAspect(slide: { width: number | null | undefined; height: number | null | undefined; focus?: MediaFocus | null }): number | null {
  const f = clipFrame(slide.focus);
  if (f) return f.a;
  if (!slide.width || !slide.height || !(slide.width > 0) || !(slide.height > 0)) return null;
  return slide.width / slide.height;
}

/** Next shape for the crop's shape button (9:16 → 4:5 → 1:1 → 16:9 → 9:16). */
export function nextAspect(a: PostAspect): PostAspect {
  return POST_ASPECT_ORDER[(POST_ASPECT_ORDER.indexOf(a) + 1) % POST_ASPECT_ORDER.length];
}

/**
 * The shape a post starts at from its first photo or clip: the closest of the
 * four to its own (a phone's 9:16 clip or screenshot stays full screen, an
 * iPhone photo's 3:4 is 4:5, a landscape one 16:9), so nothing is cut that
 * doesn't need to be. Unknown: 4:5.
 */
export function closestAspect(w: number | null | undefined, h: number | null | undefined): PostAspect {
  if (!w || !h || !(w > 0) || !(h > 0)) return "portrait";
  const own = Math.log(w / h);
  let best: PostAspect = "portrait";
  for (const k of POST_ASPECT_ORDER) if (Math.abs(Math.log(POST_ASPECTS[k]) - own) < Math.abs(Math.log(POST_ASPECTS[best]) - own)) best = k;
  return best;
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

/** A clip frame's shapes: a story's 9:16 to 16:9 (community_media_focus keeps the same range). */
export const FRAME_MIN_ASPECT = 0.5;
export const FRAME_MAX_ASPECT = 1.8;

/** A stored focus, checked (anything odd → centred). A clip's frame keeps its shape and zoom. */
export function cleanFocus(f: unknown): MediaFocus | null {
  if (!f || typeof f !== "object") return null;
  const x = Number((f as { x?: unknown }).x);
  const y = Number((f as { y?: unknown }).y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const out: MediaFocus = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  const a = Number((f as { a?: unknown }).a);
  if (Number.isFinite(a) && a >= FRAME_MIN_ASPECT && a <= FRAME_MAX_ASPECT) {
    const z = Number((f as { z?: unknown }).z);
    out.a = a;
    out.z = Number.isFinite(z) ? clamp(z, 1, MAX_ZOOM) : 1;
  }
  return out;
}

/** A slide's frame from the studio (a clip framed at its post's shape); null for anything else. */
export function clipFrame(f: MediaFocus | null | undefined): ClipFrame | null {
  const c = cleanFocus(f);
  return c?.a ? { a: c.a, z: c.z ?? 1, x: c.x, y: c.y } : null;
}

/** What's stored for a clip framed in the studio (its slide's focus). */
export function frameFocus(framing: Framing, aspect: number): MediaFocus {
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return { x: r(framing.cx), y: r(framing.cy), z: r(framing.z), a: r(aspect) };
}

/**
 * Where the clip sits inside a box at its frame's shape, as shares of that
 * box (CSS width / height / left / top in %): the box shows exactly what the
 * studio's frame showed, whatever its size. `media` is the clip's own shape
 * (w / h); unknown, the frame's (it just fills the box).
 */
export function framedMediaStyle(frame: ClipFrame, media: number | null | undefined): { width: string; height: string; left: string; top: string } {
  const m = media && Number.isFinite(media) && media > 0 ? media : frame.a;
  const img = { w: m, h: 1 };
  const box = { w: frame.a, h: 1 };
  const f = clampFraming({ z: frame.z, cx: frame.x, cy: frame.y }, img, box);
  const p = placement(f, img, box);
  const pct = (v: number) => `${Math.round(v * 100000) / 1000}%`;
  return { width: pct(p.w / box.w), height: pct(p.h / box.h), left: pct(p.x / box.w), top: pct(p.y / box.h) };
}

/** CSS object-position for a focus ("50% 30%"); undefined when centred or unset (the default), and for a framed clip (its poster is already its frame). */
export function focusPosition(f: MediaFocus | null | undefined): string | undefined {
  const c = cleanFocus(f);
  if (!c || c.a || (Math.abs(c.x - 0.5) < 0.005 && Math.abs(c.y - 0.5) < 0.005)) return undefined;
  return `${Math.round(c.x * 1000) / 10}% ${Math.round(c.y * 1000) / 10}%`;
}
