/**
 * Finding the plate on its own (pure). A lifting video's plate is the big
 * circle that moves up and down with the lift; everything else that looks
 * round either stays put (plates on a tree, a clock, the ceiling lights) or
 * is smaller and moves with it (the lifter's head, the plate's own hub).
 *
 *   1. circles in each of a few dozen frames spread over the clip
 *      (`circleCandidates`: a gradient Hough whose vote window grows with
 *      the radius, so a big plate's votes, spread by the gradient's angle
 *      noise, still add up; every peak measured by its rim)
 *   2. the same circle linked from frame to frame (`linkTracks`: the same
 *      size, a plausible move)
 *   3. the plate's track chosen (`pickPlate`): seen in many frames, moving
 *      up and down, the biggest such circle; ambiguous when two different
 *      moving circles of a plate's size don't move together
 *
 * The chosen track is also the tracker's backbone: where the plate is at
 * any moment, roughly, so the tracker can never wander onto something else.
 */
import { fitRim, frameGradients, type RimFit } from "@/lib/lift-analysis/circle";
import { median, percentile, type Frame, type Gray } from "@/lib/lift-analysis/image";
import { makeTemplate, spunTemplate } from "@/lib/lift-analysis/template";

/** Radii a plate can have in a frame: a few percent of the short side up to most of it. */
export function radiusRange(w: number, h: number): { rMin: number; rMax: number } {
  const short = Math.min(w, h);
  return { rMin: Math.max(5, short * 0.035), rMax: short * 0.48 };
}

/** The frame at half size (2 × 2 averages): detection doesn't need the detail and runs 4× faster. */
export function halfSize(img: Gray): Gray {
  const w = img.w >> 1;
  const h = img.h >> 1;
  const px = new Uint8Array(w * h);
  const s = img.px;
  const W = img.w;
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * W;
    const r1 = r0 + W;
    for (let x = 0; x < w; x++) {
      const c = 2 * x;
      px[y * w + x] = (s[r0 + c] + s[r0 + c + 1] + s[r1 + c] + s[r1 + c + 1] + 2) >> 2;
    }
  }
  return { w, h, px };
}

const TWO_PI = Math.PI * 2;

/** Box sum of half-width k over a w × h grid (separable, O(n) whatever k). */
function boxSum(
  src: Float32Array,
  w: number,
  h: number,
  k: number,
  tmp: Float32Array,
  out: Float32Array,
) {
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = 0; x <= Math.min(k, w - 1); x++) s += src[o + x];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s;
      const add = x + k + 1;
      const sub = x - k;
      if (add < w) s += src[o + add];
      if (sub >= 0) s -= src[o + sub];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(k, h - 1); y++) s += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s;
      const add = y + k + 1;
      const sub = y - k;
      if (add < h) s += tmp[add * w + x];
      if (sub >= 0) s -= tmp[sub * w + x];
    }
  }
}

export type CandidateOptions = {
  rMin: number;
  rMax: number;
  /** At most this many circles (best first). */
  max?: number;
  /** A rim showing less of its way round than this isn't a circle we can use. */
  minCoverage?: number;
};

/**
 * Every plausible circle in a frame, the best first. Edge pixels (thinned to
 * the ridge of the edge) vote along their gradient, both ways, for a centre
 * at each radius; the votes are summed over a window that grows with the
 * radius (a few degrees of gradient noise moves a vote r·θ away) and a
 * centre needs votes from a fifth of its circumference. Each peak is then
 * measured by its rim (`fitRim`), which is what the result reports.
 */
