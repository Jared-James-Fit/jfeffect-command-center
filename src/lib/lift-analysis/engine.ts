/**
 * The engine in one call, for frames already in memory (tests, the
 * validation harness): find the plate on sample frames (or under a tap),
 * follow it through every frame, read the lift. The browser pipeline
 * (run.ts) does the same steps while decoding, without holding every frame.
 */
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { PlateSize } from "@/lib/lift-analysis/calibrate";
import { fitRim } from "@/lib/lift-analysis/circle";
import {
  circleCandidates,
  findPlate,
  halfSize,
  linkTracks,
  radiusRange,
  seenApartTogether,
  sightings,
  stillCircles,
  type CircleTrack,
  type PlateFind,
} from "@/lib/lift-analysis/find";
import { bestSeed, PlateFollower, type Decoy, type FollowSeed } from "@/lib/lift-analysis/follow";
import { gradients, type Frame } from "@/lib/lift-analysis/image";
import { cameraShift } from "@/lib/lift-analysis/motion";
import { measureRim } from "@/lib/lift-analysis/rim";

/** How many frames to look for the plate on: four a second, between 12 and 40. */
export function sampleCount(seconds: number): number {
  return Math.min(40, Math.max(12, Math.ceil(seconds * 4)));
}

/** Evenly spread sample indices over n frames. */
export function sampleIndices(n: number, k: number): number[] {
  if (n <= k) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: k }, (_, i) => Math.round(((i + 0.5) * (n - 1)) / k));
}

export type Seed = { kind: "auto" } | { kind: "tap"; t: number; x: number; y: number };

export type Located = {
  seed: FollowSeed;
  track: CircleTrack | null;
  source: "auto" | "tap";
  find: PlateFind | null;
  /** Plate-sized circles that never moved: never the bar plate. */
  decoys: Decoy[];
};

export type NotLocated = {
  why: "no_plate" | "ambiguous" | "no_plate_at_tap";
  find: PlateFind | null;
};

/**
 * The plate under a tap (anywhere on its face, not only the end of the bar):
 * every circle round the tap, and the rim the rays from the tap agree on,
 * each refined to the edge it really sits on; the one whose rim shows most
 * completely wins. A "circle" through the lifter and the plate together
 * shows less than half its rim; the plate shows nearly all of it.
 */
function plateAtTap(f: Frame, x: number, y: number) {
  const small = halfSize(f);
  const range = radiusRange(small.w, small.h);
  const guesses = circleCandidates(small, { ...range, max: 12 })
    .map((c) => ({ x: c.x * 2 + 0.5, y: c.y * 2 + 0.5, r: c.r * 2 }))
    .filter((c) => Math.hypot(c.x - x, c.y - y) <= 0.9 * c.r);
  const full = radiusRange(f.w, f.h);
  const m = measureRim(f, x, y, full.rMin, full.rMax);
  if (m && m.share >= 0.3) guesses.push({ x, y, r: m.r });
  let best: ReturnType<typeof fitRim> = null;
  for (const gs of guesses) {
    const pad = Math.ceil(gs.r * 1.6) + 3;
    const g = gradients(f, gs.x - pad, gs.y - pad, gs.x + pad, gs.y + pad);
    for (const k of [0.84, 0.96, 1.08]) {
      const fit = fitRim(
        g,
        { x: gs.x, y: gs.y, r: gs.r * k },
        { rTol: 0.12, ellipse: true, edgeMin: 12 },
      );
      if (!fit || fit.rms > 1.5 || fit.coverage < 0.35) continue;
      // the tap is on this plate
      if (Math.hypot(fit.x - x, fit.y - y) > 0.9 * fit.r) continue;
      if (!best || fit.coverage > best.coverage) best = fit;
    }
  }
  return best;
}

/**
 * The still circles that are other objects: seen at the same moments as the
 * bar plate, somewhere else (the bar plate's own sightings while it rests in
 * the hooks between reps can look still too, and are never a decoy).
 */
const toDecoys = (still: CircleTrack[], plate: CircleTrack | null): Decoy[] =>
  still
    .filter((t) => t !== plate && (!plate || seenApartTogether(t, plate) >= 3))
    .map((t) => {
      const h = t.hits[t.hits.length >> 1];
      return { x: h.x, y: h.y, r: t.r };
    });

