/**
 * The plate's size from its centre (pure): rays out from the centre each
 * report their strongest edge across the ray, and the rim is the distance
 * most rays agree on. Unlike a circle fit started from a guessed size, this
 * finds the outer rim even when the guess was 30 % off; the hub, the inner
 * rings and the clutter behind the plate each win only a few rays.
 *
 * Then the rays near that distance are fitted as an axis-aligned ellipse
 * (1/r² = cos²θ/a² + sin²θ/b², least squares with robust weights): a, the
 * horizontal semi-axis, and b, the vertical one, whatever the camera angle.
 */
import { gradients, median, sampleGrad, type Gray } from "@/lib/lift-analysis/image";

export type RimMeasure = {
  /** Geometric-mean radius and the two semi-axes (px). */
  r: number;
  a: number;
  b: number;
  /** Share of rays that agree on the rim (0…1). */
  share: number;
  /** Share of the rays near the top and bottom that agree (the vertical size's own evidence). */
  vShare: number;
};

const tmp: [number, number] = [0, 0];

export function measureRim(
  img: Gray,
  x: number,
  y: number,
  rMin: number,
  rMax: number,
  rays = 72,
): RimMeasure | null {
  const pad = Math.ceil(rMax) + 3;
  const g = gradients(img, x - pad, y - pad, x + pad, y + pad);
  const step = Math.max(0.5, rMin / 40);
  const hits: { th: number; r: number; s: number }[] = [];
  let maxS = 0;
  for (let k = 0; k < rays; k++) {
    const th = (2 * Math.PI * k) / rays;
    const c = Math.cos(th);
    const s = Math.sin(th);
    let best = 0;
    let bestR = -1;
    let prev = 0;
    let bPrev = 0;
    let bNext = 0;
    let wasBest = false;
    for (let r = rMin; r <= rMax; r += step) {
      if (!sampleGrad(g, x + r * c, y + r * s, tmp)) break;
      const along = Math.abs(tmp[0] * c + tmp[1] * s);
      const m = Math.hypot(tmp[0], tmp[1]);
      const v = m > 0 && along >= 0.6 * m ? along : 0;
      if (wasBest) {
        bNext = v;
        wasBest = false;
      }
      if (v > best) {
        best = v;
        bestR = r;
        bPrev = prev;
        bNext = 0;
        wasBest = true;
      }
      prev = v;
    }
    if (bestR < 0) continue;
    const den = bPrev - 2 * best + bNext;
    const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (bPrev - bNext)) / den)) * step : 0;
    hits.push({ th, r: bestR + off, s: best });
    if (best > maxS) maxS = best;
  }
  if (hits.length < rays * 0.3) return null;
  // ignore faint edges (texture, noise)
  const strong = hits.filter((h) => h.s >= Math.max(10, 0.2 * maxS));
  if (strong.length < rays * 0.25) return null;
  // the distance most rays agree on (±4 %)
  let peakR = 0;
  let peakN = 0;
  for (const h of strong) {
    const n = strong.filter((o) => Math.abs(o.r - h.r) <= 0.04 * h.r).length;
    if (n > peakN || (n === peakN && h.r > peakR)) {
      peakN = n;
      peakR = h.r;
    }
  }
  // an ellipse through the rays near it (an off-side-on camera: the axes differ)
  let near = strong.filter((h) => Math.abs(h.r - peakR) <= 0.15 * peakR);
  if (near.length < 8) return null;
  let A = 1 / (peakR * peakR);
  let B = A;
  for (let it = 0; it < 4; it++) {
    let s11 = 0,
      s12 = 0,
      s22 = 0,
      t1 = 0,
      t2 = 0;
    const res = near.map((h) => {
      const c2 = Math.cos(h.th) ** 2;
      const s2 = Math.sin(h.th) ** 2;
      const pred = 1 / Math.sqrt(A * c2 + B * s2);
      return h.r - pred;
    });
    const scale = Math.max(0.5, 1.4826 * median(res.map(Math.abs)));
    near.forEach((h, i) => {
      const u = res[i] / (3.5 * scale);
      const w = Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0;
      const c2 = Math.cos(h.th) ** 2;
      const s2 = Math.sin(h.th) ** 2;
      const z = 1 / (h.r * h.r);
      s11 += w * c2 * c2;
      s12 += w * c2 * s2;
      s22 += w * s2 * s2;
      t1 += w * c2 * z;
      t2 += w * s2 * z;
    });
    const det = s11 * s22 - s12 * s12;
    if (Math.abs(det) < 1e-12) break;
    const nA = (t1 * s22 - t2 * s12) / det;
    const nB = (s11 * t2 - s12 * t1) / det;
    if (!(nA > 0 && nB > 0)) break;
    A = nA;
    B = nB;
    near = strong.filter((h) => {
      const pred = 1 / Math.sqrt(A * Math.cos(h.th) ** 2 + B * Math.sin(h.th) ** 2);
      return Math.abs(h.r - pred) <= 0.06 * pred;
    });
    if (near.length < 8) return null;
  }
  const a = 1 / Math.sqrt(A);
  const b = 1 / Math.sqrt(B);
  if (!(a > 0 && b > 0) || Math.min(a, b) / Math.max(a, b) < 0.5) return null;
  const vert = (h: { th: number }) => Math.abs(Math.sin(h.th)) > 0.7;
  const vRays = Math.max(1, Math.round(rays * 0.5));
  return {
    r: Math.sqrt(a * b),
    a,
    b,
    share: near.length / rays,
    vShare: near.filter(vert).length / vRays,
  };
}

