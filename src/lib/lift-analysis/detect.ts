/**
 * Where the plate is, before anything is followed (pure): what the app
 * proposes to the athlete, how sure it is, and the keys tracking starts from.
 *
 *   high    the finder saw one big circle move up and down through the clip
 *           and its outer edge measures cleanly: tracking can start on its
 *           own (and does, right after a set video is sent)
 *   medium  a plate it's fairly sure of (another plate moved too, or the edge
 *           barely shows): shown as the marker for the athlete to confirm or
 *           drag, never read on its own
 *   low     nothing it can stand behind: the athlete taps the plate (the
 *           circles it did see are offered as rings)
 *
 * A key is the plate's centre and outer edge in one frame (keyed.ts). From
 * detection it's the frame where the plate showed best; from the athlete
 * it's their marker, snapped to the plate's real edge when the edge is
 * there to snap to (rim-outer.ts) and kept as they placed it when it isn't.
 */
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
  type Sighting,
} from "@/lib/lift-analysis/find";
import { bestSeed, type Decoy } from "@/lib/lift-analysis/follow";
import { gradients, type Frame } from "@/lib/lift-analysis/image";
import type { KeySource, TrackKey } from "@/lib/lift-analysis/keyed";
import { measureRim } from "@/lib/lift-analysis/rim";
import { outerRim, type OuterRim } from "@/lib/lift-analysis/rim-outer";

export type Confidence = "high" | "medium" | "low";

/** A circle worth offering for a tap (analysed px). */
export type Candidate = { t: number; x: number; y: number; r: number };

export type Proposal = {
  confidence: Confidence;
  /** The preselected marker (medium / high). */
  key: TrackKey | null;
  /** Other circles that moved, best first: the ring when there's no key, and where a tap snaps. */
  candidates: Candidate[];
  why: PlateFind["why"] | "edge_unclear";
  find: PlateFind | null;
  /** The plate's own path through the sampled frames (the tracker's backbone) and plates that never moved. */
  backbone: CircleTrack | null;
  decoys: Decoy[];
  /** How clearly the outer edge showed at the key (0…1 of the way round). */
  edgeShare: number | null;
};

/** How far out the plate's outer edge is looked for, from a first guess at its size. */
export const OUTER_SEARCH = { lo: 0.5, hi: 1.8 };

/** The finder's sightings of a circle (analysed px), for the tracker's backbone. */
/**
 * The plates that never moved, for the tracker to ignore: never one on the
 * bar's own path (the plate itself resting on the chest in a paused bench, or
 * its inner ring, read as a still circle there would make the tracker refuse
 * the plate at the bottom of every rep).
 */
export function toDecoys(still: CircleTrack[], plate: CircleTrack | null): Decoy[] {
  return still
    .filter((t) => t !== plate && (!plate || seenApartTogether(t, plate) >= 3))
    .map((t) => {
      const h = t.hits[t.hits.length >> 1];
      return { x: h.x, y: h.y, r: t.r };
    })
    .filter(
      (d) => !plate || !plate.hits.some((h) => Math.hypot(h.x - d.x, h.y - d.y) <= 0.6 * plate.r),
    );
}

const keyOf = (
  t: number,
  rim: { x: number; y: number; a: number; b: number },
  source: KeySource,
): TrackKey => ({ t, x: rim.x, y: rim.y, a: rim.a, b: rim.b, source });

/** The circles seen, best first, each once (the finder's best is also first among its others). */
const candidatesOf = (tracks: CircleTrack[], skip: CircleTrack | null): Candidate[] =>
  [...new Set(tracks)]
    .filter((t) => t !== skip)
    .slice(0, 4)
    .map((c) => {
      const h = c.hits[Math.floor(c.hits.length / 2)];
      return { t: h.t, x: h.x, y: h.y, r: c.r };
    });

