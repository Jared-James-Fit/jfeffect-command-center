/**
 * Which circle is the bar (pure): a handful of frames spread over the lift,
 * every circle in each, and the one that keeps turning up at the same size
 * while moving up and down. Plates on a tree are the same size and round
 * too, but they never move; the lifter's head moves with a squat but isn't
 * a clean circle the way a plate's rim is. A plate's hub and lip are circles
 * inside it: they count for it (a plate has rings) and are never picked.
 *
 * Confident only when the answer is clear (seen in most frames, moving, and
 * well ahead of anything else); otherwise the candidates go to the person to
 * pick with one tap.
 */
import {
  circleOfRadius,
  frameGradients,
  houghCircles,
  ringScore,
  type RimFit,
} from "@/lib/lift-analysis/circle";
import type { Frame } from "@/lib/lift-analysis/image";

/** A ring all round (this share of angles agreeing) marks a plate. */
const RING_SHARE = 0.45;

export type PlateHit = {
  t: number;
  x: number;
  y: number;
  r: number;
  a: number;
  b: number;
  coverage: number;
};
export type PlateCandidate = {
  r: number;
  /** Horizontal ÷ vertical axis (1 = side-on). */
  q: number;
  /** Share of its sightings with a ring inside (a hub, a lip): the mark of a plate. */
  rings: number;
  hits: PlateHit[];
  /** Share of the frames it was seen in. */
  seen: number;
  /** How far it moved up and down, in plate radii. */
  travel: number;
  meanCoverage: number;
  score: number;
};
export type PlateDetection = {
  best: PlateCandidate | null;
  /** True when the best is clear enough to analyse without asking. */
  confident: boolean;
  candidates: PlateCandidate[];
  why: "found" | "no_circles" | "not_moving" | "ambiguous" | "not_plate_like" | "too_few_frames";
};

/** Radius range to look for, from the frame's size: a plate seen from a phone propped a few metres away. */
export function plateRadiusRange(w: number, h: number): { rMin: number; rMax: number } {
  const short = Math.min(w, h);
  return { rMin: Math.max(9, short * 0.035), rMax: short * 0.48 };
}

/** Drop circles inside a bigger one with the same centre (a plate's hub, lip and sleeve), crediting the outer one. */
export function outerRings(circles: RimFit[]): (RimFit & { rings: number })[] {
  const sorted = [...circles].sort((a, b) => b.r - a.r);
  const out: (RimFit & { rings: number })[] = [];
  for (const c of sorted) {
    const outer = out.find(
      (o) => Math.hypot(o.x - c.x, o.y - c.y) < 0.18 * o.r && c.r < 0.92 * o.r,
    );
    if (outer) {
      outer.rings++;
      continue;
    }
    out.push({ ...c, rings: 0 });
  }
  return out;
}

/** Whether two candidates' heights move together (the same up-and-down, sample by sample). */
function movesWith(a: PlateCandidate, b: PlateCandidate): boolean {
  const pairs: [number, number][] = [];
  for (const h of a.hits) {
    const k = b.hits.find((x) => x.t === h.t);
    if (k) pairs.push([h.y, k.y]);
  }
  if (pairs.length < 4) return false;
  const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (const [x, y] of pairs) {
    sab += (x - ma) * (y - mb);
    saa += (x - ma) ** 2;
    sbb += (y - mb) ** 2;
  }
  return saa > 0 && sbb > 0 && sab / Math.sqrt(saa * sbb) > 0.9;
}

