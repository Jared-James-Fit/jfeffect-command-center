/**
 * Lift analysis in the browser: the clip decoded on the device (mediabunny +
 * the phone's own hardware decoder, as the trimmer does), at a small working
 * size, and the engine run on the way through. Nothing leaves the device.
 *
 *   detect   frames four a second through the clip: where the plate is and
 *            how sure (detect.ts): the marker the athlete confirms or drags,
 *            or the circles to tap. Fast: a second or two.
 *   track    from the confirmed frame (and any corrections) the plate is
 *            followed forward to the end, frame by frame as they decode, and
 *            backward to the start, a short stretch at a time decoded and
 *            walked in reverse (keyed.ts): every frame reached from a key
 *   measure  the plate's outer edge at full resolution in the still frames:
 *            its size is the ruler (rim-outer.ts)
 *   read     the reps and their numbers (analyze.ts)
 *
 * The work yields to the page every few milliseconds, so logging carries on
 * smoothly while it runs, and stops the moment it's cancelled.
 */
import { autoReadCheck } from "@/lib/lift-analysis/auto-check";
import type { GuideLift } from "@/lib/lift-analysis/exercise";
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { RunProgress, RunStage } from "@/lib/lift-analysis/progress";
import type { PlateSize } from "@/lib/lift-analysis/calibrate";
import {
  calibrationTimes,
  keyFromMarker,
  plateAtTap,
  shapeAtMarker,
  proposePlate,
  supportFor,
  type Proposal,
} from "@/lib/lift-analysis/detect";
import {
  rimNeverMeasured,
  sampleCount,
  shakeExclusion,
  viewsFor,
} from "@/lib/lift-analysis/engine";
import { footageIssues, meanBrightness, type FootageIssue } from "@/lib/lift-analysis/footage";
import { rgbaToGray, rgbaToGrayHalf, type Frame, type Gray } from "@/lib/lift-analysis/image";
import { KeyedPass, mergePasses, type KeyedPoint, type TrackKey } from "@/lib/lift-analysis/keyed";
import { cameraShift } from "@/lib/lift-analysis/motion";
import { frameSightings, type Sighting } from "@/lib/lift-analysis/find";
import { outerRim, plateSizedRims, rimSize, type OuterRim } from "@/lib/lift-analysis/rim-outer";
import { applyRecovered, gapsToRecover, recoverGap } from "@/lib/lift-analysis/recover";
import type { FollowPoint } from "@/lib/lift-analysis/follow";
import { loadMediabunny } from "@/lib/video-edit/probe";

/** The long side frames are analysed at: the plate's rim spans ~40–60 px across, plenty for sub-pixel fits. */
export const WORKING_LONG_SIDE = 480;
/** The long side the plate's size is measured at (the clip's own resolution, up to this). */
export const MEASURE_LONG_SIDE = 1920;
/** Never more than this much of a clip (a set, with its setup and rack). */
export const MAX_ANALYSIS_SECONDS = 75;
/** Walking backward, this much of the clip is decoded at a time (a few MB at the working size). */
const BACK_CHUNK_S = 1.5;

export type { RunProgress, RunStage } from "@/lib/lift-analysis/progress";
export { overallProgress } from "@/lib/lift-analysis/progress";

/** A point and size as shares of the shown frame (0…1): independent of the size anything was analysed at. */
export type ShownKey = {
  t: number;
  fx: number;
  fy: number;
  /** Semi-axes as shares of the frame's width / height. */
  fa: number;
  fb: number;
  source: TrackKey["source"];
};

export type ShownSeed =
  | { kind: "auto" }
  | { kind: "proposal" }
  | { kind: "tap"; t: number; fx: number; fy: number }
  | { kind: "marker"; t: number; fx: number; fy: number; fa: number; fb: number }
  | { kind: "keys"; keys: ShownKey[] };

/** What detection proposes, in shares of the shown frame. */
export type ShownProposal = {
  confidence: Proposal["confidence"];
  why: string;
  key: ShownKey | null;
  candidates: { t: number; fx: number; fy: number; fr: number }[];
  /** How clearly the plate's outer edge showed at the marker (0…1 of the way round). */
  edgeShare: number | null;
  /** What about the footage will cost accuracy, with how to film it better (footage.ts). */
  footage: FootageIssue[];
};

