/**
 * Scrubbing a Crew clip (VideoScrubber, video-scrubber.tsx): the pure parts,
 * so the bar, the seek and the gestures read the same everywhere a clip plays
 * (the feed's own screens, the coach's cards, a post's page, the full-screen
 * clips) and are tested without a browser.
 *
 * - How long a clip is: its duration, else the end of what can be sought (a
 *   phone recording whose header never said its length reads Infinity until
 *   it's all loaded), else unknown, and no bar is shown.
 * - Where a finger can take it: inside the clip, a hair before its end (a
 *   looping clip sent to its very end wraps straight back to the start), and
 *   inside the ranges the browser says it can seek to.
 * - What a finger on the bar means: sideways first is a scrub (from anywhere in
 *   the band, the bottom SCRUB_BAND_PX), up or down first is the feed's swipe
 *   (the browser keeps that one), still and quick on the bar is a tap that
 *   jumps there.
 */

/**
 * Dispatched (bubbling) from a clip's scrubber as a CustomEvent<boolean>: true
 * while someone is scrubbing it (and for a moment after, LINGER_MS), false
 * once it's done. A post's screen puts its words and buttons away meanwhile,
 * Reels' (PostCard, the same as a held clip).
 */
export const CLIP_SCRUB_EVENT = "jf-clip-scrub";

/** Ranges as [start, end] pairs, a video's `seekable` / `buffered`. */
export type Ranges = ReadonlyArray<readonly [number, number]>;

/** A video's TimeRanges as plain pairs (an empty list when there are none or they can't be read). */
export function rangesOf(
  tr: Pick<TimeRanges, "length" | "start" | "end"> | null | undefined,
): [number, number][] {
  const out: [number, number][] = [];
  if (!tr) return out;
  try {
    for (let i = 0; i < tr.length; i++) out.push([tr.start(i), tr.end(i)]);
  } catch {
    /* a range that went away while read: what's read so far */
  }
  return out;
}

/** The shortest clip that gets a bar (anything shorter has nothing to scrub). */
export const MIN_SCRUB_SECONDS = 0.5;

/**
 * How long the clip is, when it can be known: its duration, else the end of
 * the last range it can seek in (a recording whose header has no length),
 * else null (no bar).
 */
export function clipLength(duration: number, seekable: Ranges): number | null {
  if (Number.isFinite(duration) && duration >= MIN_SCRUB_SECONDS) return duration;
  for (let i = seekable.length - 1; i >= 0; i--) {
    const end = seekable[i][1];
    if (Number.isFinite(end) && end >= MIN_SCRUB_SECONDS) return end;
  }
  return null;
}

/** How far before its end a seek stops: the clips loop, and one sent to its very end wraps to the start. */
export const END_ROOM_SECONDS = 0.08;

/**
 * A time the clip can go to: inside 0 … its length (less END_ROOM_SECONDS),
 * and, when the browser lists what it can seek, inside one of those ranges
 * (the nearest edge of the nearest one otherwise).
 */
export function seekTarget(t: number, length: number, seekable: Ranges = []): number {
  const end = Math.max(0, length - END_ROOM_SECONDS);
  let want = Number.isFinite(t) ? Math.min(end, Math.max(0, t)) : 0;
  const ranges = seekable.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
  if (!ranges.length) return want;
  let best = want;
  let gap = Infinity;
  for (const [a, b0] of ranges) {
    const b = Math.min(b0, end);
    if (b < a) continue;
    if (want >= a && want <= b) return want;
    const edge = want < a ? a : b;
    const d = Math.abs(edge - want);
    if (d < gap) {
      gap = d;
      best = edge;
    }
  }
  want = best;
  return want;
}

/** Where along the bar (0 … 1) a finger at `x` is, for a bar `left` … `left + width`. */
export function ratioAt(x: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(0, (x - left) / width));
}

/** "0:07", "1:02", "1:02:03" (hours only for a clip an hour or longer). */
export function clipClock(seconds: number, length = seconds): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (h > 0 || length >= 3600) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** "0:12 of 0:45", for a screen reader. */
export function clipClockText(t: number, length: number): string {
  return `${clipClock(t, length)} of ${clipClock(length, length)}`;
}

/**
 * The bar's two sizes for a finger (Nov 20 2026): what's drawn is a 2px line, but
 * a drag can start anywhere in the bottom SCRUB_BAND_PX of the clip (the size of
 * a finger, Apple's 44pt), even over the post's words, which keep their taps; a
 * tap seeks only on the strip right at the bar, SCRUB_TAP_PX tall, which nothing
 * else covers (a post's words sit above it, `--feed-scrub-lane`).
 */
