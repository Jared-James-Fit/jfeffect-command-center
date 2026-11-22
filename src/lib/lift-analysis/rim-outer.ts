/**
 * The plate's outer edge (pure): the ruler every speed is measured with.
 *
 * A loaded bar seen from its end is a stack: the biggest plate's disc with
 * smaller plates in front of it (a 10 kg inside a 25 kg, a 25 lb inside a 45),
 * an iron plate's raised lip just inside its edge, the hub and the sleeve in
 * the middle. Each of those is a circle round the same centre, and on a dark
 * plate in front of a black rack the strongest edge on many rays is an inner
 * one. Taking the strongest edge sized the plate from the inner plate or the
 * lip (on test footage: 3–49 % too small, so every speed that much too fast).
 *
 * The plate's size is its silhouette: the OUTERMOST circle round the centre
 * that most of the way round agrees on. Each ray out from the centre lists
 * every clear edge it crosses; the radii many rays share are the candidate
 * circles; the outermost one well supported is the rim. Its points are then
 * fitted as an axis-aligned ellipse with its own centre (a phone a little
 * off side-on), with robust weights.
 *
 * It also says how sure it is: how much of the way round the edge showed
 * (`share`), how clear it was against what's behind it (`contrast`), and
 * which inner circles it passed over (`inner`), so a rim that can't really
 * be seen (black on black) is never treated as a precise ruler.
 */
import { gradients, median, sampleGrad, type Gray } from "@/lib/lift-analysis/image";

export type OuterRim = {
  /** Centre (px) of the fitted ellipse. */
  x: number;
  y: number;
  /** Horizontal / vertical semi-axes and their geometric mean (px). */
  a: number;
  b: number;
  r: number;
  /** Share of rays whose edge sits on the fitted rim (0…1). */
  share: number;
  /** Median edge strength on the rim (grey levels per px). */
  contrast: number;
  /** RMS distance of the rim points from the ellipse (px). */
  rms: number;
  /** Inner circles passed over (radii, px), smallest first. */
  inner: number[];
};

const tmp: [number, number] = [0, 0];

/** How wide a radius bin is (share of the radius) and how close a ray's edge must be to count for a circle. */
const BIN = 0.015;
const AGREE = 0.035;
/** For telling shapes apart: an edge within this share of the oval. */
const AGREE_TIGHT = 0.012;

export type OuterRimOptions = {
  /** Search from lo·r0 to hi·r0 (defaults 0.6 … 1.3). */
  lo?: number;
  hi?: number;
  rays?: number;
  /** An edge weaker than this (grey levels per px) is texture, not an edge. */
  edgeMin?: number;
  /** An edge weaker than this share of the ray's strongest is dropped (default REL_EDGE). */
  rel?: number;
  /** Look for the centre the circles line up round first (default true). */
  centreSearch?: boolean;
  /** Called with the centre used and the candidate circles (tests, the validation scripts). */
  debug?: (d: { x: number; y: number; cands: { r: number; s: number }[]; q?: number }) => void;
};

/**
 * How faint an edge a ray keeps, against the strongest it crosses: low, because
 * a dark plate's outer edge in front of a black rack can be a tenth as strong as
 * its own bright lip a few px inside it. Clutter that low never lines up round
 * the centre on enough rays to make a circle (the support bar below).
 */
export const REL_EDGE = 0.12;

type Peak = { r: number; v: number };
type RayPeaks = { th: number; peaks: Peak[] }[];

/** Every clear edge each ray out from (x, y) crosses between lo and hi (px from the centre). */
function rayPeaks(
  g: ReturnType<typeof gradients>,
  x: number,
  y: number,
  lo: number,
  hi: number,
  rays: number,
  step: number,
  edgeMin: number,
  rel: number,
): RayPeaks {
  const perRay: RayPeaks = [];
  for (let k = 0; k < rays; k++) {
    const th = (2 * Math.PI * (k + 0.5)) / rays;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const prof: number[] = [];
    const rs: number[] = [];
    for (let r = lo; r <= hi; r += step) {
      if (!sampleGrad(g, x + r * c, y + r * s, tmp)) break;
      const along = Math.abs(tmp[0] * c + tmp[1] * s);
      const m = Math.hypot(tmp[0], tmp[1]);
      prof.push(m > 0 && along >= 0.55 * m ? along : 0);
      rs.push(r);
    }
    if (prof.length < 5) continue;
    let maxV = 0;
    for (const v of prof) maxV = Math.max(maxV, v);
    const floor = Math.max(edgeMin, rel * maxV);
    const peaks: Peak[] = [];
    for (let i = 1; i < prof.length - 1; i++) {
      const v = prof[i];
      if (v < floor || v < prof[i - 1] || v <= prof[i + 1]) continue;
      // sub-sample peak (parabola through the three samples)
      const den = prof[i - 1] - 2 * v + prof[i + 1];
      const off =
        den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (prof[i - 1] - prof[i + 1])) / den)) : 0;
      peaks.push({ r: rs[i] + off * step, v });
    }
    if (peaks.length) perRay.push({ th, peaks });
  }
  return perRay;
}

