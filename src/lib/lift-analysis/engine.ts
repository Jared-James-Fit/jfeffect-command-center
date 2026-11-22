/**
 * The engine in one call, for frames already in memory (tests, the
 * validation harness): where the plate is (detection, a tap, the athlete's
 * marker, or keys kept from an earlier read plus corrections), the plate
 * followed both ways from every key, its size from its outer edge in the
 * still frames, then the lift. The browser pipeline (run.ts) does the same
 * steps while decoding, without holding every frame.
 */
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { autoReadCheck } from "@/lib/lift-analysis/auto-check";
import type { GuideLift } from "@/lib/lift-analysis/exercise";
import type { PlateSize } from "@/lib/lift-analysis/calibrate";
import {
  calibrationTimes,
  keyFromMarker,
  plateAtTap,
  proposePlate,
  supportFor,
  type Proposal,
} from "@/lib/lift-analysis/detect";
import {
  bestSeed,
  type Decoy,
  type FollowPoint,
  type FollowSeed,
} from "@/lib/lift-analysis/follow";
import type { CircleTrack } from "@/lib/lift-analysis/find";
import type { Frame } from "@/lib/lift-analysis/image";
import { KeyedPass, lostStretches, mergePasses, type TrackKey } from "@/lib/lift-analysis/keyed";
import { cameraShift } from "@/lib/lift-analysis/motion";
import { outerRim, rimSize } from "@/lib/lift-analysis/rim-outer";

/** How many frames to look for the plate on: four a second, between 12 and 40. */
export function sampleCount(seconds: number): number {
  return Math.min(40, Math.max(12, Math.ceil(seconds * 4)));
}

/** Evenly spread sample indices over n frames. */
export function sampleIndices(n: number, k: number): number[] {
  if (n <= k) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: k }, (_, i) => Math.round(((i + 0.5) * (n - 1)) / k));
}

/** Where tracking starts from. */
export type Seed =
  /** Detection alone: read only when it's sure (a set video right after it's sent). */
  | { kind: "auto" }
  /** Detection's own proposal, as if the athlete confirmed it (medium or high). */
  | { kind: "proposal" }
  /** A tap on the plate (analysed px). */
  | { kind: "tap"; t: number; x: number; y: number }
  /** The athlete's marker: the plate's centre and edge as they confirmed it (analysed px). */
  | { kind: "marker"; t: number; x: number; y: number; a: number; b: number }
  /** Keys kept from an earlier read (with any corrections added). */
  | { kind: "keys"; keys: TrackKey[] };

export type EngineFailure = "no_plate" | "ambiguous" | "no_plate_at_tap" | "needs_confirm";

export type EngineResult =
  | { ok: true; analysis: LiftAnalysis; proposal: Proposal | null }
  | { ok: false; why: EngineFailure; proposal: Proposal | null };

/** The window around the plate the camera-shake read leaves out (the bar, the plate and the lifter under it). */
export function shakeExclusion(x: number, y: number, r: number) {
  return { x0: x - 1.6 * r, x1: x + 1.6 * r, y0: y - 3 * r, y1: y + 3 * r };
}

/** The frame nearest a time. */
export function frameAt<T extends { t: number }>(frames: T[], t: number): T {
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (frames[m].t <= t) lo = m;
    else hi = m;
  }
  return Math.abs(frames[lo].t - t) <= Math.abs(frames[hi].t - t) ? frames[lo] : frames[hi];
}

/**
 * The keys to follow from, given a seed (pure). A correction is a frame
 * where the athlete put the marker right on the plate: a key of the main
 * key's size, snapped to the edge there when it shows.
 */
export function resolveKeys(
  frames: Frame[],
  samples: Frame[],
  seed: Seed,
  corrections: { t: number; x: number; y: number }[] = [],
): { keys: TrackKey[]; proposal: Proposal | null; why?: EngineFailure } {
  let proposal: Proposal | null = null;
  let keys: TrackKey[] = [];
  if (seed.kind === "auto" || seed.kind === "proposal") {
    proposal = proposePlate(samples);
    if (!proposal.key || proposal.confidence === "low")
      return { keys: [], proposal, why: proposal.why === "ambiguous" ? "ambiguous" : "no_plate" };
    // a medium proposal is read too: kept on its own only when the read proves it (runEngine)
    keys = [proposal.key];
  } else if (seed.kind === "tap") {
    const f = frameAt(frames, seed.t);
    const rim = plateAtTap(f, seed.x, seed.y);
    if (!rim) return { keys: [], proposal: null, why: "no_plate_at_tap" };
    keys = [{ t: f.t, x: rim.x, y: rim.y, a: rim.a, b: rim.b, source: "confirmed" }];
  } else if (seed.kind === "marker") {
    const f = frameAt(frames, seed.t);
    keys = [keyFromMarker(f, seed, "confirmed").key];
  } else {
    keys = [...seed.keys];
  }
  const main = keys[0];
  for (const c of corrections) {
    const f = frameAt(frames, c.t);
    keys.push(keyFromMarker(f, { x: c.x, y: c.y, a: main.a, b: main.b }, "correction").key);
  }
  // one key per frame (a later correction replaces an earlier key on the same frame)
  const byT = new Map<number, TrackKey>();
  for (const k of keys) byT.set(Math.round(k.t * 1000), k);
  return { keys: [...byT.values()].sort((a, b) => a.t - b.t), proposal };
}