export const SCRUB_BAND_PX = 44;
export const SCRUB_TAP_PX = 24;

/** A finger that moves this far sideways (more than up or down) is scrubbing. */
export const SCRUB_START_PX = 4;
/** A finger that moves this far up or down first is the feed's swipe: the bar lets it go. */
export const SWIPE_START_PX = 8;
/** A finger that stays within this and lifts before TAP_MAX_MS is a tap: the clip jumps there. */
export const TAP_SLOP_PX = 8;
export const TAP_MAX_MS = 500;
/** A finger resting on the bar this long wakes it (thicker), so it plainly has hold of it before it moves. */
export const WAKE_MS = 90;
/** After a scrub the bar stays thick with its time this long, so you see where it landed, then goes back to its line. */
export const LINGER_MS = 300;
/** Keyboard: an arrow key moves this far. */
export const KEY_STEP_SECONDS = 5;

/** What a finger that has moved (dx, dy) from where it went down means, while it's still undecided. */
export function scrubIntent(dx: number, dy: number): "scrub" | "swipe" | "wait" {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= SCRUB_START_PX && ax >= ay) return "scrub";
  if (ay >= SWIPE_START_PX && ay > ax) return "swipe";
  return "wait";
}

/** A finger that went down and came up without moving, quickly: a tap on the bar. */
export function isBarTap(dx: number, dy: number, ms: number): boolean {
  return Math.hypot(dx, dy) < TAP_SLOP_PX && ms < TAP_MAX_MS;
}

/** A rect's edges, as `getBoundingClientRect` gives them. */
export type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Whether a finger at (x, y) is in a bar's band: across the bar's width and
 * within `band` px of the bottom of the bar's strip (`zone`, which sits at the
 * clip's bottom edge).
 */
export function inScrubBand(x: number, y: number, zone: Box, band = SCRUB_BAND_PX): boolean {
  return x >= zone.left && x <= zone.right && y <= zone.bottom && y >= zone.bottom - band;
}

/**
 * Whether a finger at (x, y) is in the band of a bar inside `el` (a clip, a
 * full-screen page): there, a finger held still is the bar's, never the clip's
 * press-and-hold pause.
 */
export function inClipScrubBand(el: Element | null | undefined, x: number, y: number): boolean {
  const zone = el?.querySelector?.("[data-video-scrubber]:not([aria-hidden])");
  return !!zone && inScrubBand(x, y, zone.getBoundingClientRect());
}

/** The parts of a video the seeker uses (a fake one in the tests). */
export type SeekableVideo = {
  currentTime: number;
  fastSeek?: (t: number) => void;
  addEventListener: (type: "seeked", fn: () => void) => void;
  removeEventListener: (type: "seeked", fn: () => void) => void;
};

/** Previews this close together aren't worth another seek. */
export const PREVIEW_MIN_STEP = 1 / 30;
/** A preview seek that hasn't said it's done after this long no longer holds the next one back. */
export const PREVIEW_STALL_MS = 400;

/**
 * Seeks while a finger drags: one preview in flight at a time (the newest
 * wanted time goes next, the ones in between are skipped), each a fast seek
 * where the browser has one (Safari: the nearest keyframe, so the picture
 * keeps up with the finger); `commit` is the exact time, once, on release.
 */
export function makeScrubSeeker(v: SeekableVideo, now: () => number = Date.now) {
  // a seek the video hasn't said it's done with yet, and when it went
  let inFlight = false;
  let since = 0;
  let issued: number | null = null;
  let want: number | null = null;
  const issue = (t: number) => {
    issued = t;
    inFlight = true;
    since = now();
    if (typeof v.fastSeek === "function") v.fastSeek(t);
    else v.currentTime = t;
  };
  const onSeeked = () => {
    inFlight = false;
    const next = want;
    want = null;
    if (next != null && (issued == null || Math.abs(next - issued) >= PREVIEW_MIN_STEP))
      issue(next);
  };
  v.addEventListener("seeked", onSeeked);
  return {
    /** Show roughly this moment (while dragging). */
    preview(t: number) {
      if (issued != null && Math.abs(t - issued) < PREVIEW_MIN_STEP && want == null) return;
      if (inFlight && now() - since < PREVIEW_STALL_MS) {
        want = t;
        return;
      }
      want = null;
      issue(t);
    },
    /** Go exactly here (on release): any preview still waiting is dropped. */
    commit(t: number) {
      want = null;
      issued = t;
      inFlight = true;
      since = now();
      v.currentTime = t;
    },
    dispose() {
      want = null;
      v.removeEventListener("seeked", onSeeked);
    },
  };
}