/** What the clip is, for the footage check. */
export type ClipInfo = {
  /** The shown frame (px) and the working size it was analysed at. */
  width: number;
  height: number;
  w: number;
  h: number;
  fps: number;
  duration: number;
  start: number;
  end: number;
};

export type RunInput = {
  /** The clip: the file itself (just filmed or picked: no download) or its signed link. */
  source: Blob | string;
  /** Only this part (seconds of the clip). */
  window?: { start: number; end: number };
  /** Where tracking starts (default: detection alone, read only when it's sure). */
  seed?: ShownSeed;
  /** Frames where the athlete put the marker right on the plate. */
  corrections?: { t: number; fx: number; fy: number }[];
  /** Stop after detection (the confirm step): no tracking. */
  detectOnly?: boolean;
  plate?: PlateSize & { confirmed?: boolean };
  dirHint?: "lower_first" | "lift_first";
  /** Which lift (the exercise's name), for checking a read made on its own (auto-check.ts). */
  lift?: GuideLift;
  /** Rises the athlete said aren't reps (kept when a read is done again from its keys). */
  exclude?: number[];
  signal?: AbortSignal;
  onProgress?: (p: RunProgress) => void;
};

export type RunFailure =
  | "no_plate"
  | "ambiguous"
  | "no_plate_at_tap"
  | "needs_confirm"
  | "unreadable"
  | "too_short"
  | "cancelled";