export function circleCandidates(img: Gray, o: CandidateOptions): RimFit[] {
  const g = frameGradients(img);
  const { w, h, gx, gy, mag } = g;
  if (w < 16 || h < 16) return [];
  const thr = Math.max(14, percentile(mag, 0.78));
  const ex: number[] = [];
  const ey: number[] = [];
  const ux: number[] = [];
  const uy: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < thr) continue;
      const ax = Math.abs(gx[i]);
      const ay = Math.abs(gy[i]);
      let n1: number, n2: number;
      if (ax > 2.414 * ay) {
        n1 = mag[i - 1];
        n2 = mag[i + 1];
      } else if (ay > 2.414 * ax) {
        n1 = mag[i - w];
        n2 = mag[i + w];
      } else if (gx[i] * gy[i] > 0) {
        n1 = mag[i - w - 1];
        n2 = mag[i + w + 1];
      } else {
        n1 = mag[i - w + 1];
        n2 = mag[i + w - 1];
      }
      if (m < n1 || m < n2) continue;
      ex.push(x);
      ey.push(y);
      ux.push(gx[i] / m);
      uy.push(gy[i] / m);
    }
  }
  if (ex.length < 16) return [];
  const n = w * h;
  const acc = new Float32Array(n);
  const tmp = new Float32Array(n);
  const sm = new Float32Array(n);
  type Peak = { x: number; y: number; r: number; support: number };
  const peaks: Peak[] = [];
  for (let r = o.rMin; r <= o.rMax * 1.0001; r *= 1.07) {
    acc.fill(0);
    for (let e = 0; e < ex.length; e++) {
      const dx = r * ux[e];
      const dy = r * uy[e];
      let cx = Math.round(ex[e] - dx);
      let cy = Math.round(ey[e] - dy);
      if (cx >= 0 && cy >= 0 && cx < w && cy < h) acc[cy * w + cx] += 1;
      cx = Math.round(ex[e] + dx);
      cy = Math.round(ey[e] + dy);
      if (cx >= 0 && cy >= 0 && cx < w && cy < h) acc[cy * w + cx] += 1;
    }
    const k = Math.max(1, Math.round(0.07 * r));
    boxSum(acc, w, h, k, tmp, sm);
    const need = 0.2 * TWO_PI * r;
    const here: Peak[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = sm[i];
        if (v < need) continue;
        if (
          v < sm[i - 1] ||
          v < sm[i + 1] ||
          v < sm[i - w] ||
          v < sm[i + w] ||
          v < sm[i - w - 1] ||
          v < sm[i + w + 1] ||
          v < sm[i - w + 1] ||
          v < sm[i + w - 1]
        )
          continue;
        here.push({ x, y, r, support: v / (TWO_PI * r) });
      }
    }
    here.sort((a, b) => b.support - a.support);
    peaks.push(...here.slice(0, 5));
  }
  peaks.sort((a, b) => b.support - a.support);
  const fits: RimFit[] = [];
  const minCoverage = o.minCoverage ?? 0.33;
  const edgeMin = Math.max(12, thr * 0.4);
  const tried: Peak[] = [];
  for (const p of peaks) {
    if (tried.length >= 36) break;
    if (
      tried.some(
        (t) => Math.hypot(t.x - p.x, t.y - p.y) < 0.25 * t.r && Math.abs(t.r - p.r) < 0.2 * t.r,
      )
    )
      continue;
    tried.push(p);
    const fit = fitRim(g, p, { edgeMin, rTol: 0.25, ellipse: true });
    if (!fit || fit.coverage < minCoverage) continue;
    if (fit.r < o.rMin * 0.85 || fit.r > o.rMax * 1.1) continue;
    const same = fits.findIndex(
      (f) => Math.hypot(f.x - fit.x, f.y - fit.y) < 0.2 * f.r && Math.abs(f.r - fit.r) < 0.12 * f.r,
    );
    if (same >= 0) {
      if (fit.coverage > fits[same].coverage) fits[same] = fit;
      continue;
    }
    fits.push(fit);
  }
  // concentric circles: a plate's hub, lip and the smaller plates on it count for the outer one
  fits.sort((a, b) => b.r - a.r);
  const out: RimFit[] = [];
  for (const f of fits) {
    if (out.some((o2) => Math.hypot(o2.x - f.x, o2.y - f.y) < 0.25 * o2.r && f.r < 0.9 * o2.r))
      continue;
    out.push(f);
  }
  out.sort((a, b) => b.coverage * Math.sqrt(b.r) - a.coverage * Math.sqrt(a.r));
  return out.slice(0, o.max ?? 8);
}

