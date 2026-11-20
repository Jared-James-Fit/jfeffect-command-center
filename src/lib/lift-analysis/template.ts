/**
 * The plate's own picture, found again in another frame (pure): masked,
 * zero-mean normalised cross-correlation (NCC). The template is the plate's
 * disc and a thin ring around its rim, cut from a frame where the plate was
 * found clearly; in another frame, the position where the picture there
 * correlates best with it is where the plate is, to a fraction of a pixel.
 *
 * Unlike following the rim alone, this keeps the plate when its edge
 * disappears against a dark bench, a rack upright or the lifter's clothes
 * (the hub, the lettering and the rest of the face still match), and it
 * can't jump onto another round thing of the same size unless that thing
 * also looks like this plate.
 */
import type { Gray } from "@/lib/lift-analysis/image";

export type Template = {
  /** Pixel offsets from the centre, inside the disc mask. */
  dx: Int16Array;
  dy: Int16Array;
  /** The template's grey values at those offsets. */
  val: Float32Array;
  n: number;
  /** Half the template's span (px): offsets lie within ±half. */
  half: number;
  /** The radius it was cut at (px). */
  r: number;
};

/** Bilinear grey value at (x, y); null outside the frame. */
function sample(img: Gray, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x > img.w - 1 || y > img.h - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(img.w - 1, x0 + 1);
  const y1 = Math.min(img.h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const p = img.px;
  const a = p[y0 * img.w + x0];
  const b = p[y0 * img.w + x1];
  const c = p[y1 * img.w + x0];
  const d = p[y1 * img.w + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** How far past the rim the template reaches (share of the radius): the rim itself is the strongest feature. */
export const RIM_REACH = 1.0;

/**
 * Cut the plate's template: every pixel within RIM_REACH radii of the
 * centre (sampled at the sub-pixel centre). Null when too little of the
 * disc is inside the frame.
 */
export function makeTemplate(img: Gray, cx: number, cy: number, r: number): Template | null {
  const R = Math.max(2, r * RIM_REACH);
  const half = Math.ceil(R);
  const dx: number[] = [];
  const dy: number[] = [];
  const val: number[] = [];
  let total = 0;
  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) {
      if (i * i + j * j > R * R) continue;
      total++;
      const v = sample(img, cx + i, cy + j);
      if (v == null) continue;
      dx.push(i);
      dy.push(j);
      val.push(v);
    }
  }
  if (dx.length < 0.6 * total || dx.length < 20) return null;
  return {
    dx: Int16Array.from(dx),
    dy: Int16Array.from(dy),
    val: Float32Array.from(val),
    n: dx.length,
    half,
    r,
  };
}

/**
 * NCC of the template centred at integer pixel (px, py): −1…1, or −2 when
 * less than 60 % of it falls inside the frame. Pixels outside are left out
 * (a plate at the edge of the picture still matches on what shows).
 */
export function nccAt(img: Gray, t: Template, px: number, py: number): number {
  const W = img.w;
  const H = img.h;
  const p = img.px;
  let sT = 0,
    sTT = 0,
    sI = 0,
    sII = 0,
    sTI = 0,
    m = 0;
  const inside = px - t.half >= 0 && py - t.half >= 0 && px + t.half < W && py + t.half < H;
  if (inside) {
    const base = py * W + px;
    for (let k = 0; k < t.n; k++) {
      const v = p[base + t.dy[k] * W + t.dx[k]];
      const tv = t.val[k];
      sT += tv;
      sTT += tv * tv;
      sI += v;
      sII += v * v;
      sTI += tv * v;
    }
    m = t.n;
  } else {
    for (let k = 0; k < t.n; k++) {
      const x = px + t.dx[k];
      const y = py + t.dy[k];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const v = p[y * W + x];
      const tv = t.val[k];
      sT += tv;
      sTT += tv * tv;
      sI += v;
      sII += v * v;
      sTI += tv * v;
      m++;
    }
    if (m < 0.6 * t.n) return -2;
  }
  const vT = sTT - (sT * sT) / m;
  const vI = sII - (sI * sI) / m;
  if (vT <= 1e-6 || vI <= 1e-6) return 0;
  return (sTI - (sT * sI) / m) / Math.sqrt(vT * vI);
}

/**
 * The template spun all the way round: each pixel the mean of the template
 * at the same distance from the centre. Plates turn on the sleeve (a
 * deadlift set down, a bar rolled) and their lettering goes with them; the
 * rim, the hub and the rings don't change, and this keeps only those, so it
 * still matches a turned plate, at the same centre.
 */
export function spunTemplate(t: Template): Template {
  const bins = new Map<number, { s: number; n: number }>();
  const key = (k: number) => Math.round(2 * Math.hypot(t.dx[k], t.dy[k]));
  for (let k = 0; k < t.n; k++) {
    const b = bins.get(key(k)) ?? { s: 0, n: 0 };
    b.s += t.val[k];
    b.n++;
    bins.set(key(k), b);
  }
  const val = new Float32Array(t.n);
  for (let k = 0; k < t.n; k++) {
    const b = bins.get(key(k))!;
    val[k] = b.s / b.n;
  }
  return { ...t, val };
}

export type Match = { x: number; y: number; score: number };

/**
 * The best match within ±s of (cx, cy) (integer positions), then refined to
 * a fraction of a pixel by a parabola through the scores either side.
 * `step` > 1 looks at every step-th position first and then around the best.
 */
export function search(img: Gray, t: Template, cx: number, cy: number, s: number, step = 1): Match {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  let bx = x0;
  let by = y0;
  let best = -3;
  const S = Math.max(0, Math.round(s));
  for (let y = y0 - S; y <= y0 + S; y += step) {
    for (let x = x0 - S; x <= x0 + S; x += step) {
      const v = nccAt(img, t, x, y);
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  if (step > 1) {
    const cx2 = bx;
    const cy2 = by;
    for (let y = cy2 - step + 1; y <= cy2 + step - 1; y++) {
      for (let x = cx2 - step + 1; x <= cx2 + step - 1; x++) {
        if (x === cx2 && y === cy2) continue;
        const v = nccAt(img, t, x, y);
        if (v > best) {
          best = v;
          bx = x;
          by = y;
        }
      }
    }
  }
  return refine(img, t, bx, by, best);
}

/** Sub-pixel peak: a parabola through the score and its neighbours, each way. */
export function refine(img: Gray, t: Template, bx: number, by: number, best: number): Match {
  if (best <= -2) return { x: bx, y: by, score: best };
  const l = nccAt(img, t, bx - 1, by);
  const r = nccAt(img, t, bx + 1, by);
  const u = nccAt(img, t, bx, by - 1);
  const d = nccAt(img, t, bx, by + 1);
  const off = (a: number, c: number) => {
    if (a <= -2 || c <= -2) return 0;
    const den = a - 2 * best + c;
    return den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  };
  return { x: bx + off(l, r), y: by + off(u, d), score: best };
}
