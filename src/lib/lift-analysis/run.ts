/**
 * Lift analysis in the browser: decode the clip on the device (mediabunny +
 * the phone's own hardware decoder, as the trimmer does), at a small working
 * size, and run the engine on the way through. Nothing leaves the device;
 * only the sample frames are kept (the tracker sees every other frame once).
 *
 *   1. four frames a second spread over the clip (12–40): the plate found
 *      as the big circle that moves up and down (find.ts), or the plate
 *      under the person's tap; its reference picture cut where it shows best
 *   2. every frame in order: the plate followed by its own picture
 *      (follow.ts), the camera's own movement measured (motion.ts)
 *   3. the lift read from the track (analyze.ts)
 *
 * The work yields to the page every few milliseconds, so logging carries on
 * smoothly while it runs, and stops the moment it's cancelled.
 */
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { PlateSize } from "@/lib/lift-analysis/calibrate";
import {
  locatePlate,
  rimNeverMeasured,
  sampleCount,
  shakeExclusion,
  type Seed,
} from "@/lib/lift-analysis/engine";
import type { PlateFind } from "@/lib/lift-analysis/find";
import { PlateFollower } from "@/lib/lift-analysis/follow";
import { rgbaToGray, rgbaToGrayHalf, type Frame } from "@/lib/lift-analysis/image";
import { cameraShift } from "@/lib/lift-analysis/motion";
import { loadMediabunny } from "@/lib/video-edit/probe";

/** The long side frames are analysed at: the plate's rim spans ~60–100 px, plenty for sub-pixel fits. */
export const WORKING_LONG_SIDE = 480;
/** Never more than this much of a clip (a set, with its setup and rack). */
export const MAX_ANALYSIS_SECONDS = 75;

export type RunStage = "opening" | "finding" | "tracking" | "reading";
export type RunProgress = { stage: RunStage; progress: number };

export type RunInput = {
  /** The clip: the file itself (just filmed or picked: no download) or its signed link. */
  source: Blob | string;
  /** Only this part (seconds of the clip). */
  window?: { start: number; end: number };
  /** A tap on the plate: time, and position as shares of the shown frame (0…1). */
  tap?: { t: number; fx: number; fy: number };
  plate?: PlateSize & { confirmed?: boolean };
  dirHint?: "lower_first" | "lift_first";
  signal?: AbortSignal;
  onProgress?: (p: RunProgress) => void;
};

export type RunResult =
  | { ok: true; analysis: LiftAnalysis; find: PlateFind | null }
  | {
      ok: false;
      why: "no_plate" | "ambiguous" | "no_plate_at_tap" | "unreadable" | "too_short" | "cancelled";
      find: PlateFind | null;
      /** Circles worth offering for a tap (shares of the frame), when the plate wasn't clear. */
      suggestions?: { t: number; fx: number; fy: number; fr: number }[];
    };

class Cancelled extends Error {}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Hand the page back (a frame's worth of work at most at a time). */
function yieldToPage(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched?.yield) return sched.yield();
  return new Promise((r) => setTimeout(r, 0));
}