/**
 * For every radius bin, the share of rays with an edge within AGREE of it.
 * With an aspect q (horizontal ÷ vertical semi-axis), the bins are ovals of
 * that shape: each edge's distance is read as the geometric-mean radius of
 * the q-shaped oval through it, so a plate seen a little off side-on lines up
 * all the way round instead of only at its sides.
 */
function circleSupport(
  perRay: RayPeaks,
  rays: number,
  lo: number,
  hi: number,
  q = 1,
  agree = AGREE,
) {
  const bins: number[] = [];
  for (let b = lo; b <= hi; b *= 1 + BIN) bins.push(b);
  const sq = Math.sqrt(q);
  const rs = perRay.map((ray) => {
    const k = q === 1 ? 1 : Math.sqrt((Math.cos(ray.th) / q) ** 2 + Math.sin(ray.th) ** 2) * sq;
    return ray.peaks.map((p) => p.r * k);
  });
  const support = bins.map(
    (b) => rs.filter((r) => r.some((v) => Math.abs(v - b) <= agree * b)).length / rays,
  );
  return { bins, support };
}

/** The shapes the centre vote tries (coarser: the vote is sharp enough to tell them apart). */
const SYMMETRY_ASPECTS = [0.74, 0.82, 0.9, 1, 1.1, 1.22, 1.35];

/** The plate shapes looked for: horizontal ÷ vertical semi-axis, a phone up to ~45° turned or tilted. */
const ASPECTS = [
  0.72, 0.76, 0.8, 0.84, 0.88, 0.92, 0.96, 1, 1.04, 1.09, 1.14, 1.19, 1.25, 1.32, 1.39,
];

/**
 * How far from the guess (share of its radius) the plate's real centre can be:
 * a finder's circle can sit on the lip's bright top arc a quarter of a radius
 * above the plate's centre, and from there no circle round the plate lines up
 * on the rays (each ray meets the rim at a different distance).
 */
export const CENTRE_SEARCH = 0.3;

/** A rim's own points, fitted as a circle, sit round the plate's centre within this share of its radius. */
export const CONCENTRIC_SHARE = 0.08;

/**
 * The centre the plate's circles line up best round (pure): every circle
 * round the plate (the rim, the lip, the hub, a smaller plate) is round the
 * same point, and from anywhere else none of them lines up on the rays. A
 * coarse grid over ±CENTRE_SEARCH radii, then a finer one round the best;
 * a tie goes to the point nearest the guess.
 */
function bestCentre(
  g: ReturnType<typeof gradients>,
  x: number,
  y: number,
  r0: number,
  lo: number,
  hi: number,
  edgeMin: number,
  rel: number,
): { x: number; y: number } {
  const rays = 48;
  const step = Math.max(0.35, r0 / 60);
  const score = (cx: number, cy: number) => {
    const { support } = circleSupport(
      rayPeaks(g, cx, cy, lo, hi, rays, step, edgeMin, rel),
      rays,
      lo,
      hi,
    );
    let best = 0;
    for (const v of support) best = Math.max(best, v);
    return best - 0.05 * (Math.hypot(cx - x, cy - y) / r0);
  };
  let best = { x, y, s: score(x, y) };
  const look = (cx: number, cy: number) => {
    const s = score(cx, cy);
    if (s > best.s) best = { x: cx, y: cy, s };
  };
  const coarse = CENTRE_SEARCH / 3;
  for (let i = -3; i <= 3; i++)
    for (let j = -3; j <= 3; j++) if (i || j) look(x + i * coarse * r0, y + j * coarse * r0);
  const c0 = { x: best.x, y: best.y };
  const fine = coarse / 3;
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) if (i || j) look(c0.x + i * fine * r0, c0.y + j * fine * r0);
  return { x: best.x, y: best.y };
}

