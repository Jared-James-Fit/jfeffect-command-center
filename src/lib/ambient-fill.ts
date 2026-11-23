/**
 * Behind a picture that doesn't fill its post's screen in the Crew feed (an
 * older 4:5 post, a square or sideways photo), the screen is the picture
 * itself, soft and dark, never black bands (Nov 23 2026; Reels' and Shorts'
 * way): the photo shrunk to a few pixels and stretched back over the screen,
 * which blurs it for free (no CSS filter, no extra layer to composite while
 * the feed scrolls), then darkened so the post's words and Crew's bar read on
 * it. Drawn from the picture already on screen (the same address, so the
 * phone's cache answers it), on a canvas that's never read back.
 */
import { CENTRED, cropRect, type Size } from "@/lib/photo-frame";

/** The canvas the screen stretches (about 9:16; the stretch of a blur doesn't show). */
export const AMBIENT_SIZE: Size = { w: 36, h: 64 };
/** How small the picture is taken first: a few colours, which the stretch turns into a soft wash. */
export const AMBIENT_SMALL: Size = { w: 6, h: 11 };
/** A step between the photo and the few pixels, so a big photo is averaged rather than sampled (Safari). */
const AMBIENT_STEP: Size = { w: 54, h: 96 };
/** How dark it's laid over (top, middle, bottom): darkest under Crew's bar and the words. */
export const AMBIENT_SHADE = { top: 0.62, middle: 0.5, bottom: 0.74 } as const;

type Drawable = CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };

function sizeOf(img: Drawable): Size {
  const w = Number(img.naturalWidth || img.width || 0);
  const h = Number(img.naturalHeight || img.height || 0);
  return { w, h };
}

/** Paint the soft, dark backdrop of `img` onto `canvas` (AMBIENT_SIZE). False when there was nothing to draw. */
export function paintAmbient(canvas: HTMLCanvasElement, img: Drawable): boolean {
  const size = sizeOf(img);
  if (!size.w || !size.h) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const step = document.createElement("canvas");
  const small = document.createElement("canvas");
  try {
    step.width = AMBIENT_STEP.w;
    step.height = AMBIENT_STEP.h;
    small.width = AMBIENT_SMALL.w;
    small.height = AMBIENT_SMALL.h;
    const a = step.getContext("2d");
    const b = small.getContext("2d");
    if (!a || !b) return false;
    // the middle of the picture at the screen's shape, as the picture would fill it
    const r = cropRect(CENTRED, size, AMBIENT_SIZE.w / AMBIENT_SIZE.h);
    for (const c of [a, b, ctx]) {
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = "high";
    }
    a.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, step.width, step.height);
    b.drawImage(step, 0, 0, small.width, small.height);
    if (canvas.width !== AMBIENT_SIZE.w) canvas.width = AMBIENT_SIZE.w;
    if (canvas.height !== AMBIENT_SIZE.h) canvas.height = AMBIENT_SIZE.h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, `rgba(0,0,0,${AMBIENT_SHADE.top})`);
    g.addColorStop(0.5, `rgba(0,0,0,${AMBIENT_SHADE.middle})`);
    g.addColorStop(1, `rgba(0,0,0,${AMBIENT_SHADE.bottom})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return true;
  } finally {
    step.width = step.height = 0;
    small.width = small.height = 0;
  }
}
