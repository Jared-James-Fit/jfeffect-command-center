/**
 * Finding and measuring the plate's rim (pure). Seen from the side, the end
 * of a loaded barbell is a disc: the biggest plate's outline, 450 mm across
 * for every 20 kg / 25 kg / 45 lb plate and every bumper. Its rim is the most
 * reliable thing in a lifting video: it doesn't change as the plate spins,
 * it stays round whatever the lighting, and part of it still shows when a
 * rack upright or a hand covers the rest.
 *
 *   rimScore   how strongly a circle's outline sits on edges in the picture
 *              (the gradient across the rim, averaged around it)
 *   fitRim     the rim measured precisely: around the circle, the strongest
 *              edge across it (sub-pixel), then a robust circle fit to those
 *              points, and an axis-aligned ellipse fit (a plate seen a little
 *              off side-on is an ellipse: its two axes are its two scales)
 *   houghCircles  every plausible circle in a frame (gradient Hough: each
 *              edge votes for the centres it could belong to)
 */
import {
  gradients,
  percentile,
  sampleGrad,
  type Gradient,
  type Gray,
} from "@/lib/lift-analysis/image";

export type Circle = { x: number; y: number; r: number };
export type RimFit = Circle & {
  /** Horizontal / vertical semi-axes of the axis-aligned ellipse through the same points (px). */
  a: number;
  b: number;
  /** Share of the way round where the rim was found and agrees with the fit (0…1). */
  coverage: number;
  /** RMS distance of the rim points from the circle (px). */
  rms: number;
  /** Median edge strength across the rim. */
  strength: number;
  /** Rim points used. */
  n: number;
};

const TWO_PI = Math.PI * 2;
const COS: Map<number, Float64Array> = new Map();
const SIN: Map<number, Float64Array> = new Map();
function table(n: number): [Float64Array, Float64Array] {
  let c = COS.get(n);
  let s = SIN.get(n);
  if (!c || !s) {
    c = new Float64Array(n);
    s = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      c[k] = Math.cos((TWO_PI * k) / n);
      s[k] = Math.sin((TWO_PI * k) / n);
    }
    COS.set(n, c);
    SIN.set(n, s);
  }
  return [c, s];
}

const tmp: [number, number] = [0, 0];

/**
 * Mean edge strength across the outline of the circle (x, y, r), or of the
 * axis-aligned ellipse with semi-axes r × ry; angles outside the region count as 0.
 */
export function rimScore(
  g: Gradient,
  x: number,
  y: number,
  r: number,
  angles = 48,
  ry = r,
): number {
  const [c, s] = table(angles);
  let sum = 0;
  for (let k = 0; k < angles; k++) {
    let nx = c[k];
    let ny = s[k];
    if (ry !== r) {
      // the ellipse's normal at this point
      const ux = ry * c[k];
      const uy = r * s[k];
      const m = Math.hypot(ux, uy) || 1;
      nx = ux / m;
      ny = uy / m;
    }
    if (!sampleGrad(g, x + r * c[k], y + ry * s[k], tmp)) continue;
    sum += Math.abs(tmp[0] * nx + tmp[1] * ny);
  }
  return sum / angles;
}

