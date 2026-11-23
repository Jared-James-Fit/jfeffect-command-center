/**
 * The Crew camera's zoom (Nov 23 2026, reworked the same day): pinch the
 * viewfinder, or, holding the shutter to film, slide the finger up to zoom in
 * and down to come back out (Instagram's), as many times as you like in one
 * clip. Two ways to zoom, one feel:
 *
 *  - the camera's own (`MediaStreamTrack` `zoom`, where the phone exposes it:
 *    Chrome on Android with its pan-tilt-zoom permission, some WebKit builds):
 *    the sensor zooms, so the preview and the clip are the same picture;
 *  - everywhere else a digital zoom (`digital: true`, up to
 *    `DIGITAL_ZOOM_MAX`): the preview is the picture scaled from its middle,
 *    and a clip filmed with it is drawn through a canvas cropped the same way
 *    (zoom-compositor.ts), so what's filmed is what was on screen. Never a
 *    zoom only the preview shows.
 *
 * The finger sets a target and the zoom eases to it every frame
 * (`easeZoom`), so a slide reads as one glide, never steps. Pure, so it's
 * tested.
 */

export type ZoomRange = { min: number; max: number; now: number; digital?: boolean };

/** The most this camera zooms here: its own maximum, at most 10× its widest (past that it's mush). */
export const ZOOM_CAP = 10;
/** A digital zoom crops the picture: past 3× a 1080p frame is too soft to post. */
export const DIGITAL_ZOOM_MAX = 3;
/** How far the finger slides up (px) to go from the widest to the most zoom (about half a phone's height). */
export const ZOOM_SLIDE_PX = 340;
/** A slide shorter than this is a wobble of the thumb, not a zoom. */
export const ZOOM_DEAD_PX = 10;
/** Sliding down never needs more room than this to come all the way back out (the shutter sits low on the screen). */
const DOWN_ROOM_MIN = 48;
/** The last of the screen a thumb can't really reach (the home indicator's strip): the widest comes before it. */
const EDGE_PX = 24;
/** How quickly the zoom catches the finger (ms to cover ~63% of the way): smooth, never laggy. */
export const ZOOM_EASE_MS = 70;

/** What the camera's track says it can zoom, or null when it can't (then a digital zoom, `digitalZoomRange`). */
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

/** The digital zoom: 1× to `DIGITAL_ZOOM_MAX`, starting at the whole picture. */
export function digitalZoomRange(): ZoomRange {
  return { min: 1, max: DIGITAL_ZOOM_MAX, now: 1, digital: true };
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Kept to a thousandth (no floating-point noise), never stepped: the glide is continuous. */
const fine = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Sliding while holding the shutter, from the zoom it was at when the hold
 * started: up (a negative `dy`) zooms in at the same pace whatever the zoom
 * (a log scale, so every centimetre feels the same), down comes back out,
 * reaching the widest just before the bottom of the screen (`below`: the
 * room under where filming started, less the strip a thumb can't reach) or
 * at `ZOOM_SLIDE_PX`, whichever's nearer. Up and
 * down again lands where it started.
 */
export function zoomFromSlide(start: number, dy: number, r: ZoomRange, below?: number): number {
  const s = clampTo(start, r.min, r.max);
  if (Math.abs(dy) < ZOOM_DEAD_PX) return fine(s);
  const d = Math.abs(dy) - ZOOM_DEAD_PX;
  if (dy < 0) {
    const span = Math.log(r.max / r.min);
    return fine(clampTo(Math.exp(Math.log(s) + (d / ZOOM_SLIDE_PX) * span), r.min, r.max));
  }
  const room = Math.max(DOWN_ROOM_MIN, Math.min(ZOOM_SLIDE_PX, (below ?? ZOOM_SLIDE_PX + EDGE_PX) - ZOOM_DEAD_PX - EDGE_PX));
  const t = Math.min(1, d / room);
  return fine(clampTo(Math.exp(Math.log(s) - t * Math.log(s / r.min)), r.min, r.max));
}

/** Two fingers apart / together: the zoom grows with the distance between them. */
export function zoomFromPinch(start: number, startDist: number, dist: number, r: ZoomRange): number {
  if (!(startDist > 0) || !(dist > 0)) return fine(clampTo(start, r.min, r.max));
  return fine(clampTo(start * (dist / startDist), r.min, r.max));
}

/**
 * One frame of the glide: the zoom moves toward where the finger asks, a
 * share of the way that depends only on the time since the last frame (so a
 * 60 Hz and a 120 Hz phone feel the same), and lands exactly once it's close.
 */
export function easeZoom(current: number, target: number, dtMs: number): number {
  if (!Number.isFinite(current)) return target;
  const k = 1 - Math.exp(-Math.max(0, Math.min(dtMs, 100)) / ZOOM_EASE_MS);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.002 * target ? target : next;
}

/**
 * A detent as the zoom passes a whole step (2×, 3×…) or reaches either end,
 * the iPhone camera's tick: a light haptic, never a sound (it would be in the clip).
 */
export function zoomDetent(prev: number, next: number, r: ZoomRange): boolean {
  if (prev === next) return false;
  const atEnd = (z: number) => z <= r.min + 1e-3 || z >= r.max - 1e-3;
  if (atEnd(next) && !atEnd(prev)) return true;
  return Math.floor(prev / r.min + 1e-6) !== Math.floor(next / r.min + 1e-6);
}

/** Worth showing as a number over the shutter ("2.4×"); the widest says nothing. */
export function zoomLabel(z: number, r: ZoomRange | null): string | null {
  if (!r || z <= r.min + 0.05) return null;
  const x = z / r.min;
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)}×`;
}

/**
 * The part of the camera's picture a digital zoom shows, as a source
 * rectangle for `drawImage`: the picture cut to the output's shape (the
 * output is the camera's own size, so normally all of it), then the middle
 * 1/z of that. The preview scales the picture by z from its middle, which is
 * the same part.
 */
export function zoomCrop(vw: number, vh: number, ow: number, oh: number, z: number): { sx: number; sy: number; sw: number; sh: number } {
  const zz = Math.max(1, z || 1);
  if (!(vw > 0 && vh > 0 && ow > 0 && oh > 0)) return { sx: 0, sy: 0, sw: Math.max(0, vw), sh: Math.max(0, vh) };
  const out = ow / oh;
  let cw = vw;
  let ch = vh;
  if (vw / vh > out) cw = vh * out;
  else ch = vw / out;
  const sw = cw / zz;
  const sh = ch / zz;
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
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

/** How near the finger is to the lock (0 → 1), for the lock's glow as it's reached; up or down is a zoom, never a lock. */
export function lockReach(dx: number, dy: number): number {
  if (dx >= 0 || Math.abs(dx) <= Math.abs(dy) * 1.2) return 0;
  return Math.min(1, -dx / LOCK_SLIDE_PX);
}