export type Sighting = RimFit & { t: number; fi: number };
export type CircleTrack = {
  hits: Sighting[];
  /** Median radius (px). */
  r: number;
  /** Share of the sampled frames it was seen in. */
  seen: number;
  /** Its vertical / horizontal travel (10th–90th percentile), in radii. */
  travelY: number;
  travelX: number;
  /** Median rim coverage. */
  coverage: number;
};

/** The same circle linked across sampled frames: about the same size, a move the bar could make. */
export function linkTracks(perFrame: Sighting[][], nFrames: number): CircleTrack[] {
  type Open = { hits: Sighting[]; rs: number[] };
  const tracks: Open[] = [];
  for (const cands of perFrame) {
    // every sighting against every open track, the closest pairs first (relative to how far it
    // could have gone): a spare plate on the tree never takes the bar plate's track, or the
    // other way round, just because one of them was missed a frame
    const pairs: { c: Sighting; tr: Open; cost: number }[] = [];
    for (const c of cands) {
      for (const tr of tracks) {
        const last = tr.hits[tr.hits.length - 1];
        if (c.fi - last.fi > 4 || c.fi === last.fi) continue;
        const rr = median(tr.rs);
        if (Math.abs(c.r - rr) > 0.18 * rr) continue;
        const dt = Math.max(0.01, c.t - last.t);
        // a bar moves at most ~2.5 m/s, ~11 plate radii a second, and never further from where it
        // was than a deep squat's whole range (~0.75 m, under 4.5 radii) however long it was unseen
        const reach = rr * Math.min(4.5, 0.6 + 11 * dt);
        const d = Math.hypot(c.x - last.x, c.y - last.y);
        if (d > reach) continue;
        // the same plate: as near as it could be, its rim showing, its size the track's own
        // (an arc of the lifter's body beside it is close by, but a part-circle a size off)
        pairs.push({
          c,
          tr,
          cost: d / reach + 0.5 * (1 - c.coverage) + 2 * (Math.abs(c.r - rr) / rr),
        });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const usedTr = new Set<Open>();
    const usedC = new Set<Sighting>();
    for (const { c, tr } of pairs) {
      if (usedTr.has(tr) || usedC.has(c)) continue;
      tr.hits.push(c);
      tr.rs.push(c.r);
      usedTr.add(tr);
      usedC.add(c);
    }
    for (const c of [...cands].sort((a, b) => b.coverage - a.coverage)) {
      if (usedC.has(c)) continue;
      tracks.push({ hits: [c], rs: [c.r] });
    }
  }
  // a track broken by a fast move or a few frames unseen: put the pieces back together
  const pieces = tracks.map((tr) => ({ hits: [...tr.hits], rs: [...tr.rs] }));
  pieces.sort((a, b) => b.hits.length - a.hits.length);
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const A = pieces[i];
      const B = pieces[j];
      if (!A.hits.length || !B.hits.length) continue;
      const ra = median(A.rs);
      if (Math.abs(median(B.rs) - ra) > 0.15 * ra) continue;
      const fa = new Set(A.hits.map((p) => p.fi));
      if (B.hits.some((p) => fa.has(p.fi))) continue;
      // every piece of B must sit where A could have gone in between
      const all = [
        ...A.hits.map((p) => ({ p, a: true })),
        ...B.hits.map((p) => ({ p, a: false })),
      ].sort((u, v) => u.p.t - v.p.t);
      let ok = true;
      for (let k = 1; k < all.length && ok; k++) {
        if (all[k].a === all[k - 1].a) continue;
        const dt = Math.max(0.01, all[k].p.t - all[k - 1].p.t);
        // a short gap only: over a long one anything could join anything
        if (dt > 0.8) ok = false;
        else if (
          Math.hypot(all[k].p.x - all[k - 1].p.x, all[k].p.y - all[k - 1].p.y) >
          ra * Math.min(4.5, 0.6 + 6 * dt)
        )
          ok = false;
      }
      if (!ok) continue;
      A.hits = all.map((u) => u.p);
      A.rs.push(...B.rs);
      B.hits = [];
      B.rs = [];
    }
  }
  return pieces
    .filter((tr) => tr.hits.length)
    .map((tr) => {
      const ys = tr.hits.map((p) => p.y);
      const xs = tr.hits.map((p) => p.x);
      const r = median(tr.rs);
      const spread = (v: number[]) => (v.length > 1 ? percentile(v, 0.9) - percentile(v, 0.1) : 0);
      return {
        hits: tr.hits,
        r,
        seen: new Set(tr.hits.map((p) => p.fi)).size / Math.max(1, nFrames),
        travelY: spread(ys) / r,
        travelX: spread(xs) / r,
        coverage: median(tr.hits.map((p) => p.coverage)),
      };
    });
}