/** Solve a small dense linear system (Gaussian elimination, partial pivoting); null when singular. */
export function solve(A: number[][], bv: number[]): number[] | null {
  const n = bv.length;
  const M = A.map((row, i) => [...row, bv[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (!f) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let v = M[r][n];
    for (let k = r + 1; k < n; k++) v -= M[r][k] * out[k];
    out[r] = v / M[r][r];
  }
  return out.every(Number.isFinite) ? out : null;
}

type Pt = { x: number; y: number; w: number };

/** Weighted algebraic circle fit (Kåsa), in coordinates centred on (ox, oy) for conditioning. */
function kasa(pts: Pt[], ox: number, oy: number): Circle | null {
  let sxx = 0,
    sxy = 0,
    syy = 0,
    sx = 0,
    sy = 0,
    sw = 0,
    sxz = 0,
    syz = 0,
    sz = 0;
  for (const p of pts) {
    const x = p.x - ox;
    const y = p.y - oy;
    const z = x * x + y * y;
    const w = p.w;
    sxx += w * x * x;
    sxy += w * x * y;
    syy += w * y * y;
    sx += w * x;
    sy += w * y;
    sw += w;
    sxz += w * x * z;
    syz += w * y * z;
    sz += w * z;
  }
  // x² + y² + D x + E y + F = 0
  const sol = solve(
    [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, sw],
    ],
    [-sxz, -syz, -sz],
  );
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  return { x: cx + ox, y: cy + oy, r: Math.sqrt(r2) };
}

type Shape = { x: number; y: number; a: number; b: number };

/** Weighted axis-aligned ellipse fit (centre and both semi-axes), in coordinates centred on `c` and scaled by `s`. */
function ellipseFit(pts: Pt[], c: { x: number; y: number }, scale: number): Shape | null {
  if (pts.filter((p) => p.w > 0).length < 8) return null;
  const sc = scale || 1;
  // A x² + B y² + C x + D y = 1
  const M = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const v = [0, 0, 0, 0];
  for (const p of pts) {
    if (!(p.w > 0)) continue;
    const x = (p.x - c.x) / sc;
    const y = (p.y - c.y) / sc;
    const row = [x * x, y * y, x, y];
    for (let i = 0; i < 4; i++) {
      v[i] += p.w * row[i];
      for (let j = 0; j < 4; j++) M[i][j] += p.w * row[i] * row[j];
    }
  }
  const sol = solve(M, v);
  if (!sol) return null;
  const [A, B, C, D] = sol;
  if (!(A > 0 && B > 0)) return null;
  const k = 1 + (C * C) / (4 * A) + (D * D) / (4 * B);
  if (!(k > 0)) return null;
  const out = {
    x: c.x - (C / (2 * A)) * sc,
    y: c.y - (D / (2 * B)) * sc,
    a: Math.sqrt(k / A) * sc,
    b: Math.sqrt(k / B) * sc,
  };
  return Object.values(out).every(Number.isFinite) ? out : null;
}

/** Distance (px, signed) of a point from an axis-aligned ellipse, to first order. */
function ellipseResidual(p: { x: number; y: number }, e: Shape): number {
  const u = Math.hypot((p.x - e.x) / e.a, (p.y - e.y) / e.b);
  return (u - 1) * Math.sqrt(e.a * e.b);
}

/** The narrowest a fitted plate may be (minor ÷ major axis). */
export const MIN_ELLIPSE_RATIO = 0.4;

export type FitOptions = {
  /** Rim points are looked for this far either side of the guess's outline (px; default 15% of r). */
  band?: number;
  angles?: number;
  iterations?: number;
  /** Keep the radius within this share of the guess's (the tracker knows the plate's size). */
  rTol?: number;
  /** An edge weaker than this isn't the rim. */
  edgeMin?: number;
  /** Fit an axis-aligned ellipse (a plate seen a little off side-on), not just a circle. */
  ellipse?: boolean;
  /** Start from this shape (semi-axes) instead of a circle. */
  axes?: { a: number; b: number };
};

/**
 * Measure the rim near a guessed circle. Null when too little of it shows
 * (under a quarter of the way round) or the fit doesn't hold together.
 * With `ellipse`, the rim is fitted as an axis-aligned ellipse when it is
 * one (more than 2 % between its axes); `r` is then the geometric mean.
 */
export function fitRim(g: Gradient, guess: Circle, opts: FitOptions = {}): RimFit | null {
  const N = opts.angles ?? 72;
  const [cs, sn] = table(N);
  const iterations = opts.iterations ?? 3;
  const edgeMin = opts.edgeMin ?? 24;
  let e: Shape = { x: guess.x, y: guess.y, a: opts.axes?.a ?? guess.r, b: opts.axes?.b ?? guess.r };
  let pts: Pt[] = [];
  let kept: (Pt & { k: number; strength: number })[] = [];
  const rOf = (sh: Shape) => Math.sqrt(sh.a * sh.b);
  for (let it = 0; it < iterations; it++) {
    const r0 = rOf(e);
    const band = it === 0 ? (opts.band ?? Math.max(3, 0.15 * r0)) : Math.max(2, 0.07 * r0);
    kept = [];
    for (let k = 0; k < N; k++) {
      // a point of the current shape and its outward normal
      const px0 = e.x + e.a * cs[k];
      const py0 = e.y + e.b * sn[k];
      let nx = e.b * cs[k];
      let ny = e.a * sn[k];
      const nm = Math.hypot(nx, ny) || 1;
      nx /= nm;
      ny /= nm;
      let best = -1;
      let bestS = 0;
      let prev = 0;
      let bestPrev = 0;
      let bestNext = 0;
      let lastWasBest = false;
      for (let st = -band; st <= band + 1e-9; st += 0.5) {
        if (!sampleGrad(g, px0 + st * nx, py0 + st * ny, tmp)) {
          prev = 0;
          lastWasBest = false;
          continue;
        }
        const gr = Math.abs(tmp[0] * nx + tmp[1] * ny);
        const m = Math.hypot(tmp[0], tmp[1]);
        // mostly across the rim, not along it (a texture or a bar crossing the plate)
        const val = m > 0 && gr >= 0.6 * m ? gr : 0;
        if (lastWasBest) {
          bestNext = val;
          lastWasBest = false;
        }
        if (val > best) {
          best = val;
          bestS = st;
          bestPrev = prev;
          bestNext = 0;
          lastWasBest = true;
        }
        prev = val;
      }
      if (best < edgeMin) continue;
      // the edge's sub-pixel position: a parabola through the strongest sample and its neighbours
      const den = bestPrev - 2 * best + bestNext;
      const off =
        den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (bestPrev - bestNext)) / den)) * 0.5 : 0;
      const d = bestS + off;
      kept.push({ x: px0 + d * nx, y: py0 + d * ny, w: 1, k, strength: best });
    }
    if (kept.length < N * 0.25) return null;
    pts = kept.map((p) => ({ x: p.x, y: p.y, w: 1 }));
    // robust fit: Tukey weights on the distance from the shape, a few rounds
    const circ = kasa(pts, e.x, e.y);
    if (!circ) return null;
    let fit: Shape = { x: circ.x, y: circ.y, a: circ.r, b: circ.r };
    const useEllipse = !!opts.ellipse && it > 0;
    for (let round = 0; round < 3; round++) {
      const res = pts.map((p) => ellipseResidual(p, fit));
      const abs = res.map(Math.abs).sort((a, b) => a - b);
      const scale = Math.max(0.6, 1.4826 * abs[abs.length >> 1]);
      const cut = 3.5 * scale;
      pts.forEach((p, i) => {
        const u = res[i] / cut;
        p.w = Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0;
      });
      if (pts.filter((p) => p.w > 0).length < N * 0.2) return null;
      let next: Shape | null = null;
      if (useEllipse) {
        const el = ellipseFit(pts, fit, rOf(fit));
        if (
          el &&
          Math.abs(el.a - el.b) / Math.max(el.a, el.b) > 0.02 &&
          // down to a plate seen ~65° off side-on (narrower than that it's barely a face at all)
          Math.min(el.a, el.b) / Math.max(el.a, el.b) > MIN_ELLIPSE_RATIO
        )
          next = el;
      }
      if (!next) {
        const cc = kasa(pts, fit.x, fit.y);
        next = cc ? { x: cc.x, y: cc.y, a: cc.r, b: cc.r } : null;
      }
      if (!next) return null;
      fit = next;
    }
    if (opts.rTol != null) {
      const lo = guess.r * (1 - opts.rTol);
      const hi = guess.r * (1 + opts.rTol);
      const r = rOf(fit);
      if (r < lo || r > hi) {
        // the size is known: keep the centre and the shape, hold the size
        const f = Math.min(hi, Math.max(lo, r)) / r;
        fit = { ...fit, a: fit.a * f, b: fit.b * f };
      }
    }
    // a fit that wandered far from where it started isn't this circle
    if (Math.hypot(fit.x - guess.x, fit.y - guess.y) > Math.max(4, 0.6 * guess.r)) return null;
    e = fit;
  }
  const res = pts.map((p) => ellipseResidual(p, e));
  const r = rOf(e);
  const tol = Math.max(1, 0.03 * r);
  let inl = 0;
  let ss = 0;
  const strengths: number[] = [];
  res.forEach((d, i) => {
    if (Math.abs(d) <= tol && pts[i].w > 0) {
      inl++;
      ss += d * d;
      strengths.push(kept[i].strength);
    }
  });
  if (inl < 6) return null;
  // the ellipse's axes, even when the circle was kept (calibration reads them)
  let axes = { a: e.a, b: e.b };
  if (!opts.ellipse) {
    const inliers = pts.filter((p, i) => Math.abs(res[i]) <= tol && p.w > 0);
    const el = ellipseFit(inliers, e, r);
    if (el && Math.hypot(el.x - e.x, el.y - e.y) < 0.1 * r) axes = { a: el.a, b: el.b };
  }
  strengths.sort((a, b) => a - b);
  return {
    x: e.x,
    y: e.y,
    r,
    a: axes.a,
    b: axes.b,
    coverage: inl / N,
    rms: Math.sqrt(ss / inl),
    strength: strengths[strengths.length >> 1],
    n: inl,
  };
}