export function outerRim(
  img: Gray,
  x0: number,
  y0: number,
  r0: number,
  opts: OuterRimOptions = {},
): OuterRim | null {
  const lo = (opts.lo ?? 0.6) * r0;
  const hi = (opts.hi ?? 1.3) * r0;
  const rays = opts.rays ?? 96;
  const edgeMin = opts.edgeMin ?? 5;
  const rel = opts.rel ?? REL_EDGE;
  if (!(r0 >= 4)) return null;
  const pad = Math.ceil(hi + CENTRE_SEARCH * r0) + 3;
  const g = gradients(img, x0 - pad, y0 - pad, x0 + pad, y0 + pad);
  // where the plate's circles are round: by radial symmetry when it shows, else where they line up best
  const { x, y } =
    opts.centreSearch === false
      ? { x: x0, y: y0 }
      : (symmetryCentre(img, x0, y0, r0, CENTRE_SEARCH, SYMMETRY_ASPECTS) ??
        bestCentre(g, x0, y0, r0, lo, hi, edgeMin, rel));
  const step = Math.max(0.25, r0 / 120);
  const perRay = rayPeaks(g, x, y, lo, hi, rays, step, edgeMin, rel);
  if (perRay.length < rays * 0.3) return null;
  // the circles (ovals of the shape the edges agree on best): for every bin, how many rays have an edge
  // within AGREE of it. Round wins a tie
  // the shape: judged with a tight tolerance (at the normal one every shape near the right one lines up
  // all the way round), the sum of the two best circles' support (the rim and the lip, the hub)
  let q = 1;
  {
    const sharp = (a: number) => {
      const sup = circleSupport(perRay, rays, lo, hi, a, AGREE_TIGHT).support;
      const top = [...sup].sort((u, v) => v - u);
      return top[0] + (top[1] ?? 0);
    };
    let bestScore = sharp(1);
    for (const a of ASPECTS) {
      if (a === 1) continue;
      const score = sharp(a) - 0.01 * (Math.abs(Math.log(a)) / Math.log(1.04));
      if (score > bestScore + 1e-9) {
        bestScore = score;
        q = a;
      }
    }
  }
  const { bins, support } = circleSupport(perRay, rays, lo, hi, q);
  const sq = Math.sqrt(q);
  const ovalRadius = (r: number, th: number) =>
    q === 1 ? r : r * Math.sqrt((Math.cos(th) / q) ** 2 + Math.sin(th) ** 2) * sq;
  const cands: { r: number; s: number }[] = [];
  for (let i = 0; i < bins.length; i++) {
    const s = support[i];
    if (s < 0.22) continue;
    if (i > 0 && support[i - 1] > s) continue;
    if (i < bins.length - 1 && support[i + 1] >= s) continue;
    cands.push({ r: bins[i], s });
  }
  if (!cands.length) return null;
  opts.debug?.({ x, y, cands, q });
  const best = Math.max(...cands.map((c) => c.s));
  // the outermost circle that's well supported: never a halo of clutter (that only some rays see)
  const strong = cands.filter((c) => c.s >= Math.max(0.3, 0.5 * best)).sort((a, b) => b.r - a.r);
  if (!strong.length) return null;
  // the rim points of a circle: each ray's edge nearest it
  const pointsOn = (c: { r: number }) => {
    const out: { th: number; px: number; py: number; v: number }[] = [];
    for (const ray of perRay) {
      let bestP: Peak | null = null;
      let bestD = Infinity;
      for (const p of ray.peaks) {
        const d = Math.abs(ovalRadius(p.r, ray.th) - c.r);
        if (d <= 1.5 * AGREE * c.r && d < bestD) {
          bestD = d;
          bestP = p;
        }
      }
      if (bestP)
        out.push({
          th: ray.th,
          px: x + bestP.r * Math.cos(ray.th),
          py: y + bestP.r * Math.sin(ray.th),
          v: bestP.v,
        });
    }
    return out;
  };
  // and it has to be round the plate's own centre: an arc of the lifter's head or shoulder peeking out
  // behind the plate lines up on some rays at about the right distance, but it's a circle round a point
  // of its own (its points fitted with their own centre land well away from the plate's)
  let outer: { r: number; s: number } | null = null;
  let pts: { th: number; px: number; py: number; v: number }[] = [];
  for (const c of strong) {
    const p = pointsOn(c);
    if (p.length < 12) continue;
    const fit = kasa(p);
    if (
      !fit ||
      Math.hypot(fit.x - x, fit.y - y) > CONCENTRIC_SHARE * c.r ||
      Math.abs(fit.r / c.r - 1) > CONCENTRIC_SHARE
    )
      continue;
    outer = c;
    pts = p;
    break;
  }
  if (!outer) return null;
  const inner = cands
    .filter((c) => c.r < outer!.r * (1 - 2 * AGREE) && c.s >= 0.22)
    .map((c) => c.r);
  if (pts.length < 12) return null;
  // an axis-aligned ellipse with its own centre: A·X² + B·Y² + C·X + D·Y = 1 (X, Y about the guess), robust reweighting
  let e = { x, y, a: outer.r * sq, b: outer.r / sq };
  for (let it = 0; it < 6; it++) {
    const res = pts.map((p) => ellipseResidual(p.px, p.py, e));
    const sc = Math.max(0.35, 1.4826 * median(res.map(Math.abs)));
    const M = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const v = [0, 0, 0, 0];
    pts.forEach((p, i) => {
      const u = res[i] / (3.5 * sc);
      const w = Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0;
      if (!w) return;
      const X = p.px - x;
      const Y = p.py - y;
      const row = [X * X, Y * Y, X, Y];
      for (let r = 0; r < 4; r++) {
        v[r] += w * row[r];
        for (let c = 0; c < 4; c++) M[r][c] += w * row[r] * row[c];
      }
    });
    const sol = solve4(M, v);
    if (!sol) break;
    const [A, B, C, D] = sol;
    if (!(A > 0 && B > 0)) break;
    const cx = -C / (2 * A);
    const cy = -D / (2 * B);
    const k = 1 + (C * C) / (4 * A) + (D * D) / (4 * B);
    if (!(k > 0)) break;
    const next = { x: x + cx, y: y + cy, a: Math.sqrt(k / A), b: Math.sqrt(k / B) };
    if (!Number.isFinite(next.a) || !Number.isFinite(next.b)) break;
    // never wander off to another circle
    if (Math.hypot(next.x - x, next.y - y) > 0.25 * outer.r) break;
    if (Math.abs(Math.sqrt(next.a * next.b) / outer.r - 1) > 0.12) break;
    e = next;
  }
  // part of the edge hidden (the plate's bottom against the lifter's dark shirt in a squat): its own
  // centre and its height trade off. The plate's inner circles (the hub, the lettering ring, a smaller
  // plate) share its centre and show all the way round, so the centre comes from them and only the
  // two semi-axes from the edge that shows.
  {
    const shape = [e.a / e.b];
    let c: { x: number; y: number } | null = symmetryCentre(img, e.x, e.y, outer.r, 0.25, shape);
    if (c) {
      // once more from where it landed (the window is centred on the guess)
      c = symmetryCentre(img, c.x, c.y, outer.r, 0.25, shape) ?? c;
    } else c = concentricCentre(img, e.x, e.y, outer.r);
    if (c && Math.hypot(c.x - e.x, c.y - e.y) <= 0.15 * outer.r) {
      const fixed = fitAxes(pts, c.x, c.y, outer.r);
      if (fixed) e = { x: c.x, y: c.y, a: fixed.a, b: fixed.b };
    }
  }
  // the points were picked round a circle; a plate seen a little off side-on is an oval whose top and
  // bottom sit several % further out than its sides. Pick each ray's edge again against the oval and fit
  // once more (twice), so the ends of the long axis are never left out or swapped for an inner edge
  for (let it = 0; it < 2; it++) {
    const tolE = Math.max(1, 1.5 * AGREE * Math.sqrt(e.a * e.b));
    const again: typeof pts = [];
    for (const ray of perRay) {
      let bestP: Peak | null = null;
      let bestR = Infinity;
      for (const p of ray.peaks) {
        const r = Math.abs(
          ellipseResidual(x + p.r * Math.cos(ray.th), y + p.r * Math.sin(ray.th), e),
        );
        if (r <= tolE && r < bestR) {
          bestR = r;
          bestP = p;
        }
      }
      if (bestP)
        again.push({
          th: ray.th,
          px: x + bestP.r * Math.cos(ray.th),
          py: y + bestP.r * Math.sin(ray.th),
          v: bestP.v,
        });
    }
    if (again.length < 12) break;
    const fixed = fitAxes(again, e.x, e.y, Math.sqrt(e.a * e.b));
    if (!fixed || Math.abs(Math.sqrt(fixed.a * fixed.b) / Math.sqrt(e.a * e.b) - 1) > 0.1) break;
    pts = again;
    e = { ...e, a: fixed.a, b: fixed.b };
  }
  const res = pts.map((p) => ellipseResidual(p.px, p.py, e));
  const tol = Math.max(1, 0.03 * Math.sqrt(e.a * e.b));
  const on = pts.filter((_, i) => Math.abs(res[i]) <= tol);
  if (on.length < 12) return null;
  const rms = Math.sqrt(
    on.reduce((s, p) => s + ellipseResidual(p.px, p.py, e) ** 2, 0) / on.length,
  );
  if (Math.min(e.a, e.b) / Math.max(e.a, e.b) < 0.55) return null;
  return {
    x: e.x,
    y: e.y,
    a: e.a,
    b: e.b,
    r: Math.sqrt(e.a * e.b),
    share: on.length / rays,
    contrast: median(on.map((p) => p.v)),
    rms,
    inner,
  };
}