/** Find the bar's plate across sample frames (in time order). */
export function detectPlate(
  frames: Frame[],
  opts: { rMin?: number; rMax?: number } = {},
): PlateDetection {
  if (frames.length < 3)
    return { best: null, confident: false, candidates: [], why: "too_few_frames" };
  const range = plateRadiusRange(frames[0].w, frames[0].h);
  const rMin = opts.rMin ?? range.rMin;
  const rMax = opts.rMax ?? range.rMax;
  const perFrame = frames.map((f) => {
    const g = frameGradients(f);
    return outerRings(houghCircles(f, { rMin, rMax, max: 10 }, g))
      .slice(0, 6)
      .map((c) => ({
        ...c,
        rings:
          c.rings + (ringScore(g, c, Math.max(18, 0.25 * c.strength)).share >= RING_SHARE ? 1 : 0),
      }));
  });
  const all = perFrame.flatMap((cs, fi) => cs.map((c) => ({ ...c, fi })));
  if (!all.length) return { best: null, confident: false, candidates: [], why: "no_circles" };
  // every circle starts a candidate; each frame lends it its closest match in size and place
  const seeds = [...all].sort(
    (a, b) => b.coverage * (1 + 0.1 * b.rings) - a.coverage * (1 + 0.1 * a.rings),
  );
  const candidates: PlateCandidate[] = [];
  const used = new Set<string>();
  for (const s of seeds) {
    if (used.has(`${s.fi}:${s.x}:${s.y}`)) continue;
    const hits: (PlateHit & { rings: number })[] = [];
    let refX = s.x;
    for (let fi = 0; fi < frames.length; fi++) {
      let best: (typeof perFrame)[number][number] | null = null;
      for (const c of perFrame[fi]) {
        if (Math.abs(c.r - s.r) > 0.12 * s.r) continue;
        // the bar moves mostly up and down: a little sideways (a walkout, a J-curve), never across the room
        if (Math.abs(c.x - refX) > 1.6 * s.r) continue;
        if (!best || c.coverage > best.coverage) best = c;
      }
      if (best) {
        hits.push({
          t: frames[fi].t,
          x: best.x,
          y: best.y,
          r: best.r,
          a: best.a,
          b: best.b,
          coverage: best.coverage,
          rings: best.rings,
        });
        used.add(`${fi}:${best.x}:${best.y}`);
        refX = hits.reduce((sum, h) => sum + h.x, 0) / hits.length;
      }
    }
    if (hits.length < 2) continue;
    const ys = hits.map((h) => h.y);
    const travel = (Math.max(...ys) - Math.min(...ys)) / s.r;
    const seen = hits.length / frames.length;
    const meanCoverage = hits.reduce((sum, h) => sum + h.coverage, 0) / hits.length;
    const rings = hits.reduce((sum, h) => sum + h.rings, 0) / hits.length;
    const motion = travel >= 0.8 ? 1.5 : travel >= 0.3 ? 1 : 0.45;
    const score = seen * meanCoverage * motion * (1 + 0.12 * Math.min(2, rings));
    const r = hits.map((h) => h.r).sort((a, b) => a - b)[hits.length >> 1];
    const q = hits.map((h) => h.a / h.b).sort((a, b) => a - b)[hits.length >> 1];
    const ringShare = hits.filter((h) => h.rings > 0).length / hits.length;
    candidates.push({
      r,
      q,
      rings: ringShare,
      hits: hits.map(({ rings: _rings, ...h }) => h),
      seen,
      travel,
      meanCoverage,
      score,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  // the same plate found from two seeds: keep the better
  const distinct: PlateCandidate[] = [];
  for (const c of candidates) {
    const dup = distinct.some(
      (d) =>
        Math.abs(d.r - c.r) < 0.12 * d.r &&
        c.hits.some((h) =>
          d.hits.some((k) => k.t === h.t && Math.hypot(k.x - h.x, k.y - h.y) < 0.3 * d.r),
        ),
    );
    if (!dup) distinct.push(c);
  }
  // two circles moving together: the bigger is the plate (the lifter's head, a collar, the
  // sleeve's end all move with the bar, and a plate is the largest round thing there)
  const kept = distinct.filter(
    (c) => !distinct.some((o) => o !== c && o.r >= 1.4 * c.r && o.travel >= 0.3 && movesWith(c, o)),
  );
  const best = kept[0] ?? null;
  if (!best) return { best: null, confident: false, candidates: [], why: "no_circles" };
  const second = kept[1];
  const clear = !second || best.score >= 1.35 * second.score;
  const moving = best.travel >= 0.5;
  // a plate has rings (its hub, its lip); a round thing without any is the person's to confirm
  const plateLike = best.rings >= 0.3;
  const confident = best.seen >= 0.5 && best.meanCoverage >= 0.55 && moving && clear && plateLike;
  return {
    best,
    confident,
    candidates: kept.slice(0, 5),
    why: confident ? "found" : !moving ? "not_moving" : !plateLike ? "not_plate_like" : "ambiguous",
  };
}

/**
 * The plate under a tap (x, y in frame pixels): the circle around that point
 * with the most rim showing, from the biggest plausible size down. Null when
 * nothing round is there.
 */
export function plateAtTap(
  frame: Frame,
  tap: { x: number; y: number },
  opts: { rMin?: number; rMax?: number } = {},
): RimFit | null {
  const range = plateRadiusRange(frame.w, frame.h);
  const rMin = opts.rMin ?? range.rMin;
  const rMax = opts.rMax ?? range.rMax;
  const region = {
    x0: Math.max(0, Math.floor(tap.x - rMax * 1.1)),
    y0: Math.max(0, Math.floor(tap.y - rMax * 1.1)),
    x1: Math.min(frame.w - 1, Math.ceil(tap.x + rMax * 1.1)),
    y1: Math.min(frame.h - 1, Math.ceil(tap.y + rMax * 1.1)),
  };
  const circles = outerRings(
    houghCircles(frame, { rMin, rMax, region, max: 12, minCoverage: 0.4 }),
  );
  // the tap is somewhere on the plate: inside the circle (a little slack for a tap on the rim)
  const under = circles.filter((c) => Math.hypot(c.x - tap.x, c.y - tap.y) <= c.r * 1.08);
  if (!under.length) return null;
  under.sort(
    (a, b) => b.coverage * (1 + 0.1 * b.rings) - a.coverage * (1 + 0.1 * a.rings) || b.r - a.r,
  );
  return under[0];
}

/**
 * Where a plate of a known size is in each of some frames (anchors for the
 * tracker: where to look again after the plate was hidden), searching a band
 * around the column it was found in.
 */
export function anchorsFor(frames: Frame[], plate: { x: number; r: number }): PlateHit[] {
  const out: PlateHit[] = [];
  for (const f of frames) {
    const fit = circleOfRadius(
      f,
      plate.r,
      {
        x0: Math.floor(plate.x - 1.6 * plate.r),
        x1: Math.ceil(plate.x + 1.6 * plate.r),
        y0: 0,
        y1: f.h - 1,
      },
      { minCoverage: 0.45 },
    );
    if (fit)
      out.push({
        t: f.t,
        x: fit.x,
        y: fit.y,
        r: fit.r,
        a: fit.a,
        b: fit.b,
        coverage: fit.coverage,
      });
  }
  return out;
}
