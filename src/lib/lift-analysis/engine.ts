/**
 * The engine in one call, for frames already in memory (tests, the
 * validation harness): find the plate on sample frames (or under a tap),
 * follow it through every frame, read the lift. The browser pipeline
 * (run.ts) does the same steps while decoding, without holding every frame.
 */
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { PlateSize } from "@/lib/lift-analysis/calibrate";
import {
  anchorsFor,
  detectPlate,
  plateAtTap,
  type PlateDetection,
  type PlateHit,
} from "@/lib/lift-analysis/detect";
import type { Frame } from "@/lib/lift-analysis/image";
import { cameraShift } from "@/lib/lift-analysis/motion";
import { PlateTracker } from "@/lib/lift-analysis/track";

/** How many frames to look for the plate on. */
export const SAMPLE_FRAMES = 12;

/** Evenly spread sample indices over n frames. */
export function sampleIndices(n: number, k = SAMPLE_FRAMES): number[] {
  if (n <= k) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: k }, (_, i) => Math.round(((i + 0.5) * (n - 1)) / k));
}

export type Seed = { kind: "auto" } | { kind: "tap"; t: number; x: number; y: number };

export type EngineResult =
  | { ok: true; analysis: LiftAnalysis; detection: PlateDetection | null }
  | {
      ok: false;
      why: "no_plate" | "ambiguous" | "no_plate_at_tap";
      detection: PlateDetection | null;
    };

export type Located = {
  r: number;
  q: number;
  x: number;
  y: number;
  t: number;
  anchors: PlateHit[];
  source: "auto" | "tap";
  detection: PlateDetection | null;
};

/** Find the plate: on its own (confident only) or under a tap. */
export function locatePlate(
  samples: Frame[],
  seed: Seed,
  tapFrame?: Frame,
):
  | Located
  | { why: "no_plate" | "ambiguous" | "no_plate_at_tap"; detection: PlateDetection | null } {
  if (seed.kind === "tap") {
    if (!tapFrame) return { why: "no_plate_at_tap", detection: null };
    const fit = plateAtTap(tapFrame, seed);
    if (!fit) return { why: "no_plate_at_tap", detection: null };
    const anchors = anchorsFor(samples, fit);
    anchors.push({
      t: tapFrame.t,
      x: fit.x,
      y: fit.y,
      r: fit.r,
      a: fit.a,
      b: fit.b,
      coverage: fit.coverage,
    });
    return {
      r: fit.r,
      q: fit.a / fit.b,
      x: fit.x,
      y: fit.y,
      t: tapFrame.t,
      anchors,
      source: "tap",
      detection: null,
    };
  }
  const detection = detectPlate(samples);
  if (!detection.best) return { why: "no_plate", detection };
  if (!detection.confident)
    return {
      why:
        detection.why === "ambiguous" || detection.why === "not_plate_like"
          ? "ambiguous"
          : "no_plate",
      detection,
    };
  const b = detection.best;
  const firstHit = b.hits[0];
  return {
    r: b.r,
    q: b.q,
    x: firstHit.x,
    y: firstHit.y,
    t: firstHit.t,
    anchors: b.hits,
    source: "auto",
    detection,
  };
}

export function runEngine(
  frames: Frame[],
  opts: {
    seed?: Seed;
    plate?: PlateSize & { confirmed?: boolean };
    dirHint?: "lower_first" | "lift_first";
  } = {},
): EngineResult {
  const seed = opts.seed ?? { kind: "auto" };
  const samples = sampleIndices(frames.length).map((i) => frames[i]);
  const tapFrame =
    seed.kind === "tap"
      ? frames.reduce((b, f) => (Math.abs(f.t - seed.t) < Math.abs(b.t - seed.t) ? f : b))
      : undefined;
  const loc = locatePlate(samples, seed, tapFrame);
  if ("why" in loc) return { ok: false, why: loc.why, detection: loc.detection };
  const tracker = new PlateTracker({ r: loc.r, anchors: loc.anchors, q: loc.q });
  const shake: number[] = [];
  let prev: Frame | null = null;
  for (const f of frames) {
    const p = tracker.push(f);
    if (prev) {
      const ex = {
        x0: p.x - 1.6 * loc.r,
        x1: p.x + 1.6 * loc.r,
        y0: p.y - 3 * loc.r,
        y1: p.y + 3 * loc.r,
      };
      const sh = cameraShift(prev, f, ex);
      if (sh.ok) shake.push(Math.hypot(sh.dx, sh.dy));
    }
    prev = f;
  }
  const analysis = analyzeTrack(tracker.points(), {
    plate: opts.plate,
    source: loc.source,
    seed: { x: loc.x, y: loc.y, r: loc.r, t: loc.t },
    frame: { w: frames[0].w, h: frames[0].h },
    dirHint: opts.dirHint,
    shake,
  });
  return { ok: true, analysis, detection: loc.detection };
}