/**
 * The plate's centre by radial symmetry (pure): every edge on a plate (the
 * rim, the lip, the lettering ring, the hub, a smaller plate in front) is a
 * circle round the same point, so the line through each edge pixel along its
 * gradient passes through that point. Each strong edge pixel within the
 * plate votes along its line, near the guess; the plate's centre is where the
 * votes pile up. Edges that aren't round the centre (the tabs' sides, the
 * lifter behind) vote all over and only raise the floor. The peak is read to
 * a fraction of a pixel. Null when no clear peak stands out.
 */
export function symmetryCentre(
  img: Gray,
  x: number,
  y: number,
  R: number,
  search = 0.25,
  aspects: number[] = [1],
): { x: number; y: number; peak: number; q: number } | null {
  if (!(R >= 4)) return null;
  // an oval plate's edge normals don't meet at its centre (they bunch up either side of it): each
  // shape is voted for along its own normals, and the shape whose votes pile up sharpest wins
  let best: { x: number; y: number; peak: number; q: number } | null = null;
  for (const q of aspects) {
    const c = symmetryVote(img, x, y, R, search, q);
    if (c && (!best || c.peak > best.peak * (q === 1 ? 0.97 : 1))) best = { ...c, q };
  }
  return best;
}

function symmetryVote(
  img: Gray,
  x: number,
  y: number,
  R: number,
  search: number,
  q: number,
): { x: number; y: number; peak: number } | null {
  const reach = search * R;
  const pad = Math.ceil(1.05 * R + reach) + 2;
  const g = gradients(img, x - pad, y - pad, x + pad, y + pad);
  const cell = Math.max(0.25, R / 80);
  const n = Math.ceil((2 * reach) / cell) + 1;
  const acc = new Float32Array(n * n);
  const ax0 = x - reach;
  const ay0 = y - reach;
  // a strong edge: well above the window's typical gradient
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < g.mag.length; i++) {
    sum += g.mag[i];
    cnt++;
  }
  const thr = Math.max(4, 2 * (sum / Math.max(1, cnt)));
  const r2lo = (0.1 * R) ** 2;
  const r2hi = (1.05 * R + reach) ** 2;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i;
      const m = g.mag[k];
      if (m < thr) continue;
      const px = g.x0 + i;
      const py = g.y0 + j;
      const dx = px - x;
      const dy = py - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2lo || d2 > r2hi) continue;
      // the normal of a q-shaped oval through this edge: (q²·gx, gy), pointing at its centre
      const dxq = q * q * g.gx[k];
      const dyq = g.gy[k];
      const mq = Math.hypot(dxq, dyq);
      const ux = dxq / mq;
      const uy = dyq / mq;
      // the point on the line nearest the guess, and the stretch of it inside the window
      const s0 = -(dx * ux + dy * uy);
      const w = Math.log1p(m);
      for (let s = s0 - 1.5 * reach; s <= s0 + 1.5 * reach; s += cell * 0.7) {
        const qx = (px + s * ux - ax0) / cell;
        const qy = (py + s * uy - ay0) / cell;
        const ix = Math.floor(qx);
        const iy = Math.floor(qy);
        if (ix < 0 || iy < 0 || ix >= n - 1 || iy >= n - 1) continue;
        // shared between the four nearest cells, so the peak is read to a fraction of a cell
        const fx = qx - ix;
        const fy = qy - iy;
        const j = iy * n + ix;
        acc[j] += w * (1 - fx) * (1 - fy);
        acc[j + 1] += w * fx * (1 - fy);
        acc[j + n] += w * (1 - fx) * fy;
        acc[j + n + 1] += w * fx * fy;
      }
    }
  }
  // a little smoothing (3×3), then the peak
  const sm = new Float32Array(n * n);
  let best = -1;
  let bi = 0;
  let total = 0;
  for (let j = 1; j < n - 1; j++)
    for (let i = 1; i < n - 1; i++) {
      let v = 0;
      for (let b = -1; b <= 1; b++)
        for (let a = -1; a <= 1; a++)
          v += acc[(j + b) * n + i + a] * (a === 0 && b === 0 ? 4 : a === 0 || b === 0 ? 2 : 1);
      sm[j * n + i] = v;
      total += v;
      if (v > best) {
        best = v;
        bi = j * n + i;
      }
    }
  const mean = total / Math.max(1, (n - 2) * (n - 2));
  // no clear point: nothing round enough there
  if (!(best > 3 * mean)) return null;
  const bx = bi % n;
  const by = Math.floor(bi / n);
  if (bx < 2 || by < 2 || bx > n - 3 || by > n - 3) return null;
  const sub = (l: number, c: number, r: number) => {
    const den = l - 2 * c + r;
    return den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0;
  };
  const ox = sub(sm[bi - 1], sm[bi], sm[bi + 1]);
  const oy = sub(sm[bi - n], sm[bi], sm[bi + n]);
  return { x: ax0 + (bx + ox) * cell, y: ay0 + (by + oy) * cell, peak: best / mean };
}