export type RunResult =
  | { ok: true; analysis: LiftAnalysis; proposal: ShownProposal | null; clip: ClipInfo }
  | {
      ok: false;
      why: RunFailure;
      proposal: ShownProposal | null;
      clip: ClipInfo | null;
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

export function toShownKey(k: TrackKey, w: number, h: number): ShownKey {
  return { t: k.t, fx: k.x / w, fy: k.y / h, fa: k.a / w, fb: k.b / h, source: k.source };
}

export function fromShownKey(k: ShownKey, w: number, h: number): TrackKey {
  return { t: k.t, x: k.fx * w, y: k.fy * h, a: k.fa * w, b: k.fb * h, source: k.source };
}

function shownProposal(
  p: Proposal,
  w: number,
  h: number,
  footage: FootageIssue[] = [],
): ShownProposal {
  return {
    confidence: p.confidence,
    why: p.why,
    key: p.key ? toShownKey(p.key, w, h) : null,
    candidates: p.candidates.map((c) => ({ t: c.t, fx: c.x / w, fy: c.y / h, fr: c.r / w })),
    edgeShare: p.edgeShare,
    footage,
  };
}

/**
 * The last clip's sampled frames and the circles found in them, kept for the
 * next read of the same clip (Confirm → Analyze, Fix tracking, Start over), so
 * it never decodes and searches them twice: the same frames give the same
 * circles. One clip at a time (a few MB at the working size).
 */
let lastDetected: { key: string; samples: Frame[]; seen: Sighting[][] } | null = null;
const blobIds = new WeakMap<Blob, number>();
let nextBlobId = 1;
function sourceKey(src: Blob | string): string {
  if (typeof src !== "string") {
    let id = blobIds.get(src);
    if (!id) blobIds.set(src, (id = nextBlobId++));
    return `blob:${id}`;
  }
  // a signed link's token changes each time it's signed; the object is its path
  try {
    const u = new URL(src, typeof location !== "undefined" ? location.href : "http://x");
    return u.origin + u.pathname;
  } catch {
    return src;
  }
}

export async function analyzeVideo(input: RunInput): Promise<RunResult> {
  const report = (stage: RunStage, progress: number) =>
    input.onProgress?.({ stage, progress: Math.max(0, Math.min(1, progress)) });
  const check = () => {
    if (input.signal?.aborted) throw new Cancelled();
  };
  let disposable: { dispose?: () => void } | null = null;
  let clip: ClipInfo | null = null;
  let proposalOut: ShownProposal | null = null;
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
    if (!track || !(await track.canDecode()))
      return { ok: false, why: "unreadable", proposal: null, clip: null };
    const duration = await inp.computeDuration();
    const first = await track.getFirstTimestamp().catch(() => 0);
    check();
    const start = Math.max(first, input.window?.start ?? first);
    const end = Math.min(duration, input.window?.end ?? duration, start + MAX_ANALYSIS_SECONDS);
    // the frame's shape as shown (a phone's portrait clip is stored on its side)
    const dw = track.displayWidth || 9;
    const dh = track.displayHeight || 16;
    const L = Math.min(WORKING_LONG_SIDE, Math.max(dw, dh));
    const w = dw >= dh ? L : Math.max(16, Math.round((L * dw) / dh));
    const h = dw >= dh ? Math.max(16, Math.round((L * dh) / dw)) : L;
    const stats = await track.computePacketStats(120).catch(() => null);
    clip = {
      width: dw,
      height: dh,
      w,
      h,
      fps: stats?.averagePacketRate ?? 30,
      duration,
      start,
      end,
    };
    if (!(end - start > 1)) return { ok: false, why: "too_short", proposal: null, clip };
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
    const sink = new mb.CanvasSink(track, {
      width: scale * w,
      height: scale * h,
      fit: "fill",
      poolSize: 1,
    });

    // ── detect: four frames a second, each searched for circles as it's decoded ──
    report("finding", 0);
    const span = end - start;
    const n = sampleCount(span);
    const sampleTimes = Array.from({ length: n }, (_, i) => start + (span * (i + 0.5)) / n);
    const cacheKey = `${sourceKey(input.source)}|${start}|${end}|${w}x${h}|${scale}|${n}`;
    const cached = lastDetected?.key === cacheKey ? lastDetected : null;
    const samples: Frame[] = cached ? cached.samples.slice() : [];
    const seen: Sighting[][] = cached ? cached.seen : [];
    if (!cached) {
      let k = 0;
      for await (const wc of sink.canvasesAtTimestamps(sampleTimes)) {
        check();
        k++;
        if (!wc) continue;
        const f = toFrame(wc);
        if (f) {
          samples.push(f);
          await yieldToPage();
          seen.push(frameSightings(f, samples.length - 1));
        }
        report("finding", (0.92 * k) / sampleTimes.length);
        await yieldToPage();
      }
      check();
      lastDetected = { key: cacheKey, samples: samples.slice(), seen };
    }
    const frameNear = async (t: number): Promise<Frame | null> => {
      const wc = await sink.getCanvas(Math.max(first, t));
      return wc ? toFrame(wc) : null;
    };
    const seed = input.seed ?? { kind: "auto" };
    let keys: TrackKey[] = [];
    let proposal: Proposal | null = null;
    if (seed.kind === "auto" || seed.kind === "proposal" || input.detectOnly) {
      proposal = proposePlate(samples, seen);
      const footage = footageIssues({
        fps: clip.fps,
        frame: { width: dw, height: dh, w, h },
        plate: proposal.key,
        path: proposal.backbone?.hits ?? [],
        brightness: meanBrightness(samples),
      });
      proposalOut = shownProposal(proposal, w, h, footage);
    }
    report("finding", 1);
    if (input.detectOnly) return { ok: false, why: "needs_confirm", proposal: proposalOut, clip };
    const fail = (why: RunFailure): RunResult => ({
      ok: false,
      why,
      proposal: proposalOut,
      clip,
      suggestions: proposalOut?.candidates ?? [],
    });
    if (seed.kind === "auto" || seed.kind === "proposal") {
      if (!proposal!.key || proposal!.confidence === "low")
        return fail(proposal!.why === "ambiguous" ? "ambiguous" : "no_plate");
      // a medium proposal is read too, on its own only when the read proves it was the plate
      keys = [proposal!.key];
    } else if (seed.kind === "tap") {
      const f = await frameNear(seed.t);
      const rim = f ? plateAtTap(f, seed.fx * w, seed.fy * h) : null;
      if (!f || !rim) return fail("no_plate_at_tap");
      keys = [{ t: f.t, x: rim.x, y: rim.y, a: rim.a, b: rim.b, source: "confirmed" }];
    } else if (seed.kind === "marker") {
      const f = await frameNear(seed.t);
      if (!f) return fail("unreadable");
      keys = [
        keyFromMarker(
          f,
          { x: seed.fx * w, y: seed.fy * h, a: seed.fa * w, b: seed.fb * h },
          "confirmed",
        ).key,
      ];
    } else {
      keys = seed.keys.map((s) => fromShownKey(s, w, h));
      // a ring kept from an earlier read is a circle; the plate off side-on is an ellipse: its shape
      // learned on the key's own frame (detect.ts shapeAtMarker), so the tracker expects what it sees
      const k0 = keys[0];
      if (k0 && k0.source !== "auto" && Math.abs(k0.a / k0.b - 1) < 0.03) {
        const f = await frameNear(k0.t);
        const shape = f ? shapeAtMarker(f, k0) : null;
        if (shape) keys[0] = { ...k0, ...shape };
      }
    }
    const main = keys[0];
    if (!main) return fail("no_plate");
    for (const c of input.corrections ?? []) {
      const f = await frameNear(c.t);
      if (f)
        keys.push(
          keyFromMarker(f, { x: c.fx * w, y: c.fy * h, a: main.a, b: main.b }, "correction").key,
        );
    }
    const byT = new Map<number, TrackKey>();
    for (const key of keys) byT.set(Math.round(key.t * 1000), key);
    keys = [...byT.values()].sort((a, b) => a.t - b.t);
    check();

    // the tracker's helpers: the plate's own sightings, plates that never moved, other pictures of it
    const support =
      proposal && proposal.key === main
        ? { backbone: proposal.backbone, decoys: proposal.decoys }
        : supportFor(main, samples, seen);
    const R = Math.sqrt(main.a * main.b);
    // every key's own picture of the plate (each follower matches against all of them)
    const keyViews: { frame: Frame; x: number; y: number; r: number }[] = [];
    for (const key of keys) {
      const f = samples.find((s) => Math.abs(s.t - key.t) < 0.02) ?? (await frameNear(key.t));
      if (f) keyViews.push({ frame: f, x: key.x, y: key.y, r: R });
    }
    const views = [
      ...keyViews,
      ...viewsFor(support.backbone, samples, main).filter((v) =>
        keys.every((key) => Math.abs(v.y - key.y) >= R),
      ),
    ];
    samples.length = 0;
    const plateMm = input.plate?.mm ?? 450;
    const setup = {
      backbone: support.backbone,
      decoys: support.decoys,
      follow: { strict: true, mmPerPx: plateMm / (2 * R) },
      views: views.length > 1 ? views : undefined,
    };

    // ── track: forward from the first key, then backward from the last ──
    report("tracking", 0);
    const t0 = keys[0].t;
    const t1 = keys[keys.length - 1].t;
    const total = Math.max(0.1, end - t0 + (t1 - start));
    const shake: number[] = [];
    const shakeFrom = (a: Frame, b: Frame, p: KeyedPoint | null) => {
      if (!p?.found) return;
      const sh = cameraShift(a, b, shakeExclusion(p.x, p.y, R));
      if (sh.ok) shake.push(Math.hypot(sh.dx, sh.dy));
    };
    const fwd = new KeyedPass(1, keys, setup);
    let prev: Frame | null = null;
    let slice = now();
    for await (const wc of sink.canvases(Math.max(start, t0 - 0.05), end)) {
      check();
      const f = toFrame(wc);
      if (!f || f.t < t0 - 0.05) continue;
      const p = fwd.push(f);
      if (prev) shakeFrom(prev, f, p);
      prev = f;
      if (now() - slice > 10) {
        report("tracking", (f.t - t0) / total);
        await yieldToPage();
        slice = now();
      }
    }
    const bwd = new KeyedPass(-1, keys, setup);
    let edge = t1 + 0.05;
    while (edge > start + 1e-3) {
      check();
      const from = Math.max(start, edge - BACK_CHUNK_S);
      const chunk: Frame[] = [];
      for await (const wc of sink.canvases(from, edge)) {
        const f = toFrame(wc);
        if (f && f.t >= from - 1e-4 && f.t < edge - 1e-4) chunk.push(f);
        if (now() - slice > 10) {
          await yieldToPage();
          slice = now();
        }
      }
      chunk.sort((a, b) => a.t - b.t);
      prev = null;
      for (let i = chunk.length - 1; i >= 0; i--) {
        const f = chunk[i];
        const p = bwd.push(f);
        if (prev) shakeFrom(f, prev, p);
        prev = f;
        if (now() - slice > 10) {
          report("tracking", (end - t0 + (t1 - f.t)) / total);
          await yieldToPage();
          slice = now();
        }
      }
      check();
      edge = from;
    }
    const passes = mergePasses(fwd.points(), bwd.points(), R);
    check();

    // ── recover: each stretch lost with the plate seen either side, read again from both ends ──
    // (recover.ts: only those frames are decoded again; nothing is drawn across what isn't followed)
    const gaps = gapsToRecover(passes.points);
    const got: FollowPoint[] = [];
    if (gaps.length) report("recovering", 0);
    for (let g = 0; g < gaps.length; g++) {
      check();
      const gap = gaps[g];
      const span: Frame[] = [];
      for await (const wc of sink.canvases(
        Math.max(start, gap.before.t - 0.02),
        gap.after.t + 0.05,
      )) {
        const f = toFrame(wc);
        if (f && f.t >= gap.before.t - 1e-4 && f.t <= gap.after.t + 1e-4) span.push(f);
        if (now() - slice > 10) {
          await yieldToPage();
          slice = now();
        }
      }
      span.sort((a, b) => a.t - b.t);
      got.push(...recoverGap(span, gap, { a: main.a, b: main.b }, setup));
      report("recovering", (g + 1) / gaps.length);
      await yieldToPage();
    }
    const rec = applyRecovered(passes.points, got);
    const merged = { points: rec.points, conflicts: passes.conflicts };
    check();

    // ── measure: the plate's outer edge at full resolution, in the still frames ──
    report("measuring", 0);
    const times = calibrationTimes(merged.points, R);
    const ML = Math.min(MEASURE_LONG_SIDE, Math.max(dw, dh));
    const mw = dw >= dh ? ML : Math.round((ML * dw) / dh);
    const mh = dw >= dh ? Math.round((ML * dh) / dw) : ML;
    const k2 = mw / w;
    const rims: (OuterRim & { scale: number })[] = [];
    if (times.length) {
      const big = new mb.CanvasSink(track, { width: mw, height: mh, fit: "fill", poolSize: 1 });
      let j = 0;
      for await (const wc of big.canvasesAtTimestamps(times.map((c) => c.t))) {
        check();
        const c = times[j++];
        if (!wc || !c) continue;
        const roi = cropGray(wc.canvas, c.x * k2, c.y * k2, 1.75 * R * k2, mw, mh);
        if (!roi) continue;
        const rim = outerRim(roi.img, c.x * k2 - roi.x0, c.y * k2 - roi.y0, R * k2, {
          lo: 0.75,
          hi: 1.3,
        });
        if (rim) rims.push({ ...rim, scale: 1 / k2, y: (rim.y + roi.y0) / k2 });
        report("measuring", j / times.length);
        await yieldToPage();
      }
    }
    // the plate's own rim, even when the ring the track started from was another size (rim-outer.ts)
    const size = rimSize(plateSizedRims(rims, R * k2));

    // ── read ──
    report("reading", 0);
    const analysis = analyzeTrack(merged.points, {
      plate: input.plate,
      source: keys.some((key) => key.source !== "auto") ? "tap" : "auto",
      seed: { x: main.x, y: main.y, r: R, t: main.t },
      frame: { w, h },
      dirHint: input.dirHint,
      shake,
      size,
      keys,
      conflicts: merged.conflicts,
      recovered: rec.recovered,
      exclude: input.exclude,
    });
    report("reading", 1);
    if (rimNeverMeasured(analysis, main.source === "auto" ? "auto" : "tap"))
      return fail("no_plate");
    // on its own: kept only when what it measured is a lift (a ring it can't vouch for waits for a look)
    if (
      seed.kind === "auto" &&
      !autoReadCheck(analysis, input.lift ?? "other", proposal?.confidence ?? "high").ok
    )
      return fail("needs_confirm");
    return { ok: true, analysis, proposal: proposalOut, clip };
  } catch (e) {
    if (e instanceof Cancelled || input.signal?.aborted)
      return { ok: false, why: "cancelled", proposal: proposalOut, clip };
    return { ok: false, why: "unreadable", proposal: proposalOut, clip };
  } finally {
    try {
      disposable?.dispose?.();
    } catch {
      /* already closed */
    }
  }
}

