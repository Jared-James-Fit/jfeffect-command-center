/**
 * The Crew camera's zoom (Nov 23 2026): pinch the viewfinder, or slide the
 * finger up while holding the shutter to film (Instagram's), down to come
 * back out. Only ever the camera's own zoom (`MediaStreamTrack` `zoom`, where
 * the phone exposes it: Chrome on Android, Safari 17+): a camera without it
 * offers no zoom at all, never a fake one cropped from the picture. Pure, so
 * it's tested.
 */

export type ZoomRange = { min: number; max: number; now: number };

/** The most this camera zooms here: its own maximum, at most 10× its widest (past that it's mush). */
export const ZOOM_CAP = 10;
/** How far the finger slides up (px) to go from the widest to the most zoom (about half a phone's height). */
export const ZOOM_SLIDE_PX = 340;
/** A slide shorter than this is a wobble of the thumb, not a zoom. */
export const ZOOM_DEAD_PX = 10;

/** What the camera's track says it can zoom, or null when it can't (nothing to offer). */
export function zoomRange(track: MediaStreamTrack | null | undefined): ZoomRange | null {
  if (!track) return null;
  let caps: { zoom?: { min?: number; max?: number } } | null = null;
  try {
    caps = (track.getCapabilities?.() as { zoom?: { min?: number; max?: number } } | undefined) ?? null;
  } catch {
    caps = null;
  }
  const z = caps?.zoom;
  if (!z || typeof z.min !== "number" || typeof z.max !== "number" || !(z.max > z.min)) return null;
  const min = z.min;
  const max = Math.min(z.max, min * ZOOM_CAP);
  let now = min;
  try {
    const s = (track.getSettings?.() as { zoom?: number } | undefined)?.zoom;
    if (typeof s === "number" && Number.isFinite(s)) now = s;
  } catch {
    /* not read: the widest */
  }
  return { min, max, now: clampTo(now, min, max) };
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** One decimal, like the camera's own "1.4×". */
const tenth = (v: number) => Math.round(v * 10) / 10;

/**
 * Sliding while holding the shutter: up (a negative `dy`) zooms in, down
 * zooms back out, on a log scale so every centimetre feels the same, from
 * the zoom it was at when the slide started.
 */
export function zoomFromSlide(start: number, dy: number, r: ZoomRange): number {
  if (Math.abs(dy) < ZOOM_DEAD_PX) return tenth(clampTo(start, r.min, r.max));
  const travel = -(dy - Math.sign(dy) * ZOOM_DEAD_PX) / ZOOM_SLIDE_PX;
  const span = Math.log(r.max / r.min);
  const z = Math.exp(Math.log(clampTo(start, r.min, r.max)) + travel * span);
  return tenth(clampTo(z, r.min, r.max));
}

/** Two fingers apart / together: the zoom grows with the distance between them. */
export function zoomFromPinch(start: number, startDist: number, dist: number, r: ZoomRange): number {
  if (!(startDist > 0) || !(dist > 0)) return tenth(clampTo(start, r.min, r.max));
  return tenth(clampTo(start * (dist / startDist), r.min, r.max));
}

/** Worth showing as a number over the shutter ("2.4×"); the widest says nothing. */
export function zoomLabel(z: number, r: ZoomRange | null): string | null {
  if (!r || z <= r.min + 0.05) return null;
  const x = z / r.min;
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)}×`;
}

/**
 * Sliding sideways while filming locks it (hands free, Instagram's): the
 * finger can lift and filming carries on until the shutter is tapped. To the
 * left, past `LOCK_SLIDE_PX`, and mostly sideways.
 */
export const LOCK_SLIDE_PX = 64;
export function slideLocks(dx: number, dy: number): boolean {
  return dx <= -LOCK_SLIDE_PX && Math.abs(dx) > Math.abs(dy) * 1.2;
}