/**
 * The plate's centre from its inner circles (pure): each well-supported
 * circle inside the outer edge (≥ 45 % of rays) fitted with its own centre,
 * the median of their centres. Null when no inner circle shows well enough.
 */
export function concentricCentre(
  img: Gray,
  x: number,
  y: number,
  R: number,
): { x: number; y: number; n: number } | null {
  const rays = 96;
  const lo = 0.12 * R;
  const hi = 0.92 * R;
  const pad = Math.ceil(hi) + 3;
  const g = gradients(img, x - pad, y - pad, x + pad, y + pad);
  const step = Math.max(0.25, R / 120);
  const perRay: { th: number; peaks: number[] }[] = [];
  for (let k = 0; k < rays; k++) {
    const th = (2 * Math.PI * (k + 0.5)) / rays;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const prof: number[] = [];
    const rs: number[] = [];
    for (let r = lo; r <= hi; r += step) {
      if (!sampleGrad(g, x + r * c, y + r * s, tmp)) break;
      const along = Math.abs(tmp[0] * c + tmp[1] * s);
      const m = Math.hypot(tmp[0], tmp[1]);
      prof.push(m > 0 && along >= 0.55 * m ? along : 0);
      rs.push(r);
    }
    let maxV = 0;
    for (const v of prof) maxV = Math.max(maxV, v);
    const floor = Math.max(5, 0.3 * maxV);
    const peaks: number[] = [];
    for (let i = 1; i < prof.length - 1; i++)
      if (prof[i] >= floor && prof[i] >= prof[i - 1] && prof[i] > prof[i + 1]) peaks.push(rs[i]);
    perRay.push({ th, peaks });
  }
  const centres: { x: number; y: number; w: number }[] = [];
  for (let b = lo; b <= hi; b *= 1.03) {
    const near = perRay
      .map((ray) => ({ th: ray.th, r: ray.peaks.find((p) => Math.abs(p - b) <= 0.04 * b + 0.6) }))
      .filter((q): q is { th: number; r: number } => q.r != null);
    if (near.length < 0.45 * rays) continue;
    // a circle with its own centre (algebraic fit): x² + y² + D·x + E·y + F = 0
    const ptsC = near.map((q) => ({ px: x + q.r * Math.cos(q.th), py: y + q.r * Math.sin(q.th) }));
    const fit = kasa(ptsC);
    if (!fit || Math.abs(fit.r / b - 1) > 0.1) continue;
    centres.push({ x: fit.x, y: fit.y, w: near.length });
  }
  if (!centres.length) return null;
  // skip near-duplicate radii (one circle fills two neighbouring bins): the median centre is robust to it
  return {
    x: median(centres.map((c) => c.x)),
    y: median(centres.map((c) => c.y)),
    n: centres.length,
  };
}