/**
 * Rings inside a circle: a plate has them (its hub, the sleeve's end, a
 * raised lip), a head or a ball doesn't. Across the circle's radius, the
 * edge running round at the same distance from the centre, averaged all the
 * way round: a concentric ring shows as a peak that most angles agree on.
 * Returns the strongest ring's share of angles (0…1) and its radius.
 */
export function ringScore(
  g: Gradient,
  c: { x: number; y: number; a: number; b: number },
  edgeMin = 20,
): { share: number; at: number } {
  const N = 36;
  const [cs, sn] = table(N);
  const steps = 24;
  // fractions of the radius from the sleeve to just inside the rim
  const lo = 0.12;
  const hi = 0.84;
  const hits = new Float64Array(steps);
  for (let k = 0; k < N; k++) {
    let nx = c.b * cs[k];
    let ny = c.a * sn[k];
    const m = Math.hypot(nx, ny) || 1;
    nx /= m;
    ny /= m;
    // this angle's strongest edge across the radius, if strong enough
    let best = -1;
    let bestJ = -1;
    for (let j = 0; j < steps; j++) {
      const f = lo + ((hi - lo) * (j + 0.5)) / steps;
      if (!sampleGrad(g, c.x + f * c.a * cs[k], c.y + f * c.b * sn[k], tmp)) continue;
      const gr = Math.abs(tmp[0] * nx + tmp[1] * ny);
      const mg = Math.hypot(tmp[0], tmp[1]);
      if (mg > 0 && gr >= 0.7 * mg && gr > best) {
        best = gr;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && best >= edgeMin) {
      // a ring's edge can fall either side of a step: count it in its neighbours too
      hits[bestJ] += 1;
      if (bestJ > 0) hits[bestJ - 1] += 0.5;
      if (bestJ < steps - 1) hits[bestJ + 1] += 0.5;
    }
  }
  let bj = 0;
  for (let j = 1; j < steps; j++) if (hits[j] > hits[bj]) bj = j;
  return { share: Math.min(1, hits[bj] / N), at: lo + ((hi - lo) * (bj + 0.5)) / steps };
}

export type HoughOptions = {
  rMin: number;
  rMax: number;
  /** Look only here (a box in frame pixels). */
  region?: { x0: number; y0: number; x1: number; y1: number };
  /** How many circles to return at most. */
  max?: number;
  /** Ignore circles that cover less of their rim than this. */
  minCoverage?: number;
};

/** Gradients for a whole frame (or a region): what houghCircles and the fits read. */
export function frameGradients(img: Gray, region?: HoughOptions["region"]): Gradient {
  const r = region ?? { x0: 0, y0: 0, x1: img.w - 1, y1: img.h - 1 };
  return gradients(img, r.x0, r.y0, r.x1, r.y1);
}

/**
 * Every plausible circle in a frame, the best first. Edge pixels (thinned to
 * the ridge of the edge) vote along their gradient for a centre at each
 * radius; the peaks are measured with fitRim and the same circle found at
 * nearby radii is kept once.
 */
export function houghCircles(img: Gray, opts: HoughOptions, gIn?: Gradient): RimFit[] {
  const g = gIn ?? frameGradients(img, opts.region);
  const { w, h, gx, gy, mag } = g;
  if (w < 8 || h < 8) return [];
  const thr = Math.max(28, percentile(mag, 0.88));
  // edge ridge pixels: a local maximum across the edge (non-maximum suppression, 4 directions)
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
      ex.push(x + g.x0);
      ey.push(y + g.y0);
      ux.push(gx[i] / m);
      uy.push(gy[i] / m);
    }
  }
  if (ex.length < 12) return [];
  const cell = opts.rMin >= 10 ? 2 : 1;
  const aw = Math.ceil(img.w / cell);
  const ah = Math.ceil(img.h / cell);
  const acc = new Float32Array(aw * ah);
  const sm = new Float32Array(aw * ah);
  type Peak = { x: number; y: number; r: number; support: number };
  const peaks: Peak[] = [];
  for (let r = opts.rMin; r <= opts.rMax * 1.0001; r *= 1.09) {
    acc.fill(0);
    for (let e = 0; e < ex.length; e++) {
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const cx = Math.round((ex[e] + sgn * r * ux[e]) / cell);
        const cy = Math.round((ey[e] + sgn * r * uy[e]) / cell);
        if (cx < 0 || cy < 0 || cx >= aw || cy >= ah) continue;
        acc[cy * aw + cx] += 1;
      }
    }
    // 3 × 3 sums: votes for one centre spread over neighbouring cells (only where a cell had a few)
    const need = 0.3 * TWO_PI * r;
    const seedMin = need / 9;
    sm.fill(0);
    for (let y = 1; y < ah - 1; y++) {
      for (let x = 1; x < aw - 1; x++) {
        const i = y * aw + x;
        if (acc[i] < seedMin) continue;
        sm[i] =
          acc[i - aw - 1] +
          acc[i - aw] +
          acc[i - aw + 1] +
          acc[i - 1] +
          acc[i] +
          acc[i + 1] +
          acc[i + aw - 1] +
          acc[i + aw] +
          acc[i + aw + 1];
      }
    }
    const here: Peak[] = [];
    for (let y = 1; y < ah - 1; y++) {
      for (let x = 1; x < aw - 1; x++) {
        const i = y * aw + x;
        const v = sm[i];
        if (v < need) continue;
        if (
          v < sm[i - 1] ||
          v < sm[i + 1] ||
          v < sm[i - aw] ||
          v < sm[i + aw] ||
          v < sm[i - aw - 1] ||
          v < sm[i + aw + 1] ||
          v < sm[i - aw + 1] ||
          v < sm[i + aw - 1]
        )
          continue;
        here.push({ x: x * cell, y: y * cell, r, support: v / (TWO_PI * r) });
      }
    }
    here.sort((a, b) => b.support - a.support);
    peaks.push(...here.slice(0, 4));
  }
  peaks.sort((a, b) => b.support - a.support);
  const fits: RimFit[] = [];
  const minCoverage = opts.minCoverage ?? 0.45;
  const edgeMin = Math.max(20, thr * 0.45);
  for (const p of peaks.slice(0, 40)) {
    // the same circle already measured from another peak
    if (
      fits.some(
        (f) => Math.hypot(f.x - p.x, f.y - p.y) < 0.2 * f.r && Math.abs(f.r - p.r) < 0.15 * f.r,
      )
    )
      continue;
    // a quick look first: too little edge round it isn't worth measuring
    if (rimScore(g, p.x, p.y, p.r, 24) < 0.35 * edgeMin) continue;
    const fit = fitRim(g, p, { edgeMin, rTol: 0.2, ellipse: true });
    if (!fit || fit.coverage < minCoverage) continue;
    if (fit.r < opts.rMin * 0.9 || fit.r > opts.rMax * 1.1) continue;
    const same = fits.findIndex(
      (f) => Math.hypot(f.x - fit.x, f.y - fit.y) < 0.2 * f.r && Math.abs(f.r - fit.r) < 0.1 * f.r,
    );
    if (same >= 0) {
      if (fit.coverage > fits[same].coverage) fits[same] = fit;
      continue;
    }
    fits.push(fit);
  }
  fits.sort((a, b) => b.coverage - a.coverage || b.r - a.r);
  return fits.slice(0, opts.max ?? 8);
}