/** What to show the athlete, from the sampled frames. */
export function proposePlate(samples: Frame[], seen?: Sighting[][]): Proposal {
  const find = findPlate(samples, seen);
  const decoys = toDecoys(find.still ?? [], find.track);
  const others = find.others ?? [];
  if (!find.track) {
    return {
      confidence: "low",
      key: null,
      candidates: candidatesOf(others, null),
      why: find.why,
      find,
      backbone: null,
      decoys,
      edgeShare: null,
    };
  }
  const seed = bestSeed(find.track, samples);
  if (!seed) {
    return {
      confidence: "low",
      key: null,
      candidates: candidatesOf([find.track, ...others], null),
      why: "too_few_sightings",
      find,
      backbone: null,
      decoys,
      edgeShare: null,
    };
  }
  // the plate's size is its outer edge, never an inner plate's or the lip's
  const outer = outerRim(seed.frame, seed.x, seed.y, seed.r, OUTER_SEARCH);
  const usable = !!outer && Math.hypot(outer.x - seed.x, outer.y - seed.y) <= 0.35 * outer.r;
  const key = keyOf(
    seed.frame.t,
    usable ? outer! : { x: seed.x, y: seed.y, a: seed.a, b: seed.b },
    "auto",
  );
  const clearEdge = usable && outer!.share >= 0.5 && outer!.contrast >= 10;
  const confidence: Confidence = find.confident && clearEdge ? "high" : "medium";
  return {
    confidence,
    key,
    candidates: candidatesOf(others, find.track),
    why: find.confident ? (clearEdge ? "found" : "edge_unclear") : find.why,
    find,
    backbone: find.track,
    decoys,
    edgeShare: usable ? outer!.share : null,
  };
}

/**
 * The plate under a tap (anywhere on its face, not only the end of the bar):
 * every circle round the tap and the rim the rays from the tap agree on, the
 * one whose rim shows most completely, then its outer edge. Null when there's
 * no plate there.
 */
export function plateAtTap(f: Frame, x: number, y: number): OuterRim | null {
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
      if (Math.hypot(fit.x - x, fit.y - y) > 0.9 * fit.r) continue;
      if (!best || fit.coverage > best.coverage) best = fit;
    }
  }
  if (!best) return null;
  const outer = outerRim(f, best.x, best.y, best.r, OUTER_SEARCH);
  if (outer && Math.hypot(outer.x - x, outer.y - y) <= 0.95 * outer.r) return outer;
  return {
    x: best.x,
    y: best.y,
    a: best.a,
    b: best.b,
    r: best.r,
    share: best.coverage,
    contrast: best.strength,
    rms: best.rms,
    inner: [],
  };
}

/**
 * The athlete's marker as a key: snapped to the plate's real outer edge when
 * one shows near it (within a quarter of its size, the same size within
 * 12 %), else exactly as they placed it (`manual`: the edge couldn't be
 * measured, so the size is known only as well as a finger places it).
 */
export function keyFromMarker(
  f: Frame,
  m: { x: number; y: number; a: number; b: number },
  source: KeySource,
): { key: TrackKey; snapped: boolean; rim: OuterRim | null } {
  const r0 = Math.sqrt(m.a * m.b);
  // sizes compared by the longer axis: the ring is a circle, the plate off side-on an ellipse that
  // keeps its full size one way (a turned plate is as tall as the ring and narrower)
  const major = (a: number, b: number) => Math.max(a, b);
  const m0 = major(m.a, m.b);
  const rim = outerRim(f, m.x, m.y, r0, { lo: 0.78, hi: 1.25 });
  const snapped =
    !!rim &&
    rim.share >= 0.35 &&
    Math.hypot(rim.x - m.x, rim.y - m.y) <= 0.25 * r0 &&
    (Math.abs(rim.r / r0 - 1) <= 0.12 || Math.abs(major(rim.a, rim.b) / m0 - 1) <= 0.12);
  if (snapped) return { key: keyOf(f.t, rim!, source), snapped, rim };
  // no outer edge to snap to: still learn the plate's shape at the ring (its rim as an ellipse), so
  // the tracker expects the plate it sees, not the ring's circle
  const shape = shapeAtMarker(f, m);
  return { key: keyOf(f.t, shape ?? m, source), snapped: false, rim: null };
}

/**
 * The plate's rim at the athlete's ring, fitted as an ellipse: its centre
 * within a quarter of the ring and its longer axis within 15 % of the
 * ring's. Null when too little of it shows to say (the ring is kept as it is).
 */