/** A circle through points (Kåsa's algebraic fit): centre and radius, or null. */
function kasa(pts: { px: number; py: number }[]): { x: number; y: number; r: number } | null {
  if (pts.length < 6) return null;
  const mx = pts.reduce((s, p) => s + p.px, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.py, 0) / pts.length;
  let suu = 0,
    svv = 0,
    suv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0;
  for (const p of pts) {
    const u = p.px - mx;
    const v = p.py - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const bu = 0.5 * (suuu + suvv);
  const bv = 0.5 * (svvv + svuu);
  const uc = (bu * svv - bv * suv) / det;
  const vc = (suu * bv - suv * bu) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  return { x: mx + uc, y: my + vc, r };
}

/**
 * The semi-axes of an axis-aligned ellipse centred at (cx, cy) through the
 * points: 1/ρ² = cos²φ/a² + sin²φ/b² (least squares, robust weights).
 */
function fitAxes(
  pts: { px: number; py: number }[],
  cx: number,
  cy: number,
  r0: number,
): { a: number; b: number } | null {
  const obs = pts.map((p) => {
    const dx = p.px - cx;
    const dy = p.py - cy;
    const rho = Math.hypot(dx, dy);
    return { c2: (dx / rho) ** 2, s2: (dy / rho) ** 2, rho };
  });
  let A = 1 / (r0 * r0);
  let B = A;
  for (let it = 0; it < 5; it++) {
    const res = obs.map((o) => o.rho - 1 / Math.sqrt(A * o.c2 + B * o.s2));
    const sc = Math.max(0.35, 1.4826 * median(res.map(Math.abs)));
    let s11 = 0,
      s12 = 0,
      s22 = 0,
      t1 = 0,
      t2 = 0;
    obs.forEach((o, i) => {
      const u = res[i] / (3.5 * sc);
      const w = Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0;
      const z = 1 / (o.rho * o.rho);
      s11 += w * o.c2 * o.c2;
      s12 += w * o.c2 * o.s2;
      s22 += w * o.s2 * o.s2;
      t1 += w * o.c2 * z;
      t2 += w * o.s2 * z;
    });
    const det = s11 * s22 - s12 * s12;
    if (Math.abs(det) < 1e-14) return null;
    const nA = (t1 * s22 - t2 * s12) / det;
    const nB = (s11 * t2 - s12 * t1) / det;
    if (!(nA > 0 && nB > 0)) return null;
    A = nA;
    B = nB;
  }
  return { a: 1 / Math.sqrt(A), b: 1 / Math.sqrt(B) };
}

function ellipseResidual(
  px: number,
  py: number,
  e: { x: number; y: number; a: number; b: number },
): number {
  const u = Math.hypot((px - e.x) / e.a, (py - e.y) / e.b);
  return (u - 1) * Math.sqrt(e.a * e.b);
}

/** 4 × 4 linear solve (Gaussian elimination with partial pivoting); null when singular. */
function solve4(M: number[][], v: number[]): number[] | null {
  const A = M.map((row, i) => [...row, v[i]]);
  const n = 4;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[n] / A[i][i]);
}