/**
 * A circle of a known size somewhere in a region (the tracker re-finding the
 * plate, or the plate found from a tap): the best outline on a coarse grid,
 * then measured. Null when nothing there looks like the rim.
 */
export function circleOfRadius(
  img: Gray,
  r: number,
  region: { x0: number; y0: number; x1: number; y1: number },
  opts: { step?: number; minCoverage?: number; edgeMin?: number } = {},
): RimFit | null {
  const pad = Math.ceil(r * 1.2) + 3;
  const g = gradients(img, region.x0 - pad, region.y0 - pad, region.x1 + pad, region.y1 + pad);
  const step = opts.step ?? Math.max(1, Math.round(r / 10));
  type Hit = { x: number; y: number; s: number };
  const hits: Hit[] = [];
  for (let y = Math.max(0, region.y0); y <= Math.min(img.h - 1, region.y1); y += step) {
    for (let x = Math.max(0, region.x0); x <= Math.min(img.w - 1, region.x1); x += step) {
      hits.push({ x, y, s: rimScore(g, x, y, r, 32) });
    }
  }
  hits.sort((a, b) => b.s - a.s);
  let best: RimFit | null = null;
  const tried: Hit[] = [];
  for (const h of hits) {
    if (tried.length >= 6) break;
    if (tried.some((t) => Math.hypot(t.x - h.x, t.y - h.y) < 0.5 * r)) continue;
    tried.push(h);
    const fit = fitRim(
      g,
      { x: h.x, y: h.y, r },
      { rTol: 0.1, edgeMin: opts.edgeMin ?? 22, ellipse: true },
    );
    if (fit && fit.coverage >= (opts.minCoverage ?? 0.4) && (!best || fit.coverage > best.coverage))
      best = fit;
  }
  return best;
}