export function shapeAtMarker(
  f: Frame,
  m: { x: number; y: number; a: number; b: number },
): { x: number; y: number; a: number; b: number } | null {
  const r0 = Math.sqrt(m.a * m.b);
  const m0 = Math.max(m.a, m.b);
  const pad = Math.ceil(m0 * 1.6) + 3;
  const g = gradients(f, m.x - pad, m.y - pad, m.x + pad, m.y + pad);
  let best: ReturnType<typeof fitRim> = null;
  // the ring as placed, and narrower one way or the other (a turned or a tilted plate)
  for (const [ka, kb] of [
    [1, 1],
    [0.8, 1],
    [0.6, 1],
    [0.45, 1],
    [1, 0.8],
    [1, 0.6],
  ]) {
    const fit = fitRim(
      g,
      { x: m.x, y: m.y, r: Math.sqrt(m.a * ka * m.b * kb) },
      { rTol: 0.35, ellipse: true, axes: { a: m.a * ka, b: m.b * kb }, edgeMin: 12 },
    );
    if (
      !fit ||
      fit.rms > 1.5 ||
      fit.coverage < 0.45 ||
      Math.hypot(fit.x - m.x, fit.y - m.y) > 0.25 * r0 ||
      Math.abs(Math.max(fit.a, fit.b) / m0 - 1) > 0.15
    )
      continue;
    if (!best || fit.coverage > best.coverage) best = fit;
  }
  return best ? { x: best.x, y: best.y, a: best.a, b: best.b } : null;
}

/**
 * The tracker's helpers for a key the athlete gave: the finder's own track of
 * that plate through the samples (when it saw it), and the plates that never
 * moved (never the bar's).
 */
export function supportFor(
  key: TrackKey,
  samples: Frame[],
  seen?: Sighting[][],
): { backbone: CircleTrack | null; decoys: Decoy[] } {
  if (!samples.length) return { backbone: null, decoys: [] };
  const tracks = linkTracks(seen ?? sightings(samples), samples.length);
  const R = Math.sqrt(key.a * key.b);
  const near = tracks
    .filter((tr) => Math.abs(tr.r - R) <= 0.15 * R)
    .map((tr) => {
      const h = tr.hits.reduce((b, p) => (Math.abs(p.t - key.t) < Math.abs(b.t - key.t) ? p : b));
      const dt = Math.abs(h.t - key.t);
      return { tr, ok: dt <= 0.5 && Math.hypot(h.x - key.x, h.y - key.y) <= R * (0.4 + 6 * dt) };
    })
    .filter((v) => v.ok)
    .sort((a, b) => b.tr.hits.length - a.tr.hits.length);
  const own = near[0]?.tr ?? null;
  return { backbone: own, decoys: toDecoys(stillCircles(tracks, samples.length), own) };
}

/**
 * The still frames to measure the plate's size in: where the bar is barely
 * moving (no blur on the edge), spread through the clip, at most `n`.
 */
export function calibrationTimes(
  pts: { t: number; x: number; y: number; found: boolean }[],
  r: number,
  n = 14,
): { t: number; x: number; y: number }[] {
  const still: { t: number; x: number; y: number; v: number }[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const p = pts[i];
    const b = pts[i + 1];
    if (!a.found || !p.found || !b.found) continue;
    const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1e-3, b.t - a.t);
    // under ~0.4 radii a second (about 90 mm/s): the rim is sharp
    if (v <= 0.4 * r) still.push({ t: p.t, x: p.x, y: p.y, v });
  }
  if (!still.length) return [];
  // spread out: split the still frames into n even groups by time, the stillest of each
  const out: { t: number; x: number; y: number }[] = [];
  const groups = Math.min(n, still.length);
  for (let g = 0; g < groups; g++) {
    const part = still.slice(
      Math.floor((g * still.length) / groups),
      Math.floor(((g + 1) * still.length) / groups),
    );
    if (!part.length) continue;
    const s = part.reduce((b, q) => (q.v < b.v ? q : b));
    out.push({ t: s.t, x: s.x, y: s.y });
  }
  return out;
}
