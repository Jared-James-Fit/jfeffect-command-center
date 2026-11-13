/**
 * Find the lift in a picked clip, on the phone, in the background: the
 * trimmer's suggestion (lift-window.ts reads the frames).
 *
 * Fast on purpose: it decodes tiny greyscale frames (64 px on the long side)
 * at the clip's keyframes, one decode each (a phone's camera puts one about
 * every second), and only falls back to a frame every ~0.7 s when keyframes
 * are far apart and the clip is short enough to decode straight through. It
 * gives up quietly (no suggestion) past its time budget, on a clip this phone
 * can't decode, or when asked to stop; nothing ever waits on it.
 */
import { loadMediabunny } from "@/lib/video-edit/probe";
import { liftWindow, type LiftFrame } from "@/lib/video-edit/lift-window";
import type { VideoTrim } from "@/lib/video-edit/plan";

/** The long side of the frames it reads. */
const SIDE = 64;
/** At most this many frames (a long clip is read more sparsely). */
const MAX_FRAMES = 240;
/** Frames closer than this are thinned (a phone with a keyframe every few frames). */
const MIN_STEP = 0.45;
/** Keyframes this far apart (on average) or more: read a frame every GRID_STEP instead, on a short clip only. */
const SPARSE_KEYS = 1.6;
const GRID_STEP = 0.7;
const GRID_MAX_SECONDS = 75;
/** No suggestion after this long. */
export const LIFT_BUDGET_MS = 6000;

export type LiftSuggestion = VideoTrim;

/** The times to read: the keyframes (thinned), or a short clip's grid. */
export function liftSampleTimes(keys: number[], duration: number): number[] {
  const sorted = [...new Set(keys.filter((k) => Number.isFinite(k) && k >= 0 && k <= duration))].sort((a, b) => a - b);
  const spacing = sorted.length > 1 ? (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1) : Infinity;
  let times: number[];
  if (sorted.length >= 4 && spacing <= SPARSE_KEYS) times = sorted;
  else if (duration <= GRID_MAX_SECONDS) {
    times = [];
    for (let t = 0; t < duration; t += GRID_STEP) times.push(Math.round(t * 1000) / 1000);
  } else return [];
  // thin: never closer than MIN_STEP, never more than MAX_FRAMES
  const step = Math.max(MIN_STEP, duration / MAX_FRAMES);
  const out: number[] = [];
  for (const t of times) if (!out.length || t - out[out.length - 1] >= step - 1e-6) out.push(t);
  return out;
}

const grey = (d: Uint8ClampedArray, n: number): Uint8Array => {
  const px = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) px[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return px;
};

/** Where the lift is in this clip (null: no clear lift, nothing worth cutting, or it couldn't tell in time). */
export async function findLift(file: Blob, opts: { signal?: AbortSignal; budgetMs?: number } = {}): Promise<LiftSuggestion | null> {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const budget = opts.budgetMs ?? LIFT_BUDGET_MS;
  const over = () => opts.signal?.aborted || now() - started > budget;
  let input: { dispose?: () => void } | null = null;
  try {
    const mb = await loadMediabunny();
    const inp = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    input = inp;
    const track = await inp.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode()) || over()) return null;
    const duration = await inp.computeDuration();
    if (!(duration > 3)) return null;
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
      if (over()) return null;
      k = await packets.getNextKeyPacket(k, { metadataOnly: true }).catch(() => null);
    }
    const times = liftSampleTimes(keys, duration);
    if (times.length < 4) return null;
    const sink = new mb.CanvasSink(track, { width: w, height: h, fit: "fill", poolSize: 1 });
    const frames: LiftFrame[] = [];
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (over()) return null;
      if (!wc) continue;
      const ctx = (wc.canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) return null;
      frames.push({ t: wc.timestamp, px: grey(ctx.getImageData(0, 0, w, h).data, w * h) });
    }
    return liftWindow(frames, w, h, duration);
  } catch {
    return null;
  } finally {
    try {
      input?.dispose?.();
    } catch {
      /* already closed */
    }
  }
}
