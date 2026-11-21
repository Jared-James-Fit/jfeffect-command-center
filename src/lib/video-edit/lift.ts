/**
 * Find the lift in a picked clip, on the phone, in the background: the
 * trimmer's suggestion (lift-window.ts reads the frames).
 *
 * It decodes tiny greyscale frames (64 px on the long side), about one a
 * second, the cheapest way the clip allows (liftSamplePlan):
 *   - keyframes about a second apart (a phone's own camera): one decode each
 *   - keyframes further apart (a clip filmed in the app: the browser's
 *     recorder puts one every few seconds): the keyframes first, which is an
 *     answer already, then the gaps between them filled in while there's time
 *   - hardly any keyframes: a frame a second, decoded straight through
 * Out of time, it reads what it has when that covers the clip closely enough
 * (a fill-in cut short), and otherwise says so. It never throws and nothing waits on it; what
 * it did is kept by the file (lift-note.ts) for the trimmer and the upload.
 */
import { loadMediabunny } from "@/lib/video-edit/probe";
import { readLift, type LiftFrame } from "@/lib/video-edit/lift-window";
import { noteLift, type LiftNote, type LiftWhy } from "@/lib/video-edit/lift-note";
import type { VideoTrim } from "@/lib/video-edit/plan";

/** The long side of the frames it reads. */
const SIDE = 64;
/** At most this many frames (a long clip is read more sparsely). */
const MAX_FRAMES = 240;
/** Frames closer than this are thinned: lift-window reads about one a second. */
const MIN_STEP = 0.8;
/** Keyframes this close together (on average) are all it reads. */
const KEYS_DENSE = 1.3;
/** Keyframes up to this far apart are read first, then the gaps between them filled in. */
const KEYS_USABLE = 4;
/** A gap between two frames over this gets a frame (or more) in between. */
const FILL_OVER = 1.6;
/** Hardly any keyframes: a frame every GRID_STEP, on a clip short enough to decode straight through. */
const GRID_STEP = 1;
const GRID_MAX_SECONDS = 120;
/** Nothing new after this long (what's read by then is used when it covers the clip). */
export const LIFT_BUDGET_MS = 12000;

export type LiftSuggestion = VideoTrim;

export type LiftSamplePlan = {
  mode: LiftNote["mode"];
  /** Read first: enough for an answer on their own. */
  first: number[];
  /** Read after, while there's time: the frames between them. */
  fill: number[];
  /** Seconds between keyframes, on average. */
  keyGap: number | null;
};

const round3 = (t: number) => Math.round(t * 1000) / 1000;

/** The times to read, from the clip's keyframes and its length. */
export function liftSamplePlan(keys: number[], duration: number): LiftSamplePlan {
  const sorted = [...new Set(keys.filter((k) => Number.isFinite(k) && k >= 0 && k <= duration))].sort((a, b) => a - b);
  const keyGap = sorted.length > 1 ? (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1) : null;
  // never closer than MIN_STEP, never more than MAX_FRAMES
  const step = Math.max(MIN_STEP, duration / MAX_FRAMES);
  const thin = (times: number[]) => {
    const out: number[] = [];
    for (const t of times) if (!out.length || t - out[out.length - 1] >= step - 1e-6) out.push(t);
    return out;
  };
  // the keyframes cover the clip: one near its start, one near its end, none too far from the next
  const covers = sorted.length >= 4 && keyGap !== null && keyGap <= KEYS_USABLE && sorted[0] <= KEYS_USABLE && duration - sorted[sorted.length - 1] <= KEYS_USABLE * 1.5;
  if (covers) {
    const first = thin(sorted);
    const fill: number[] = [];
    if (keyGap! > KEYS_DENSE) {
      for (let i = 0; i < first.length; i++) {
        const a = first[i];
        const gap = (i + 1 < first.length ? first[i + 1] : duration) - a;
        const n = Math.ceil(gap / FILL_OVER) - 1;
        for (let k = 1; k <= n; k++) fill.push(round3(a + (gap * k) / (n + 1)));
      }
    }
    const room = Math.max(0, MAX_FRAMES - first.length);
    return { mode: fill.length && room ? "keys+fill" : "keys", first, fill: fill.slice(0, room), keyGap };
  }
  if (duration <= GRID_MAX_SECONDS) {
    const grid: number[] = [];
    for (let t = 0; t < duration; t += GRID_STEP) grid.push(round3(t));
    return { mode: "grid", first: thin(grid), fill: [], keyGap };
  }
  return { mode: "none", first: [], fill: [], keyGap };
}