/**
 * The plate's size from its outer edge in several still frames: the median
 * of each semi-axis, and how well it's known (1-σ, relative). The rim's own
 * edge position is uncertain by about a third of a pixel (a rounded edge,
 * blur), more when it barely shows (low contrast or under half the way
 * round), and the frames' spread counts too.
 */
/** A rim measured in a still frame counts when it's within this share of the plate's size. */
export const RIM_SIZE_TOL = 0.12;

/**
 * The still frames' rims that are the plate (pure): those within
 * RIM_SIZE_TOL of the size the track was followed at, unless the frames
 * themselves agree on another size, well apart from it. The size the track
 * started from can be wrong: on a phone turned well round, the plate's face
 * and the edge of the stack behind it make one rounder, bigger outline, and a
 * ring fitted to that outline (Nov 22 2026: 8 % too big) measured only rims
 * of its own wrong size, so every speed came out that much too slow. The
 * plate's own rim, measured at full resolution in most of the frames and in
 * close agreement, outvotes it; when they don't agree, nothing changes. Only
 * ever smaller than the ring: an outline bigger than it is never the plate
 * (with no plate in view the lifter's own outline would win).
 */
export function plateSizedRims<T extends { r: number; share: number }>(rims: T[], R: number): T[] {
  const near = rims.filter((r) => Math.abs(r.r / R - 1) <= RIM_SIZE_TOL);
  const clear = rims.filter((r) => r.share >= 0.6);
  if (clear.length < 3) return near;
  const m = median(clear.map((r) => r.r));
  const agree = clear.filter((r) => Math.abs(r.r / m - 1) <= 0.04);
  // only ever smaller: a ring that took in more than the plate (the stack's edge). A rim bigger than
  // the ring is something round behind it (the lifter), never the plate's own edge
  if (m >= R * (1 - RIM_SIZE_TOL) || agree.length < Math.max(3, 0.7 * clear.length)) return near;
  return rims.filter((r) => Math.abs(r.r / m - 1) <= RIM_SIZE_TOL);
}