export type FollowContext = {
  backbone: CircleTrack | null;
  decoys: Decoy[];
  /** More pictures of the plate from other heights of its travel (the finder's best sightings). */
  views?: FollowSeed["more"];
  /** mm per px from the plate's known size, for the speed limits. */
  mmPerPx: number;
};

/** Follow the plate both ways from the keys through frames in memory (ascending time). */
export function followKeys(frames: Frame[], keys: TrackKey[], ctx: FollowContext) {
  const R = Math.sqrt(keys[0].a * keys[0].b);
  // every key's picture: matched by every follower (the plate looks different at the top and the bottom)
  const views = [
    ...keys.map((k) => {
      const f = frameAt(frames, k.t);
      return { frame: f, x: k.x, y: k.y, r: Math.sqrt(k.a * k.b) };
    }),
    // the finder's other pictures, at least a radius up or down from every key's
    ...(ctx.views ?? []).filter((v) => keys.every((k) => Math.abs(v.y - k.y) >= R)),
  ];
  const setup = {
    backbone: ctx.backbone,
    decoys: ctx.decoys,
    follow: { strict: true, mmPerPx: ctx.mmPerPx },
    views: views.length > 1 ? views : undefined,
  };
  const fwd = new KeyedPass(1, keys, setup);
  for (const f of frames) fwd.push(f);
  const bwd = new KeyedPass(-1, keys, setup);
  for (let i = frames.length - 1; i >= 0; i--) bwd.push(frames[i]);
  return { ...mergePasses(fwd.points(), bwd.points(), R), R };
}

/**
 * The plate's size from its outer edge in the still frames (frames in memory),
 * each with the height it was measured at, so a tilted phone's perspective
 * (the plate bigger at one end of the rep) shows.
 */
export function measureSize(frames: Frame[], points: FollowPoint[], R: number) {
  const rims = calibrationTimes(points, R)
    .map((c) => outerRim(frameAt(frames, c.t), c.x, c.y, R, { lo: 0.75, hi: 1.3 }))
    .filter((r): r is NonNullable<typeof r> => !!r && Math.abs(r.r / R - 1) <= 0.12);
  return rimSize(rims);
}

export function runEngine(
  frames: Frame[],
  opts: {
    seed?: Seed;
    corrections?: { t: number; x: number; y: number }[];
    plate?: PlateSize & { confirmed?: boolean };
    dirHint?: "lower_first" | "lift_first";
    lift?: GuideLift;
  } = {},
): EngineResult {
  const seed = opts.seed ?? { kind: "auto" };
  const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
  const samples = sampleIndices(frames.length, sampleCount(span)).map((i) => frames[i]);
  const resolved = resolveKeys(frames, samples, seed, opts.corrections);
  if (resolved.why) return { ok: false, why: resolved.why, proposal: resolved.proposal };
  const { keys, proposal } = resolved;
  const main = keys[0];
  const support =
    proposal && proposal.key === main
      ? { backbone: proposal.backbone, decoys: proposal.decoys }
      : supportFor(main, samples);
  const views = viewsFor(support.backbone, samples, main);
  const plateMm = opts.plate?.mm ?? 450;
  const mmPerPx = plateMm / (2 * Math.sqrt(main.a * main.b));
  const { points, conflicts, R } = followKeys(frames, keys, { ...support, views, mmPerPx });
  const shake: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const p = points[i];
    if (!p?.found) continue;
    const sh = cameraShift(frames[i - 1], frames[i], shakeExclusion(p.x, p.y, R));
    if (sh.ok) shake.push(Math.hypot(sh.dx, sh.dy));
  }
  const size = measureSize(frames, points, R);
  const analysis = analyzeTrack(points, {
    plate: opts.plate,
    source: keys.some((k) => k.source !== "auto") ? "tap" : "auto",
    seed: { x: main.x, y: main.y, r: Math.sqrt(main.a * main.b), t: main.t },
    frame: { w: frames[0].w, h: frames[0].h },
    dirHint: opts.dirHint,
    shake,
    size,
    keys,
    conflicts,
  });
  if (rimNeverMeasured(analysis, keys[0].source === "auto" ? "auto" : "tap"))
    return { ok: false, why: "no_plate", proposal };
  if (
    seed.kind === "auto" &&
    !autoReadCheck(analysis, opts.lift ?? "other", proposal?.confidence ?? "high").ok
  )
    return { ok: false, why: "needs_confirm", proposal };
  return { ok: true, analysis, proposal };
}

/**
 * Found on its own, followed, and yet its edge measured in too few frames to
 * size it: a round shape that moved with the lift (a head, a knee, the
 * lifter's outline), not a plate. Asked for the athlete instead of read.
 */
/**
 * The finder's best pictures of the plate at other heights (the bottom of a
 * bench looks different from the top): only at the key's size (±8 %).
 */
export function viewsFor(
  backbone: CircleTrack | null,
  samples: Frame[],
  key: TrackKey,
): NonNullable<FollowSeed["more"]> {
  if (!backbone) return [];
  const s = bestSeed(backbone, samples);
  if (!s) return [];
  const R = Math.sqrt(key.a * key.b);
  return [{ frame: s.frame, x: s.x, y: s.y, r: s.r }, ...(s.more ?? [])]
    .filter((v) => Math.abs(v.r / R - 1) <= 0.08)
    .map((v) => ({ ...v, r: R }));
}

export function rimNeverMeasured(a: LiftAnalysis, source: "auto" | "tap"): boolean {
  return source === "auto" && !a.calibration.ok && a.calibration.why === "too_few_frames";
}

export { lostStretches };