/** Frames where both tracks were seen, apart (a plate's own hub or a co-moving head sits inside or right by it). */
export function seenApartTogether(a: CircleTrack, b: CircleTrack): number {
  const by = new Map(b.hits.map((p) => [p.fi, p]));
  let n = 0;
  for (const p of a.hits) {
    const q = by.get(p.fi);
    if (q && Math.hypot(p.x - q.x, p.y - q.y) > Math.max(p.r, q.r)) n++;
  }
  return n;
}

/** Of the frames both were seen in, the share where they overlap without sharing a centre. */
function overlapShare(a: CircleTrack, b: CircleTrack): number {
  const by = new Map(b.hits.map((p) => [p.fi, p]));
  let n = 0;
  let k = 0;
  for (const p of a.hits) {
    const q = by.get(p.fi);
    if (!q) continue;
    n++;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < p.r + q.r && d > 0.3 * Math.min(p.r, q.r)) k++;
  }
  return n >= 3 ? k / n : 0;
}

/** How much two tracks move together (correlation of their heights over the frames both were seen in). */
function together(a: CircleTrack, b: CircleTrack): number {
  const by = new Map(b.hits.map((p) => [p.fi, p.y]));
  const pa: number[] = [];
  const pb: number[] = [];
  for (const p of a.hits) {
    const y = by.get(p.fi);
    if (y != null) {
      pa.push(p.y);
      pb.push(y);
    }
  }
  if (pa.length < 4) return 0;
  const ma = pa.reduce((s, v) => s + v, 0) / pa.length;
  const mb = pb.reduce((s, v) => s + v, 0) / pb.length;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < pa.length; i++) {
    sab += (pa[i] - ma) * (pb[i] - mb);
    saa += (pa[i] - ma) ** 2;
    sbb += (pb[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/** A plate's track moves this far up and down at least (radii): even a bench press is more than a radius. */
export const MIN_TRAVEL = 0.5;

export type PlateFind = {
  track: CircleTrack | null;
  confident: boolean;
  why: "found" | "no_circles" | "not_moving" | "ambiguous" | "too_few_sightings";
  /** Moving circles worth offering for a tap when it isn't clear. */
  others: CircleTrack[];
  /** Circles that never moved (a spare plate on the tree, the rack's hooks): never the bar plate. */
  still?: CircleTrack[];
};

function score(t: CircleTrack): number {
  return t.r * Math.min(1, t.seen / 0.6) * Math.min(1, t.coverage / 0.6);
}

/**
 * How round the picture inside a circle is about its centre (0…1): the disc
 * against itself spun all the way round (template.ts). A plate's face (rim,
 * hub, rings) is close to it; a "circle" drawn through the lifter's body and
 * the plate's edge isn't. The median over a few sightings.
 */
export function roundness(t: CircleTrack, samples: Frame[]): number {
  const byT = new Map(samples.map((f) => [f.t, f]));
  const step = Math.max(1, Math.floor(t.hits.length / 8));
  const vals: number[] = [];
  for (let i = 0; i < t.hits.length; i += step) {
    const h = t.hits[i];
    const f = byT.get(h.t);
    if (!f) continue;
    const tpl = makeTemplate(f, h.x, h.y, h.r * 0.95);
    if (!tpl) continue;
    const spun = spunTemplate(tpl);
    let ma = 0,
      mb = 0;
    for (let k = 0; k < tpl.n; k++) {
      ma += tpl.val[k];
      mb += spun.val[k];
    }
    ma /= tpl.n;
    mb /= tpl.n;
    let ab = 0,
      aa = 0,
      bb = 0;
    for (let k = 0; k < tpl.n; k++) {
      const u = tpl.val[k] - ma;
      const v = spun.val[k] - mb;
      ab += u * v;
      aa += u * u;
      bb += v * v;
    }
    vals.push(aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0);
  }
  return vals.length ? median(vals) : 0;
}

/**
 * The rule for a "circle" that is really the lifter's body and the plate's
 * edge together: it overlaps the plate without sharing its centre in most
 * frames both are seen in. Then the plate is the one whose rim shows nearly all the way round
 * and whose face is round about its centre, by a wide margin on both (on
 * real footage no two candidates are ever this far apart: the closest pair
 * in the validation clips differs by +0.13 rim and −0.01 roundness; the
 * synthetic lifter's phantom against its plate, by +0.21…+0.58 rim and
 * +0.34…+0.86 roundness, motion blur included).
 */
/** A rival must be at least this close to the plate's own roundness (real plates and real arcs differ far less). */
export const RIVAL_ROUNDNESS_GAP = 0.35;

export const ENCLOSED_PLATE = {
  minCoverageGain: 0.15,
  minCoverage: 0.55,
  minRoundnessGain: 0.25,
} as const;

/** The plate's track: the biggest circle seen often that moves up and down. */
export function pickPlate(tracks: CircleTrack[], nFrames: number, samples?: Frame[]): PlateFind {
  if (!tracks.length) return { track: null, confident: false, why: "no_circles", others: [] };
  const minSeen = Math.max(3 / Math.max(1, nFrames), 0.25);
  const still = stillCircles(tracks, nFrames);
  const moving = tracks
    .filter((t) => t.seen >= minSeen && t.travelY >= MIN_TRAVEL)
    .sort((a, b) => score(b) - score(a));
  if (!moving.length) {
    const seen = tracks.filter((t) => t.seen >= minSeen);
    return {
      track: null,
      confident: false,
      why: seen.length ? "not_moving" : "too_few_sightings",
      others: [],
      still,
    };
  }
  let best = moving[0];
  if (samples?.length) {
    const E = ENCLOSED_PLATE;
    const bestRound = roundness(best, samples);
    const swap = moving
      .filter((t) => {
        if (t === best || t.seen < 0.35 || t.coverage < E.minCoverage) return false;
        if (t.coverage < best.coverage + E.minCoverageGain) return false;
        // overlapping, not sharing a centre (a plate's own hub shares it), in most frames both were seen
        // (not "moving together": at speed the phantom lags the plate it's drawn through)
        if (overlapShare(best, t) < 0.5) return false;
        return roundness(t, samples) >= bestRound + E.minRoundnessGain;
      })
      .sort((a, b) => score(b) - score(a))[0];
    if (swap) best = swap;
  }
  // another plate-sized circle moving on its own (a second bar, a partner): not sure which
  // (as plate-like as the plate: a second bar's plate is as round about its centre as this one; an
  // arc of the lifter that happens to be plate-sized is far less, and is never a reason to ask)
  const bestRoundness = samples?.length ? roundness(best, samples) : null;
  const rival = moving.find(
    (t) =>
      t !== best &&
      score(t) >= 0.8 * score(best) &&
      t.r > 0.8 * best.r &&
      seenApartTogether(best, t) >= 3 &&
      together(best, t) < 0.6 &&
      (bestRoundness == null || roundness(t, samples!) >= bestRoundness - RIVAL_ROUNDNESS_GAP),
  );
  const confident = !rival && best.seen >= 0.35 && best.coverage >= 0.38;
  return {
    track: best,
    confident,
    why: confident ? "found" : rival ? "ambiguous" : "too_few_sightings",
    others: [best, ...moving.filter((t) => t !== best)].slice(0, 4),
    still,
  };
}

/** Circles seen in a good share of the frames that never moved. */
export function stillCircles(tracks: CircleTrack[], nFrames: number): CircleTrack[] {
  const minSeen = Math.max(3 / Math.max(1, nFrames), 0.25);
  return tracks.filter((t) => t.seen >= minSeen && t.travelY < 0.15 && t.travelX < 0.15);
}

/** Circles in each sampled frame (found at half size, reported in the frame's own pixels). */
export function sightings(samples: Frame[]): Sighting[][] {
  return samples.map((f, fi) => {
    const small = halfSize(f);
    const range = radiusRange(small.w, small.h);
    return circleCandidates(small, { ...range, max: 8 }).map((c) => ({
      ...c,
      x: c.x * 2 + 0.5,
      y: c.y * 2 + 0.5,
      r: c.r * 2,
      a: c.a * 2,
      b: c.b * 2,
      t: f.t,
      fi,
    }));
  });
}

/** The plate in a clip, from frames spread over it. */
export function findPlate(samples: Frame[]): PlateFind {
  const seen = sightings(samples);
  return pickPlate(linkTracks(seen, samples.length), samples.length, samples);
}

/**
 * Where the plate's track says the plate is at time t (straight between the
 * sightings either side, or held at the first / last one outside them), and
 * how sure (px of slack: wider the further the nearest sighting, at most a
 * few radii).
 */
/**
 * The sightings of a track that look like the plate itself: its size within
 * 18 % (a real plate's read size wanders ~10 % frame to frame) and its rim
 * showing about as much as usual. A frame where only an arc
 * of the lifter beside the plate was found can sit on the track (nothing
 * better was there), and must never steer the follower.
 */
const cores = new WeakMap<CircleTrack, Sighting[]>();
export function coreHits(track: CircleTrack): Sighting[] {
  let c = cores.get(track);
  if (c) return c;
  const covs = track.hits.map((h) => h.coverage).sort((a, b) => a - b);
  const typical = covs[covs.length >> 1] ?? 0;
  c = track.hits.filter(
    (h) => Math.abs(h.r - track.r) <= 0.18 * track.r && h.coverage >= typical - 0.2,
  );
  if (c.length < Math.min(3, track.hits.length)) c = track.hits;
  cores.set(track, c);
  return c;
}

export function trackAt(
  track: CircleTrack,
  t: number,
): { x: number; y: number; slack: number } | null {
  const h = coreHits(track);
  if (!h.length) return null;
  const r = track.r;
  const reach = (dt: number) => Math.min(4 * r, r * (0.5 + 11 * dt));
  // before the first sighting and after the last the bar is set up or racked: it drifts at a walk, not a lift
  const outside = (dt: number) => Math.min(2 * r, r * (0.5 + 3 * dt));
  if (t <= h[0].t) return { x: h[0].x, y: h[0].y, slack: outside(h[0].t - t) };
  const last = h[h.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y, slack: outside(t - last.t) };
  let i = 0;
  while (i < h.length - 1 && h[i + 1].t < t) i++;
  const a = h[i];
  const b = h[i + 1];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    slack: reach(Math.min(t - a.t, b.t - t)) + 0.25 * Math.hypot(b.x - a.x, b.y - a.y),
  };
}