export function rimSize(
  rims: {
    a: number;
    b: number;
    share: number;
    contrast: number;
    rms: number;
    scale?: number;
    y?: number;
  }[],
): {
  a: number;
  b: number;
  relA: number;
  relB: number;
  frames: number;
  faint: boolean;
  grad?: { y0: number; k: number };
} | null {
  // each in working px (`scale` converts a rim measured at another resolution)
  // an edge hidden for part of the way round (the plate against the lifter's dark shirt at the bottom
  // of a bench) leaves its centre and size trading off: the frames where it showed nearly all the way
  // round are the ones that count, whenever there are enough of them
  const seen = rims.filter((r) => r.share >= 0.35);
  if (!seen.length) return null;
  const top = Math.max(...seen.map((r) => r.share));
  // the most complete first: a bench's plate at the chest loses its bottom edge against the shirt and
  // reads a few % small even with most of the rim showing, while at lockout it shows all the way round
  let full = seen;
  for (const gap of [0.05, 0.1, 0.2]) {
    const f = seen.filter((r) => r.share >= Math.max(0.35, top - gap));
    if (f.length >= 3) {
      full = f;
      break;
    }
  }
  const rs = full.map((r) => ({
    ...r,
    a: r.a * (r.scale ?? 1),
    b: r.b * (r.scale ?? 1),
    rms: r.rms * (r.scale ?? 1),
  }));
  const a = median(rs.map((r) => r.a));
  const b = median(rs.map((r) => r.b));
  const spread = (v: number[]) =>
    v.length > 1
      ? (1.4826 * median(v.map((x) => Math.abs(x - median(v))))) / Math.sqrt(v.length)
      : 0;
  const contrast = median(rs.map((r) => r.contrast));
  const share = median(rs.map((r) => r.share));
  // the edge's own position: about a third of a pixel at the resolution it was measured at, the same
  // in every frame (a rounded edge, blur), so it never averages out; much worse when the edge is faint
  const faint = contrast < 10 || share < 0.5;
  const edgePx = median(rs.map((r) => (r.scale ?? 1) * 0.33)) * (faint ? 3 : 1);
  const relA = Math.hypot(spread(rs.map((r) => r.a)) / a, edgePx / a, faint ? 0.02 : 0);
  const grad = sizeGradient(rs, b);
  if (grad) {
    // the size at the reference height, and its spread once the slope is taken out
    const bs = rs.map((r) => r.b - grad.k * ((r.y ?? grad.y0) - grad.y0));
    const as = rs.map((r) => r.a - grad.k * (a / b) * ((r.y ?? grad.y0) - grad.y0));
    const b0 = median(bs);
    const a0 = median(as);
    const relB0 = Math.hypot(spread(bs) / b0, edgePx / b0, faint ? 0.02 : 0);
    const relA0 = Math.hypot(spread(as) / a0, edgePx / a0, faint ? 0.02 : 0);
    return { a: a0, b: b0, relA: relA0, relB: relB0, frames: rs.length, faint, grad };
  }
  const relB = Math.hypot(spread(rs.map((r) => r.b)) / b, edgePx / b, faint ? 0.02 : 0);
  return { a, b, relA, relB, frames: rs.length, faint };
}

/**
 * How the plate's size changes with its height in the picture (pure): a
 * straight line through the sizes measured at different heights (Theil–Sen:
 * the median of every pair's slope, so one bad frame can't tilt it). Only
 * when the frames span at least a plate's diameter of travel with some at
 * each end, and the size changes by 1 % to 15 % across it; null otherwise (a
 * level phone: one size everywhere).
 */
export function sizeGradient(
  rims: { b: number; y?: number }[],
  b: number,
): { y0: number; k: number } | null {
  const pts = rims.filter(
    (r): r is { b: number; y: number } => r.y != null && Number.isFinite(r.y),
  );
  if (pts.length < 4) return null;
  const ys = pts.map((p) => p.y).sort((u, v) => u - v);
  const span = ys[ys.length - 1] - ys[0];
  if (span < 2 * b) return null;
  const lo = ys[0] + span / 3;
  const hi = ys[ys.length - 1] - span / 3;
  if (pts.filter((p) => p.y <= lo).length < 2 || pts.filter((p) => p.y >= hi).length < 2)
    return null;
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dy = pts[j].y - pts[i].y;
      if (Math.abs(dy) >= 0.5 * b) slopes.push((pts[j].b - pts[i].b) / dy);
    }
  if (slopes.length < 3) return null;
  const k = median(slopes);
  const change = Math.abs(k * span) / b;
  if (change < 0.01 || change > 0.15) return null;
  return { y0: median(ys), k };
}
