/**
 * Instagram-style profile photo crop: the photo always fills the square
 * (and the circle inside it), zoom 1×–5× from "just covers", drag to place.
 * Pure math so it's tested without a browser. Offsets are the photo's
 * centre relative to the frame's centre, in on-screen px.
 */

export const MAX_ZOOM = 5;

export type Crop = { zoom: number; x: number; y: number };
export type Size = { w: number; h: number };

/** Screen px per photo px at zoom 1: the short side exactly fills the frame. */
export function coverScale(img: Size, frame: number): number {
  return frame / Math.max(1, Math.min(img.w, img.h));
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
}

/** Keep the photo covering the whole frame: no empty edges, ever. */
export function clampCrop(c: Crop, img: Size, frame: number): Crop {
  const zoom = clampZoom(c.zoom);
  const s = coverScale(img, frame) * zoom;
  const maxX = Math.max(0, (img.w * s - frame) / 2);
  const maxY = Math.max(0, (img.h * s - frame) / 2);
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, Number.isFinite(v) ? v : 0));
  return { zoom, x: clamp(c.x, maxX), y: clamp(c.y, maxY) };
}

/**
 * Zoom to `zoom` keeping the photo point under `at` (relative to the frame's
 * centre) where it is: pinch and wheel zoom around the fingers / cursor.
 */
export function zoomAt(c: Crop, zoom: number, at: { x: number; y: number }, img: Size, frame: number): Crop {
  const next = clampZoom(zoom);
  const k = next / c.zoom;
  return clampCrop({ zoom: next, x: at.x - (at.x - c.x) * k, y: at.y - (at.y - c.y) * k }, img, frame);
}

/** The square of the original photo (in photo px) that the frame shows. */
export function cropRect(c: Crop, img: Size, frame: number): { sx: number; sy: number; size: number } {
  const s = coverScale(img, frame) * c.zoom;
  const size = frame / s;
  const sx = img.w / 2 - (frame / 2 + c.x) / s;
  const sy = img.h / 2 - (frame / 2 + c.y) / s;
  // float noise must never read past the photo's edge
  return {
    sx: Math.min(Math.max(0, sx), Math.max(0, img.w - size)),
    sy: Math.min(Math.max(0, sy), Math.max(0, img.h - size)),
    size: Math.min(size, img.w, img.h),
  };
}

/**
 * A pinch, always measured from where it started: zoom by `ratio` around the
 * fingers' starting midpoint, follow the midpoint as it moves, and keep the
 * frame covered — clamped once at the end, so hitting an edge never jitters.
 */
export function pinchCrop(
  start: Crop,
  startMid: { x: number; y: number },
  mid: { x: number; y: number },
  ratio: number,
  img: Size,
  frame: number,
): Crop {
  const zoom = clampZoom(start.zoom * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
  const k = zoom / start.zoom;
  return clampCrop(
    {
      zoom,
      x: startMid.x - (startMid.x - start.x) * k + (mid.x - startMid.x),
      y: startMid.y - (startMid.y - start.y) * k + (mid.y - startMid.y),
    },
    img,
    frame,
  );
}