/** The frames a first pass reads (kept for callers that only want those). */
export function liftSampleTimes(keys: number[], duration: number): number[] {
  return liftSamplePlan(keys, duration).first;
}

const grey = (d: Uint8ClampedArray, n: number): Uint8Array => {
  const px = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) px[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return px;
};

export type LiftFound = { window: LiftSuggestion | null; note: LiftNote };

/** Where the lift is in this clip, with what it took to find out. */
export async function findLiftRead(file: Blob, opts: { signal?: AbortSignal; budgetMs?: number } = {}): Promise<LiftFound> {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const started = now();
  const budget = opts.budgetMs ?? LIFT_BUDGET_MS;
  const stopped = () => !!opts.signal?.aborted;
  const late = () => now() - started > budget;
  let mode: LiftNote["mode"] = "none";
  let keyGap: number | null = null;
  let read = 0;
  const done = (why: LiftWhy, window: LiftSuggestion | null = null): LiftFound => {
    const note: LiftNote = {
      ms: Math.round(now() - started),
      n: read,
      mode,
      key_s: keyGap === null ? null : Math.round(keyGap * 100) / 100,
      why,
      win: window ? [window.start, window.end] : null,
    };
    noteLift(file, note);
    return { window, note };
  };
  let input: { dispose?: () => void } | null = null;
  try {
    const mb = await loadMediabunny();
    const inp = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    input = inp;
    const track = await inp.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return done("cant-read");
    if (stopped()) return done("stopped");
    const duration = await inp.computeDuration();
    if (!(duration > 3)) return done("cant-read");
    // the frame's shape as it's shown (a phone's portrait clip is stored on its side)
    const dw = track.displayWidth || 9;
    const dh = track.displayHeight || 16;
    const w = dw >= dh ? SIDE : Math.max(8, Math.round((SIDE * dw) / dh));
    const h = dw >= dh ? Math.max(8, Math.round((SIDE * dh) / dw)) : SIDE;
    // the keyframes' times, from the file's index (no decoding)
    const packets = new mb.EncodedPacketSink(track);
    const keys: number[] = [];
    let k = await packets.getKeyPacket(0, { metadataOnly: true }).catch(() => null);
    if (!k) k = await packets.getFirstPacket({ metadataOnly: true }).catch(() => null);
    while (k && keys.length < 2000) {
      keys.push(k.timestamp);
      if (stopped()) return done("stopped");
      if (late()) return done("slow");
      k = await packets.getNextKeyPacket(k, { metadataOnly: true }).catch(() => null);
    }
    const plan = liftSamplePlan(keys, duration);
    mode = plan.mode;
    keyGap = plan.keyGap;
    if (plan.first.length < 4) return done("cant-read");
    const sink = new mb.CanvasSink(track, { width: w, height: h, fit: "fill", poolSize: 1 });
    const frames: LiftFrame[] = [];
    /** Reads these times in order; false when it ran out of time or was stopped part way. */
    const readAt = async (times: number[]): Promise<boolean> => {
      for await (const wc of sink.canvasesAtTimestamps(times)) {
        if (stopped() || late()) return false;
        if (!wc) continue;
        const ctx = (wc.canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!ctx) throw new Error("no canvas");
        frames.push({ t: wc.timestamp, px: grey(ctx.getImageData(0, 0, w, h).data, w * h) });
        read = frames.length;
      }
      return true;
    };
    if (!(await readAt(plan.first))) return done(stopped() ? "stopped" : "slow");
    // the gaps between keyframes, while there's time: cut short, what's read still reads (closer at the start, sparser after)
    let filled = true;
    if (plan.fill.length) {
      filled = await readAt(plan.fill);
      if (stopped()) return done("stopped");
    }
    // in order, one frame a time (a filled-in time can land on a frame already read)
    frames.sort((a, b) => a.t - b.t);
    const ordered: LiftFrame[] = [];
    for (const f of frames) if (!ordered.length || f.t - ordered[ordered.length - 1].t > 1e-3) ordered.push(f);
    const res = readLift(ordered, w, h, duration);
    // too far apart to trust only because the fill-in ran out of time
    return done(!filled && res.why === "sparse" ? "slow" : res.why, res.window);
  } catch {
    return done("error");
  } finally {
    try {
      input?.dispose?.();
    } catch {
      /* already closed */
    }
  }
}

/** Where the lift is in this clip (null: no clear lift, nothing worth cutting, or it couldn't tell in time). */
export async function findLift(file: Blob, opts: { signal?: AbortSignal; budgetMs?: number } = {}): Promise<LiftSuggestion | null> {
  return (await findLiftRead(file, opts)).window;
}