export async function analyzeVideo(input: RunInput): Promise<RunResult> {
  const report = (stage: RunStage, progress: number) =>
    input.onProgress?.({ stage, progress: Math.max(0, Math.min(1, progress)) });
  const check = () => {
    if (input.signal?.aborted) throw new Cancelled();
  };
  let disposable: { dispose?: () => void } | null = null;
  try {
    report("opening", 0);
    const mb = await loadMediabunny();
    const src =
      typeof input.source === "string"
        ? new mb.UrlSource(input.source)
        : new mb.BlobSource(input.source);
    const inp = new mb.Input({ source: src, formats: mb.ALL_FORMATS });
    disposable = inp;
    const track = await inp.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return { ok: false, why: "unreadable", find: null };
    const duration = await inp.computeDuration();
    const first = await track.getFirstTimestamp().catch(() => 0);
    check();
    const start = Math.max(first, input.window?.start ?? first);
    const end = Math.min(duration, input.window?.end ?? duration, start + MAX_ANALYSIS_SECONDS);
    if (!(end - start > 1)) return { ok: false, why: "too_short", find: null };
    // the frame's shape as shown (a phone's portrait clip is stored on its side)
    const dw = track.displayWidth || 9;
    const dh = track.displayHeight || 16;
    const L = Math.min(WORKING_LONG_SIDE, Math.max(dw, dh));
    const w = dw >= dh ? L : Math.max(16, Math.round((L * dw) / dh));
    const h = dw >= dh ? Math.max(16, Math.round((L * dh) / dw)) : L;
    // decoded at twice the working size where the clip has the pixels, and averaged down (image.ts)
    const scale = Math.max(dw, dh) > 1.25 * L ? 2 : 1;
    const toFrame = (wc: {
      canvas: HTMLCanvasElement | OffscreenCanvas;
      timestamp: number;
    }): Frame | null => {
      const ctx = wc.canvas.getContext("2d", { willReadFrequently: true }) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) return null;
      const data = ctx.getImageData(0, 0, scale * w, scale * h).data;
      return {
        w,
        h,
        t: wc.timestamp,
        px: scale === 2 ? rgbaToGrayHalf(data, w, h) : rgbaToGray(data, w * h),
      };
    };

    // 1. the plate
    report("finding", 0);
    const sink = new mb.CanvasSink(track, {
      width: scale * w,
      height: scale * h,
      fit: "fill",
      poolSize: 1,
    });
    const span = end - start;
    const n = sampleCount(span);
    const sampleTimes = Array.from({ length: n }, (_, i) => start + (span * (i + 0.5)) / n);
    const samples: Frame[] = [];
    let k = 0;
    for await (const wc of sink.canvasesAtTimestamps(sampleTimes)) {
      check();
      k++;
      if (!wc) continue;
      const f = toFrame(wc);
      if (f) samples.push(f);
      report("finding", (0.6 * k) / sampleTimes.length);
      await yieldToPage();
    }
    let tapFrame: Frame | undefined;
    let seed: Seed = { kind: "auto" };
    if (input.tap) {
      const wc = await sink.getCanvas(Math.max(first, input.tap.t));
      const f = wc ? toFrame(wc) : null;
      if (f) tapFrame = f;
      seed = { kind: "tap", t: input.tap.t, x: input.tap.fx * w, y: input.tap.fy * h };
    }
    check();
    await yieldToPage();
    const loc = locatePlate(samples, seed, tapFrame);
    report("finding", 1);
    if ("why" in loc) {
      // the moving circles worth offering for a tap
      const suggestions = (loc.find?.others ?? []).slice(0, 4).map((c) => {
        const hit = c.hits[Math.floor(c.hits.length / 2)];
        return { t: hit.t, fx: hit.x / w, fy: hit.y / h, fr: c.r / w };
      });
      return { ok: false, why: loc.why, find: loc.find, suggestions };
    }
    samples.length = 0;

    // 2. every frame
    report("tracking", 0);
    const fol = new PlateFollower(loc.seed, loc.track, loc.decoys);
    const shake: number[] = [];
    let prev: Frame | null = null;
    let slice = now();
    for await (const wc of sink.canvases(start, end)) {
      check();
      const f = toFrame(wc);
      if (!f) continue;
      const p = fol.push(f);
      if (prev && p.found) {
        const sh = cameraShift(prev, f, shakeExclusion(p.x, p.y, loc.seed.r));
        if (sh.ok) shake.push(Math.hypot(sh.dx, sh.dy));
      }
      prev = f;
      if (now() - slice > 10) {
        report("tracking", (f.t - start) / span);
        await yieldToPage();
        slice = now();
      }
    }
    check();

    // 3. the lift
    report("reading", 0);
    const analysis = analyzeTrack(fol.points(), {
      plate: input.plate,
      source: loc.source,
      seed: { x: loc.seed.x, y: loc.seed.y, r: loc.seed.r, t: loc.seed.frame.t },
      frame: { w, h },
      dirHint: input.dirHint,
      shake,
    });
    report("reading", 1);
    if (rimNeverMeasured(analysis, loc.source)) {
      const suggestions = (loc.find?.others ?? []).slice(0, 4).map((c) => {
        const hit = c.hits[Math.floor(c.hits.length / 2)];
        return { t: hit.t, fx: hit.x / w, fy: hit.y / h, fr: c.r / w };
      });
      return { ok: false, why: "no_plate", find: loc.find, suggestions };
    }
    return { ok: true, analysis, find: loc.find };
  } catch (e) {
    if (e instanceof Cancelled || input.signal?.aborted)
      return { ok: false, why: "cancelled", find: null };
    return { ok: false, why: "unreadable", find: null };
  } finally {
    try {
      disposable?.dispose?.();
    } catch {
      /* already closed */
    }
  }
}