/** Find the plate: on its own (confident only) or under a tap. */
export function locatePlate(samples: Frame[], seed: Seed, tapFrame?: Frame): Located | NotLocated {
  if (seed.kind === "tap") {
    if (!tapFrame) return { why: "no_plate_at_tap", find: null };
    const fit = plateAtTap(tapFrame, seed.x, seed.y);
    if (!fit) return { why: "no_plate_at_tap", find: null };
    // the tapped plate's own track through the samples, when the finder saw it: the tracker's backbone
    const tracks = linkTracks(sightings(samples), samples.length);
    const near = tracks
      .filter((tr) => Math.abs(tr.r - fit.r) <= 0.15 * fit.r)
      .map((tr) => {
        const h = tr.hits.reduce((b, p) =>
          Math.abs(p.t - tapFrame.t) < Math.abs(b.t - tapFrame.t) ? p : b,
        );
        const dt = Math.abs(h.t - tapFrame.t);
        return {
          tr,
          ok: dt <= 0.5 && Math.hypot(h.x - fit.x, h.y - fit.y) <= fit.r * (0.4 + 6 * dt),
        };
      })
      .filter((v) => v.ok)
      .sort((a, b) => b.tr.hits.length - a.tr.hits.length);
    const own = near[0]?.tr ?? null;
    const decoys = own ? toDecoys(stillCircles(tracks, samples.length), own) : [];
    // the tapped plate's best view among the samples makes the reference, as on its own
    const best = own ? bestSeed(own, samples) : null;
    const useBest = !!best && Math.abs(best.r - fit.r) <= 0.1 * fit.r;
    return {
      seed: useBest ? best : { frame: tapFrame, x: fit.x, y: fit.y, r: fit.r, a: fit.a, b: fit.b },
      track: own ?? {
        hits: [{ ...fit, t: tapFrame.t, fi: -1 }],
        r: fit.r,
        seen: 0,
        travelY: 0,
        travelX: 0,
        coverage: fit.coverage,
      },
      source: "tap",
      find: null,
      decoys,
    };
  }
  const find = findPlate(samples);
  if (!find.track) return { why: "no_plate", find };
  if (!find.confident) return { why: find.why === "ambiguous" ? "ambiguous" : "no_plate", find };
  const s = bestSeed(find.track, samples);
  if (!s) return { why: "no_plate", find };
  return {
    seed: s,
    track: find.track,
    source: "auto",
    find,
    decoys: toDecoys(find.still ?? [], find.track),
  };
}

export type EngineResult =
  | { ok: true; analysis: LiftAnalysis; find: PlateFind | null }
  | { ok: false; why: NotLocated["why"]; find: PlateFind | null };

/** The window around the plate the camera-shake read leaves out (the bar, the plate and the lifter under it). */
export function shakeExclusion(x: number, y: number, r: number) {
  return { x0: x - 1.6 * r, x1: x + 1.6 * r, y0: y - 3 * r, y1: y + 3 * r };
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
  const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
  const samples = sampleIndices(frames.length, sampleCount(span)).map((i) => frames[i]);
  const tapFrame =
    seed.kind === "tap"
      ? frames.reduce((b, f) => (Math.abs(f.t - seed.t) < Math.abs(b.t - seed.t) ? f : b))
      : undefined;
  const loc = locatePlate(samples, seed, tapFrame);
  if ("why" in loc) return { ok: false, why: loc.why, find: loc.find };
  const fol = new PlateFollower(loc.seed, loc.track, loc.decoys);
  const shake: number[] = [];
  let prev: Frame | null = null;
  for (const f of frames) {
    const p = fol.push(f);
    if (prev && p.found) {
      const sh = cameraShift(prev, f, shakeExclusion(p.x, p.y, loc.seed.r));
      if (sh.ok) shake.push(Math.hypot(sh.dx, sh.dy));
    }
    prev = f;
  }
  const analysis = analyzeTrack(fol.points(), {
    plate: opts.plate,
    source: loc.source,
    seed: { x: loc.seed.x, y: loc.seed.y, r: loc.seed.r, t: loc.seed.frame.t },
    frame: { w: frames[0].w, h: frames[0].h },
    dirHint: opts.dirHint,
    shake,
  });
  if (rimNeverMeasured(analysis, loc.source)) return { ok: false, why: "no_plate", find: loc.find };
  return { ok: true, analysis, find: loc.find };
}

/**
 * Found on its own, followed, and yet its rim measured in too few frames to
 * size it: a round shape that moved with the lift (a head, a knee, the
 * lifter's outline), not a plate. Asked for a tap instead of read.
 */
export function rimNeverMeasured(a: LiftAnalysis, source: "auto" | "tap"): boolean {
  return source === "auto" && !a.calibration.ok && a.calibration.why === "too_few_frames";
}
