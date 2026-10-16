import { context2d, releaseCanvas } from "@/lib/canvas-memory";
import { OUTPUT_WIDTH, cropRect, type Framing, type Size } from "@/lib/photo-frame";

/** Anything a canvas can draw that has a size: a photo, a canvas, a video frame. */
export type Drawable = CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number };

/** Its real size in px (a photo's natural size, a video's frame size). */
export function drawableSize(src: Drawable): Size {
  return {
    w: src.naturalWidth || src.videoWidth || (typeof src.width === "number" ? src.width : 0) || 1,
    h: src.naturalHeight || src.videoHeight || (typeof src.height === "number" ? src.height : 0) || 1,
  };
}

/**
 * The framed part of a photo, drawn `width` px wide at the frame's shape:
 * what's posted (1080 wide) or what a card is painted over. The caller
 * releases it (releaseCanvas) when done.
 */
export function framedCanvas(src: Drawable, framing: Framing, aspect: number, width = OUTPUT_WIDTH): HTMLCanvasElement {
  const img = drawableSize(src);
  const r = cropRect(framing, img, aspect);
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(width));
  c.height = Math.max(2, Math.round(width / aspect));
  const ctx = context2d(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
  return c;
}

/**
 * A lighter copy of a big photo (≤ `max` px on its long side) for repainting
 * a card while it's being dragged, so a 12 MP photo isn't scaled down on
 * every frame. Small photos come back as they are.
 */
export function lightCopy(src: Drawable, max = 1600): { src: Drawable; release: () => void } {
  const { w, h } = drawableSize(src);
  const k = max / Math.max(w, h);
  if (k >= 1) return { src, release: () => {} };
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w * k));
  c.height = Math.max(2, Math.round(h * k));
  try {
    const ctx = context2d(c);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, c.width, c.height);
  } catch {
    releaseCanvas(c);
    return { src, release: () => {} };
  }
  return { src: c, release: () => releaseCanvas(c) };
}