/**
 * The plate under a point on one frame, for the confirm step: the athlete
 * taps (or drops the marker) and the ring snaps to the plate's edge there at
 * once, before anything is tracked. Decodes just that frame (at the working
 * size, the same pixels tracking reads). Null when no plate is there.
 */
export async function locatePlate(input: {
  source: Blob | string;
  t: number;
  fx: number;
  fy: number;
  signal?: AbortSignal;
}): Promise<{ key: ShownKey; edgeShare: number } | null> {
  let disposable: { dispose?: () => void } | null = null;
  try {
    const mb = await loadMediabunny();
    const src =
      typeof input.source === "string"
        ? new mb.UrlSource(input.source)
        : new mb.BlobSource(input.source);
    const inp = new mb.Input({ source: src, formats: mb.ALL_FORMATS });
    disposable = inp;
    const track = await inp.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const dw = track.displayWidth || 9;
    const dh = track.displayHeight || 16;
    const L = Math.min(WORKING_LONG_SIDE, Math.max(dw, dh));
    const w = dw >= dh ? L : Math.max(16, Math.round((L * dw) / dh));
    const h = dw >= dh ? Math.max(16, Math.round((L * dh) / dw)) : L;
    const scale = Math.max(dw, dh) > 1.25 * L ? 2 : 1;
    const sink = new mb.CanvasSink(track, {
      width: scale * w,
      height: scale * h,
      fit: "fill",
      poolSize: 1,
    });
    const first = await track.getFirstTimestamp().catch(() => 0);
    const wc = await sink.getCanvas(Math.max(first, input.t));
    if (!wc || input.signal?.aborted) return null;
    const ctx = wc.canvas.getContext("2d", { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) return null;
    const data = ctx.getImageData(0, 0, scale * w, scale * h).data;
    const f: Frame = {
      w,
      h,
      t: wc.timestamp,
      px: scale === 2 ? rgbaToGrayHalf(data, w, h) : rgbaToGray(data, w * h),
    };
    const rim = plateAtTap(f, input.fx * w, input.fy * h);
    if (!rim) return null;
    return {
      key: toShownKey(
        { t: f.t, x: rim.x, y: rim.y, a: rim.a, b: rim.b, source: "confirmed" },
        w,
        h,
      ),
      edgeShare: rim.share,
    };
  } catch {
    return null;
  } finally {
    try {
      disposable?.dispose?.();
    } catch {
      /* already closed */
    }
  }
}

/** A grey crop (half-size 2r + a margin, around (cx, cy)) of a canvas, with its origin. */
function cropGray(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  cx: number,
  cy: number,
  r: number,
  W: number,
  H: number,
): { img: Gray; x0: number; y0: number } | null {
  const x0 = Math.max(0, Math.floor(cx - r - 4));
  const y0 = Math.max(0, Math.floor(cy - r - 4));
  const x1 = Math.min(W, Math.ceil(cx + r + 4));
  const y1 = Math.min(H, Math.ceil(cy + r + 4));
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  return { img: { w: x1 - x0, h: y1 - y0, px: rgbaToGray(data, (x1 - x0) * (y1 - y0)) }, x0, y0 };
}