/**
 * How strongly each radius looks like a rim around (x, y): every ray adds
 * its three strongest edges (strongest counted most), into bins 2 % of the
 * radius wide. A plate's rim is in almost every ray; clutter isn't.
 */
export function radialVotes(
  img: Gray,
  x: number,
  y: number,
  rMin: number,
  rMax: number,
  bins: number[],
  rays = 72,
): number[] | null {
  const pad = Math.ceil(rMax) + 3;
  const g = gradients(img, x - pad, y - pad, x + pad, y + pad);
  const out = new Array<number>(bins.length).fill(0);
  const step = Math.max(0.5, rMin / 40);
  let used = 0;
  for (let k = 0; k < rays; k++) {
    const th = (2 * Math.PI * k) / rays;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const prof: { r: number; v: number }[] = [];
    for (let r = rMin; r <= rMax; r += step) {
      if (!sampleGrad(g, x + r * c, y + r * sn, tmp)) break;
      const along = Math.abs(tmp[0] * c + tmp[1] * sn);
      const m = Math.hypot(tmp[0], tmp[1]);
      prof.push({ r, v: m > 0 && along >= 0.6 * m ? along : 0 });
    }
    if (prof.length < 3) continue;
    used++;
    // local maxima along the ray, strongest first
    const peaks = prof
      .filter(
        (p, i) =>
          i > 0 && i < prof.length - 1 && p.v >= 10 && p.v >= prof[i - 1].v && p.v > prof[i + 1].v,
      )
      .sort((u, v) => v.v - u.v)
      .slice(0, 3);
    peaks.forEach((p, j) => {
      const w = [1, 0.6, 0.35][j];
      const bi = bins.findIndex((b) => Math.abs(p.r - b) <= 0.01 * b + 1e-9);
      if (bi >= 0) out[bi] += w;
    });
  }
  return used >= rays * 0.3 ? out.map((v) => v / rays) : null;
}

/**
 * The plate's radius from several sightings of it: the radius whose rim
 * shows around the plate wherever it is. Sightings are grouped by height
 * (the bar at lockout, at the chest, on the floor: each in front of
 * different things) and each group counts once, so a halo the rack or the
 * bench makes behind the plate in one place can't outvote the rim.
 */
export function consensusRadius(
  sightings: { img: Gray; x: number; y: number; r: number }[],
): { r: number; strength: number } | null {
  if (!sightings.length) return null;
  const r0 = median(sightings.map((s) => s.r));
  const bins: number[] = [];
  for (let b = 0.6 * r0; b <= 1.5 * r0; b *= 1.02) bins.push(b);
  // group by height, in steps of half a radius
  const groups = new Map<number, number[][]>();
  for (const s of sightings) {
    const v = radialVotes(s.img, s.x, s.y, 0.55 * r0, 1.55 * r0, bins);
    if (!v) continue;
    const key = Math.round(s.y / (0.5 * r0));
    const arr = groups.get(key) ?? [];
    arr.push(v);
    groups.set(key, arr);
  }
  if (!groups.size) return null;
  const total = new Array<number>(bins.length).fill(0);
  for (const arr of groups.values()) {
    for (let i = 0; i < bins.length; i++)
      total[i] += arr.reduce((s, v) => s + v[i], 0) / arr.length;
  }
  // a bin and its neighbours (one radius can straddle two)
  let best = 0;
  let bi = -1;
  for (let i = 1; i < bins.length - 1; i++) {
    const v = total[i - 1] * 0.5 + total[i] + total[i + 1] * 0.5;
    if (v > best) {
      best = v;
      bi = i;
    }
  }
  if (bi < 0) return null;
  // centre of mass of the peak's three bins
  const w = [total[bi - 1], total[bi], total[bi + 1]];
  const r = (w[0] * bins[bi - 1] + w[1] * bins[bi] + w[2] * bins[bi + 1]) / (w[0] + w[1] + w[2]);
  return { r, strength: best / groups.size };
}
