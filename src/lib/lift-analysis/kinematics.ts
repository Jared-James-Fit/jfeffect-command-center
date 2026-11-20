/**
 * From the bar's position over time to reps and their velocities (pure).
 *
 * Position is smoothed with a local quadratic fit over a fixed slice of time
 * around each frame (LOESS: tricube weights, the frame's real timestamp, so
 * a phone that films at an uneven rate is read right), which also gives the
 * velocity and acceleration at each frame and how much noise each carries.
 *
 * A rep's concentric is a rise of the bar: it starts when the bar is moving
 * up faster than a threshold (30 mm/s, or three times the velocity's own
 * noise) and ends at the last moment it still is, near the top; a slow grind
 * through the sticking point stays in the rep. Its mean concentric velocity
 * is the height gained over that time. The eccentric is the same going down.
 *
 * Every number carries an uncertainty, propagated from the tracking noise,
 * the timing at both ends of the phase and the calibration, and a tier:
 *   measured     calibrated, tracked through the phase, within ±8 % (95 %)
 *   estimated    a usable number with a wider margin (shown with ≈)
 *   unavailable  not supportable from this footage (never shown as a number)
 */

export type Tier = "measured" | "estimated" | "unavailable";
/** A number with its 95 % margin (same units, ±) and how far to trust it. */
export type Metric = { v: number | null; u: number | null; tier: Tier; why?: string };

export const NONE = (why: string): Metric => ({ v: null, u: null, tier: "unavailable", why });

/** Velocity threshold for "moving" (mm/s). */
export const MOVE_MM_S = 30;
/** 95 % margins up to this share of the value are "measured"; up to ESTIMATE_MAX "estimated". */
export const MEASURED_MAX = 0.08;
export const ESTIMATE_MAX = 0.25;
/** Frames per second below which peak velocity and acceleration-based numbers are only estimates. */
export const PEAK_MEASURED_FPS = 50;
const G_MM = 9810;

export type Smoothed = {
  t: number[];
  y: number[];
  v: number[];
  a: number[];
  /** Variance factors (× σ² of a raw position) for position and velocity. */
  vy: number[];
  vv: number[];
  ok: boolean[];
};

/** Local quadratic regression of y(t), weights w (0 = no reading), bandwidth h seconds either side. */
export function loess(t: number[], y: number[], w: number[], h: number): Smoothed {
  const n = t.length;
  const out: Smoothed = {
    t: [...t],
    y: new Array(n).fill(NaN),
    v: new Array(n).fill(NaN),
    a: new Array(n).fill(NaN),
    vy: new Array(n).fill(NaN),
    vv: new Array(n).fill(NaN),
    ok: new Array(n).fill(false),
  };
  let lo = 0;
  for (let i = 0; i < n; i++) {
    while (lo < n && t[lo] < t[i] - h) lo++;
    // normal equations of [1, d, d²] with kernel weights; B = Σ k² x xᵀ for the variance
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const B = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const rhs = [0, 0, 0];
    let used = 0;
    let left = 0;
    let right = 0;
    for (let j = lo; j < n && t[j] <= t[i] + h; j++) {
      if (!(w[j] > 0)) continue;
      const d = t[j] - t[i];
      const u = Math.abs(d) / h;
      if (u >= 1) continue;
      const k = w[j] * (1 - u * u * u) ** 3;
      const x = [1, d, d * d];
      for (let p = 0; p < 3; p++) {
        rhs[p] += k * x[p] * y[j];
        for (let q = 0; q < 3; q++) {
          M[p * 3 + q] += k * x[p] * x[q];
          B[p * 3 + q] += k * k * x[p] * x[q];
        }
      }
      used++;
      if (d < 0) left++;
      if (d > 0) right++;
    }
    if (used < 4 || left < 1 || right < 1) {
      // at the very ends of the clip a one-sided fit is allowed with enough points
      if (used < 5) continue;
    }
    const inv = inv3(M);
    if (!inv) continue;
    const c = [0, 1, 2].map(
      (p) => inv[p * 3] * rhs[0] + inv[p * 3 + 1] * rhs[1] + inv[p * 3 + 2] * rhs[2],
    );
    // V = inv · B · inv
    const IB = mul3(inv, B);
    const V = mul3(IB, inv);
    out.y[i] = c[0];
    out.v[i] = c[1];
    out.a[i] = 2 * c[2];
    out.vy[i] = V[0];
    out.vv[i] = V[4];
    out.ok[i] = true;
  }
  return out;
}

function inv3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-18)) return null;
  const r = [
    A,
    -(b * i - c * h),
    b * f - c * e,
    B,
    a * i - c * g,
    -(a * f - c * d),
    C,
    -(a * h - b * g),
    a * e - b * d,
  ];
  return r.map((v) => v / det);
}

function mul3(p: number[], q: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += p[i * 3 + k] * q[k * 3 + j];
  return r;
}

/** The smoothing slice for a frame rate: at least 3.5 frames either side, never under 0.1 s. */
export function bandwidthFor(fps: number): number {
  return Math.max(0.1, 3.5 / Math.max(1, fps));
}

/**
 * A narrower slice for finding when a move starts and stops: the wide one
 * spreads a sudden start over its whole width (the phase reads long and its
 * mean velocity low), so the boundaries come from a fit over about two and a
 * half frames either side.
 */
export function boundaryBandwidthFor(fps: number): number {
  return Math.max(0.04, 2.6 / Math.max(1, fps));
}

/**
 * Bridge stretches the smoothing couldn't fill (the plate hidden for a
 * moment) with a straight line between the readings either side, up to
 * `maxGap` seconds, so a rep isn't lost for want of its middle. Returns which
 * samples were bridged: never read for a peak, a sticking point or an
 * acceleration, only for counting reps and for a phase's two ends.
 */
export function bridgeGaps(s: Smoothed, maxGap: number): boolean[] {
  const n = s.t.length;
  const bridged = new Array<boolean>(n).fill(false);
  let i = 0;
  while (i < n) {
    if (s.ok[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !s.ok[j]) j++;
    const a = i - 1;
    const b = j;
    if (a >= 0 && b < n && s.t[b] - s.t[a] <= maxGap) {
      const v = (s.y[b] - s.y[a]) / (s.t[b] - s.t[a] || 1);
      const vy = Math.max(s.vy[a], s.vy[b]) * 4;
      const vv = Math.max(s.vv[a], s.vv[b]) * 16;
      for (let k = i; k < j; k++) {
        const f = (s.t[k] - s.t[a]) / (s.t[b] - s.t[a] || 1);
        s.y[k] = s.y[a] + f * (s.y[b] - s.y[a]);
        s.v[k] = v;
        s.a[k] = 0;
        s.vy[k] = vy;
        s.vv[k] = vv;
        s.ok[k] = true;
        bridged[k] = true;
      }
    }
    i = j;
  }
  return bridged;
}

export type Leg = { from: number; to: number; dir: "up" | "down" };

/**
 * The big moves up and down (indices into the smoothed series): a turn
 * counts only once the bar has come back at least `min` from its extreme,
 * so a wobble at lockout or a small unrack never splits a rep.
 */
export function legs(y: number[], ok: boolean[], min: number): Leg[] {
  const idx = y.map((_, i) => i).filter((i) => ok[i] && Number.isFinite(y[i]));
  if (idx.length < 3) return [];
  const turns: { i: number; kind: "min" | "max" }[] = [];
  let dir: "up" | "down" | null = null;
  let hi = idx[0];
  let lo = idx[0];
  for (const i of idx) {
    if (dir === null) {
      if (y[i] > y[hi]) hi = i;
      if (y[i] < y[lo]) lo = i;
      if (y[i] - y[lo] >= min) {
        turns.push({ i: lo, kind: "min" });
        dir = "up";
        hi = i;
      } else if (y[hi] - y[i] >= min) {
        turns.push({ i: hi, kind: "max" });
        dir = "down";
        lo = i;
      }
    } else if (dir === "up") {
      if (y[i] > y[hi]) hi = i;
      if (y[hi] - y[i] >= min) {
        turns.push({ i: hi, kind: "max" });
        dir = "down";
        lo = i;
      }
    } else {
      if (y[i] < y[lo]) lo = i;
      if (y[i] - y[lo] >= min) {
        turns.push({ i: lo, kind: "min" });
        dir = "up";
        hi = i;
      }
    }
  }
  if (dir === "up") turns.push({ i: hi, kind: "max" });
  if (dir === "down") turns.push({ i: lo, kind: "min" });
  const out: Leg[] = [];
  for (let k = 1; k < turns.length; k++) {
    out.push({
      from: turns[k - 1].i,
      to: turns[k].i,
      dir: turns[k].kind === "max" ? "up" : "down",
    });
  }
  return out;
}

function lerp(a: number, b: number, f: number) {
  return a + (b - a) * f;
}

/** Value of a series at time `at` (linear between samples). */
export function at(s: { t: number[] }, arr: number[], time: number): number {
  const t = s.t;
  if (time <= t[0]) return arr[0];
  if (time >= t[t.length - 1]) return arr[arr.length - 1];
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= time) lo = mid;
    else hi = mid;
  }
  const f = (time - t[lo]) / (t[hi] - t[lo] || 1);
  return lerp(arr[lo], arr[hi], f);
}

export type PhaseTimes = { start: number; end: number; iStart: number; iEnd: number };

/**
 * When a move really starts and ends: from the first moment it's going
 * faster than `vth` (in its direction) to the last, inside the leg, with the
 * crossing found between frames.
 */
export function phaseTimes(s: Smoothed, leg: Leg, vth: number): PhaseTimes | null {
  const sign = leg.dir === "up" ? 1 : -1;
  let first = -1;
  let last = -1;
  for (let i = leg.from; i <= leg.to; i++) {
    if (!s.ok[i]) continue;
    if (sign * s.v[i] > vth) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0 || last <= first) return null;
  const cross = (i: number, j: number) => {
    // between i (below) and j (above)
    const vi = sign * s.v[i];
    const vj = sign * s.v[j];
    const f = vj !== vi ? (vth - vi) / (vj - vi) : 0;
    return lerp(s.t[i], s.t[j], Math.max(0, Math.min(1, f)));
  };
  const prev = first > leg.from && s.ok[first - 1] ? first - 1 : -1;
  const next = last < leg.to && s.ok[last + 1] ? last + 1 : -1;
  const start = prev >= 0 ? cross(prev, first) : s.t[first];
  const end = next >= 0 ? cross(next, last) : s.t[last];
  return { start, end, iStart: first, iEnd: last };
}

/**
 * The phase as the lift's own movement, not every twitch in the leg: the
 * unbroken run of movement around the leg's fastest moment. A bounce or a
 * settle at the start of a pause isn't its start (a paused bench is timed
 * from when the press begins), a stall at the sticking point doesn't end it
 * (short dips under the threshold are bridged while the bar is still well
 * short of the top), and once the bar is nearly at the top a slow creep (the
 * walk back to the hooks, settling at lockout) isn't part of it: the end
 * threshold rises to a tenth of the rep's top speed there.
 */
export function mainPhase(s: Smoothed, leg: Leg, vth: number): PhaseTimes | null {
  const sign = leg.dir === "up" ? 1 : -1;
  let ip = -1;
  for (let i = leg.from; i <= leg.to; i++) {
    if (!s.ok[i]) continue;
    if (ip < 0 || sign * s.v[i] > sign * s.v[ip]) ip = i;
  }
  if (ip < 0 || sign * s.v[ip] <= vth) return null;
  const peak = sign * s.v[ip];
  const y0 = s.y[leg.from];
  const rise = sign * (s.y[leg.to] - y0);
  const progress = (i: number) => (rise > 0 ? (sign * (s.y[i] - y0)) / rise : 1);
  const v = (i: number) => (s.ok[i] ? sign * s.v[i] : -Infinity);
  // back from the peak: the run's start (a dip of a few frames is noise, a longer one is a pause)
  let first = ip;
  for (let i = ip - 1; i >= leg.from; i--) {
    if (v(i) > vth) {
      first = i;
      continue;
    }
    let j = i;
    while (j >= leg.from && v(j) <= vth && s.t[i] - s.t[j] <= 0.1) j--;
    if (j >= leg.from && v(j) > vth && s.t[i] - s.t[j] <= 0.1) {
      i = j + 1;
      continue;
    }
    break;
  }
  // forward from the peak: the run's end
  let last = ip;
  for (let i = ip + 1; i <= leg.to; i++) {
    const nearTop = progress(i) >= 0.85;
    const th = nearTop ? Math.max(vth, 0.1 * peak) : vth;
    if (v(i) > th) {
      last = i;
      continue;
    }
    if (nearTop) break;
    // a stall at the sticking point: bridged when the bar moves on within 0.35 s
    let j = i;
    while (j <= leg.to && v(j) <= vth && s.t[j] - s.t[i] <= 0.35) j++;
    if (j <= leg.to && v(j) > vth && s.t[j] - s.t[i] <= 0.35) {
      i = j - 1;
      continue;
    }
    break;
  }
  if (last <= first) return null;
  const thEnd = progress(last) >= 0.85 ? Math.max(vth, 0.1 * peak) : vth;
  const cross = (i: number, j: number, th: number) => {
    const vi = sign * s.v[i];
    const vj = sign * s.v[j];
    const f = vj !== vi ? (th - vi) / (vj - vi) : 0;
    return lerp(s.t[i], s.t[j], Math.max(0, Math.min(1, f)));
  };
  const prev = first > leg.from && s.ok[first - 1] ? first - 1 : -1;
  const next = last < leg.to && s.ok[last + 1] ? last + 1 : -1;
  const start = prev >= 0 ? cross(prev, first, vth) : s.t[first];
  const end = next >= 0 ? cross(next, last, thEnd) : s.t[last];
  return { start, end, iStart: first, iEnd: last };
}

/**
 * Sub-frame start of a move from rest (or stop into rest), from the raw
 * positions: at 30 fps the bar can be still in one frame and moving in the
 * next, and any smoothing puts the start somewhere in that 33 ms gap, early.
 * A hinge fits the raw points instead: flat, then rising as ½·a·t² from
 * t0 (mirrored for a stop). The threshold crossing is then t0 + vth / (2k).
 * Only used when the bar really was at rest on that side (a pause, a
 * lockout); a touch-and-go reversal keeps the smoothed crossing, which is
 * unbiased there. Null when the hinge doesn't fit.
 */
export function refineBoundary(
  raw: { t: number[]; y: number[]; found: boolean[] },
  s: Smoothed,
  coarse: number,
  vth: number,
  sign: 1 | -1,
  kind: "start" | "end",
  peakV: number,
  dt: number,
): number | null {
  const n = raw.t.length;
  // rest on the outside of the boundary: the smoothed speed stays under the threshold for 0.12 s
  const restFrom = kind === "start" ? coarse - 0.2 : coarse + 0.05;
  const restTo = kind === "start" ? coarse - 0.05 : coarse + 0.2;
  let restN = 0;
  for (let i = 0; i < n; i++) {
    if (raw.t[i] < restFrom || raw.t[i] > restTo || !s.ok[i]) continue;
    if (Math.abs(s.v[i]) > vth) return null;
    restN++;
  }
  if (restN < 2) return null;
  // the moving side: until the bar reaches 40 % of its top speed (the hinge's ½·a·t² holds early on)
  const idx: number[] = [];
  if (kind === "start") {
    for (let i = 0; i < n; i++) {
      if (raw.t[i] < coarse - 0.25 || !raw.found[i]) continue;
      if (raw.t[i] > coarse && s.ok[i] && sign * s.v[i] > 0.4 * peakV) break;
      if (raw.t[i] > coarse + 0.3) break;
      idx.push(i);
    }
  } else {
    for (let i = n - 1; i >= 0; i--) {
      if (raw.t[i] > coarse + 0.25 || !raw.found[i]) continue;
      if (raw.t[i] < coarse && s.ok[i] && sign * s.v[i] > 0.4 * peakV) break;
      if (raw.t[i] < coarse - 0.3) break;
      idx.push(i);
    }
    idx.reverse();
  }
  if (idx.length < 6) return null;
  let best = { sse: Infinity, t0: NaN, k: NaN };
  for (let t0 = coarse - 1.5 * dt; t0 <= coarse + 1.5 * dt + 1e-9; t0 += dt / 20) {
    // y = c + k·d², d = how far past t0 the bar has been moving
    let s1 = 0,
      sd = 0,
      sdd = 0,
      sy = 0,
      syd = 0;
    for (const i of idx) {
      const d = kind === "start" ? Math.max(0, raw.t[i] - t0) : Math.max(0, t0 - raw.t[i]);
      const q = d * d;
      s1 += 1;
      sd += q;
      sdd += q * q;
      sy += raw.y[i];
      syd += raw.y[i] * q;
    }
    const det = s1 * sdd - sd * sd;
    if (!(Math.abs(det) > 1e-15)) continue;
    const c = (sy * sdd - syd * sd) / det;
    const k = (s1 * syd - sd * sy) / det;
    let sse = 0;
    for (const i of idx) {
      const d = kind === "start" ? Math.max(0, raw.t[i] - t0) : Math.max(0, t0 - raw.t[i]);
      sse += (raw.y[i] - c - k * d * d) ** 2;
    }
    if (sse < best.sse) best = { sse, t0, k };
  }
  if (!Number.isFinite(best.t0)) return null;
  // the right way: rising after a start going up (or falling going down), the mirror for a stop
  const slope = kind === "start" ? sign * best.k : -sign * best.k;
  if (!(slope > 0)) return null;
  const out =
    kind === "start"
      ? best.t0 + vth / (2 * Math.abs(best.k))
      : best.t0 - vth / (2 * Math.abs(best.k));
  return Math.abs(out - coarse) <= 1.5 * dt ? out : null;
}

export type Scale = {
  ok: boolean;
  mmPerPxY: number;
  mmPerPxX: number;
  relErr: number;
  relErrX: number;
};

export type RepMetrics = {
  n: number;
  /** False when the bar stopped well short of where the other reps finished (a missed or partial rep). */
  complete: boolean;
  dir: "lower_first" | "lift_first";
  con: { start: number; end: number };
  ecc: { start: number; end: number } | null;
  /** Mean concentric velocity (m/s). */
  mcv: Metric;
  /** Peak concentric velocity (m/s) and where it came, as a share of the rep's height. */
  peak: Metric & { at: number | null };
  /** Mean propulsive velocity (m/s): the concentric up to where the bar starts decelerating faster than gravity. */
  mpv: Metric;
  /** Time to peak velocity (s). */
  toPeak: Metric;
  conDur: Metric;
  eccDur: Metric;
  /** Mean eccentric (lowering) speed (m/s). */
  eccSpeed: Metric;
  /** Time still at the bottom between lowering and lifting (s). */
  pause: Metric;
  /** Vertical range of the rep (mm when calibrated). */
  rom: Metric;
  /** Bottom and top of the rep (mm or px up, the series' own zero). */
  bottom: number;
  top: number;
  /** Horizontal bar movement during the concentric (mm): net, and the most it strayed from where it started. */
  xShift: Metric;
  xDev: Metric;
  /** The slowest point after the first velocity peak, when there is a clear one. */
  sticking: { at: number; height: Metric; dip: number; time: number } | null;
  /** Share of the concentric's frames where the plate was found. */
  coverage: number;
};

/** A metric from a value and its relative 1-σ uncertainty. */
export function metric(
  v: number,
  rel: number,
  opts: { measuredMax?: number; estimateMax?: number; forceEstimate?: string; abs?: number } = {},
): Metric {
  if (!Number.isFinite(v)) return NONE("not_measurable");
  const u95 = opts.abs != null ? 2 * opts.abs : 2 * Math.abs(rel * v);
  const share = opts.abs != null ? (v !== 0 ? u95 / Math.abs(v) : Infinity) : 2 * rel;
  const measuredMax = opts.measuredMax ?? MEASURED_MAX;
  const estimateMax = opts.estimateMax ?? ESTIMATE_MAX;
  if (!(share <= estimateMax) && opts.abs == null) return NONE("too_uncertain");
  const tier: Tier = share <= measuredMax && !opts.forceEstimate ? "measured" : "estimated";
  return {
    v,
    u: u95,
    tier,
    ...(opts.forceEstimate && tier === "estimated" ? { why: opts.forceEstimate } : {}),
  };
}

export type RepInput = {
  /** The raw positions (series units), for sub-frame starts and stops. */
  raw?: { t: number[]; y: number[]; found: boolean[] };
  s: Smoothed;
  /** The same positions smoothed over a narrower slice: where phases start and end. */
  sb?: Smoothed;
  sx: Smoothed;
  /** Raw position noise (1 σ, in the series' units). */
  sigma: number;
  fps: number;
  scale: Scale;
  /** Units of the series: "mm" when calibrated, "px" otherwise. */
  units: "mm" | "px";
  found: boolean[];
  /** Samples bridged across a gap (bridgeGaps): no peak, sticking point or acceleration is read from them. */
  bridged?: boolean[];
  /** Hint: which way a rep goes (from the exercise), else read from the clip. */
  dirHint?: "lower_first" | "lift_first";
  /** Smallest move that counts as a rep (series units). */
  minRom: number;
};

/**
 * Which way a rep goes, read from where the bar rests: before and after a set
 * lowered first (squat, bench) it sits up in the hooks or at lockout; a set
 * lifted first (deadlift) starts and ends on the floor. Only when that's
 * unclear, the first big move decides.
 */
export function restingDirection(s: Smoothed, allLegs: Leg[]): "lower_first" | "lift_first" {
  const idx: number[] = [];
  for (let i = 0; i < s.y.length; i++) if (s.ok[i] && Number.isFinite(s.y[i])) idx.push(i);
  const fallback = allLegs[0]?.dir === "down" ? "lower_first" : "lift_first";
  if (idx.length < 20) return fallback;
  const ys = idx.map((i) => s.y[i]).sort((a, b) => a - b);
  const lo = ys[Math.floor(ys.length * 0.05)];
  const hi = ys[Math.floor(ys.length * 0.95)];
  if (!(hi > lo)) return fallback;
  const edge = Math.max(3, Math.floor(idx.length * 0.12));
  const ends = [...idx.slice(0, edge), ...idx.slice(-edge)]
    .map((i) => s.y[i])
    .sort((a, b) => a - b);
  const rest = (ends[ends.length >> 1] - lo) / (hi - lo);
  if (rest >= 0.65) return "lower_first";
  if (rest <= 0.35) return "lift_first";
  return fallback;
}

export function analyzeReps(input: RepInput): RepMetrics[] {
  const { s, sx, sigma, fps, scale, units, found } = input;
  const sb = input.sb ?? s;
  const bridged = input.bridged ?? [];
  /** A smoothed sample read from the plate itself (not bridged). */
  const real = (i: number) => s.ok[i] && !bridged[i];
  const ys = s.y.filter((v, i) => s.ok[i] && Number.isFinite(v)).sort((a, b) => a - b);
  if (ys.length < 10) return [];
  const range = ys[Math.floor(ys.length * 0.98)] - ys[Math.floor(ys.length * 0.02)];
  const min = Math.max(input.minRom, 0.3 * range);
  const allLegs = legs(s.y, s.ok, min);
  if (!allLegs.length) return [];
  // the velocity noise: from the smoothing's own variance where the bar is tracked
  const vvs = s.vv.filter((v, i) => s.ok[i] && Number.isFinite(v)).sort((a, b) => a - b);
  const sigmaV = sigma * Math.sqrt(vvs[vvs.length >> 1] ?? 0);
  const peakAll = Math.max(...s.v.filter((v, i) => s.ok[i] && Number.isFinite(v)).map(Math.abs));
  const vth =
    units === "mm" ? Math.max(MOVE_MM_S, 3 * sigmaV) : Math.max(3 * sigmaV, 0.04 * peakAll);
  const vvb = sb.vv.filter((v, i) => sb.ok[i] && Number.isFinite(v)).sort((a, b) => a - b);
  const sigmaVb = sigma * Math.sqrt(vvb[vvb.length >> 1] ?? 0);
  const vthB =
    units === "mm" ? Math.max(MOVE_MM_S, 3 * sigmaVb) : Math.max(3 * sigmaVb, 0.04 * peakAll);
  const dir: "lower_first" | "lift_first" = input.dirHint ?? restingDirection(s, allLegs);
  const dt = 1 / Math.max(1, fps);
  // the reps: for a lift lowered first, a rise right after a descent (the unrack before the first
  // descent, the walk back to the hooks after the last rise aren't reps); either way a rep moves
  // at least about half as far as the set's typical rep
  const cands = allLegs
    .map((l, k) => ({ l, k }))
    .filter(
      (x) =>
        x.l.dir === "up" && (dir !== "lower_first" || (x.k > 0 && allLegs[x.k - 1].dir === "down")),
    );
  const riseOf = (l: Leg) => s.y[l.to] - s.y[l.from];
  const typical = [...cands.map((x) => riseOf(x.l))].sort((a, b) => a - b)[cands.length >> 1] ?? 0;
  const dropBefore = (k: number) =>
    k > 0 && allLegs[k - 1].dir === "down" ? s.y[allLegs[k - 1].from] - s.y[allLegs[k - 1].to] : 0;
  const full = cands.filter(
    (x) =>
      riseOf(x.l) >= 0.55 * typical && (dir !== "lower_first" || dropBefore(x.k) >= 0.55 * typical),
  );
  // a missed rep: the bar went all the way down (or left the floor, lifted first), came up part
  // way and went back down; counted (and never complete), so a set with one is never averaged
  const bottoms = full.map(({ l }) => s.y[l.from]).sort((a, b) => a - b);
  const bottomRef = bottoms[bottoms.length >> 1];
  const missed = cands.filter((x) => {
    if (full.includes(x)) return false;
    const rise = riseOf(x.l);
    if (rise < 0.3 * typical || bottomRef == null) return false;
    const fellBack = x.k + 1 < allLegs.length && allLegs[x.k + 1].dir === "down";
    if (!fellBack) return false;
    return dir === "lower_first"
      ? dropBefore(x.k) >= 0.55 * typical
      : Math.abs(s.y[x.l.from] - bottomRef) <= 0.15 * typical;
  });
  const ups = [...full, ...missed].sort((a, b) => a.k - b.k);
  const tops = ups.map(({ l }) => s.y[l.to]);
  const sortedTops = [...tops].sort((a, b) => a - b);
  const topRef = sortedTops[Math.floor(sortedTops.length * 0.75)] ?? 0;
  const roms = ups.map(({ l }) => s.y[l.to] - s.y[l.from]).sort((a, b) => a - b);
  const romRef = roms[roms.length >> 1] ?? 0;
  const out: RepMetrics[] = [];
  const toMs = units === "mm" ? 0.001 : 1; // mm/s → m/s; px/s stays px/s
  for (const { l, k } of ups) {
    const ph0 = mainPhase(sb, l, vthB);
    if (!ph0) continue;
    let ph = ph0;
    let refinedStart = false;
    let refinedEnd = false;
    if (input.raw) {
      let pk = 0;
      for (let i = ph0.iStart; i <= ph0.iEnd; i++) if (s.ok[i]) pk = Math.max(pk, s.v[i]);
      const rs = refineBoundary(input.raw, s, ph0.start, vthB, 1, "start", pk, dt);
      const re = refineBoundary(input.raw, s, ph0.end, vthB, 1, "end", pk, dt);
      refinedStart = rs != null;
      refinedEnd = re != null;
      ph = { ...ph0, start: rs ?? ph0.start, end: re ?? ph0.end };
    }
    const yStart = at(s, s.y, ph.start);
    const yEnd = at(s, s.y, ph.end);
    const T = ph.end - ph.start;
    const D = yEnd - yStart;
    if (!(T > 0) || !(D > 0)) continue;
    // how much of the phase was really tracked
    let seen = 0;
    let total = 0;
    let longestGap = 0;
    let gap = 0;
    for (let i = ph.iStart; i <= ph.iEnd; i++) {
      total++;
      if (found[i]) {
        seen++;
        gap = 0;
      } else {
        gap++;
        longestGap = Math.max(longestGap, gap);
      }
    }
    const coverage = total ? seen / total : 0;
    const gapS = longestGap * dt;
    const trackedOk = coverage >= 0.75 && gapS <= 0.15;
    // where the rep starts and stops has to be seen: a plate lost around either end means the
    // time or the height is a guess, and a mean velocity from a guessed end is no number at all
    const endSeen = (time: number) => {
      let i0 = 0;
      while (i0 < s.t.length - 1 && s.t[i0 + 1] <= time) i0++;
      if (i0 < s.t.length - 1 && Math.abs(s.t[i0 + 1] - time) < Math.abs(s.t[i0] - time)) i0++;
      for (let i = Math.max(0, i0 - 2); i <= Math.min(s.t.length - 1, i0 + 2); i++)
        if (!found[i]) return false;
      return true;
    };
    const endsSeen = endSeen(ph.start) && endSeen(ph.end);
    // uncertainty: the position at both ends, when each end happened, the scale
    const sd = sigma * Math.sqrt((at(s, s.vy, ph.start) || 0) + (at(s, s.vy, ph.end) || 0));
    // a boundary is good to about half a frame from the smoothing (a fifth when the hinge found it)
    const timeErr = (time: number, refined = false) => {
      const acc = Math.abs(at(sb, sb.a, time));
      const sv = sigma * Math.sqrt(Math.max(0, at(sb, sb.vv, time) || 0));
      const fromNoise = acc > 0 ? sv / acc : 1.5 * dt;
      return Math.min(1.5 * dt, Math.sqrt(fromNoise ** 2 + ((refined ? 0.2 : 0.5) * dt) ** 2));
    };
    const st = Math.sqrt(timeErr(ph.start, refinedStart) ** 2 + timeErr(ph.end, refinedEnd) ** 2);
    const scaleRel = units === "mm" ? scale.relErr : 0;
    const relMcv = Math.sqrt((sd / D) ** 2 + (st / T) ** 2 + scaleRel ** 2);
    const mcvV = (D / T) * toMs;
    const notTracked = !trackedOk ? "plate_hidden" : undefined;
    // the plate hidden for long enough inside the rise: its peak and sticking point weren't seen
    const blind = gapS > 0.15;
    const mcv: Metric =
      units !== "mm"
        ? NONE("not_calibrated")
        : !endsSeen
          ? NONE("plate_hidden")
          : notTracked
            ? {
                ...metric(mcvV, relMcv, { forceEstimate: notTracked }),
                tier: "estimated",
                why: notTracked,
              }
            : metric(mcvV, relMcv);
    // peak: the fastest smoothed velocity; smoothing takes a little off a sharp peak, more at low frame rates
    let pi = ph.iStart;
    for (let i = ph.iStart; i <= ph.iEnd; i++)
      if (real(i) && (!real(pi) || s.v[i] > s.v[pi])) pi = i;
    const peakV = s.v[pi];
    const peakSigma = sigma * Math.sqrt(Math.max(0, s.vv[pi]));
    const smoothBias = fps >= 100 ? 0.015 : fps >= PEAK_MEASURED_FPS ? 0.025 : 0.05;
    const relPeak = Math.sqrt((peakSigma / peakV) ** 2 + smoothBias ** 2 + scaleRel ** 2);
    const lowFps = fps < PEAK_MEASURED_FPS ? "low_fps" : undefined;
    const peakAt = (s.y[pi] - yStart) / D;
    const peak =
      units !== "mm" || blind
        ? {
            ...NONE(blind ? "plate_hidden" : "not_calibrated"),
            at: blind ? null : Math.max(0, Math.min(1, peakAt)),
          }
        : {
            ...metric(peakV * toMs, relPeak, { forceEstimate: lowFps ?? notTracked }),
            at: Math.max(0, Math.min(1, peakAt)),
          };
    // mean propulsive velocity: until the bar decelerates faster than gravity (heavy reps: the whole concentric)
    let mpv: Metric = NONE(
      units !== "mm" ? "not_calibrated" : blind ? "plate_hidden" : "not_measurable",
    );
    if (units === "mm" && !blind) {
      let pEnd = ph.end;
      for (let i = pi; i <= ph.iEnd; i++) {
        if (real(i) && s.a[i] < -G_MM) {
          pEnd = s.t[i];
          break;
        }
      }
      const yP = at(s, s.y, pEnd);
      const Tp = pEnd - ph.start;
      if (Tp > 0 && yP > yStart) {
        const relMpv = Math.sqrt(relMcv ** 2 + (pEnd < ph.end ? ((1.5 * dt) / Tp) ** 2 : 0));
        mpv = metric(((yP - yStart) / Tp) * toMs, relMpv, { forceEstimate: lowFps ?? notTracked });
      }
    }
    // the duration's margin comes from timing alone (no scale), so it's measured whenever the timing is good
    const conDur = metric(T, st / T, { forceEstimate: notTracked });
    const toPeak = metric(
      s.t[pi] - ph.start,
      Math.sqrt(timeErr(ph.start) ** 2 + (0.5 * dt) ** 2) / Math.max(dt, s.t[pi] - ph.start),
      { forceEstimate: lowFps ?? notTracked, estimateMax: 0.6 },
    );
    // the eccentric belonging to this rep: just before it (lowered first) or just after (lifted first)
    const eLeg = dir === "lower_first" ? allLegs[k - 1] : allLegs[k + 1];
    let ecc: { start: number; end: number } | null = null;
    let eccDur: Metric = NONE("no_eccentric");
    let eccSpeed: Metric = NONE("no_eccentric");
    let pause: Metric = NONE("no_eccentric");
    if (eLeg && eLeg.dir === "down") {
      const ep0 = mainPhase(sb, eLeg, vthB);
      let ep = ep0;
      let eRefS = false;
      let eRefE = false;
      if (ep0 && input.raw) {
        let pk = 0;
        for (let i = ep0.iStart; i <= ep0.iEnd; i++) if (s.ok[i]) pk = Math.max(pk, -s.v[i]);
        const rs = refineBoundary(input.raw, s, ep0.start, vthB, -1, "start", pk, dt);
        const re = refineBoundary(input.raw, s, ep0.end, vthB, -1, "end", pk, dt);
        eRefS = rs != null;
        eRefE = re != null;
        ep = { ...ep0, start: rs ?? ep0.start, end: re ?? ep0.end };
      }
      if (ep) {
        ecc = { start: ep.start, end: ep.end };
        const Te = ep.end - ep.start;
        const De = at(s, s.y, ep.start) - at(s, s.y, ep.end);
        const ste = Math.sqrt(timeErr(ep.start, eRefS) ** 2 + timeErr(ep.end, eRefE) ** 2);
        eccDur = metric(Te, ste / Te);
        if (units === "mm" && De > 0) {
          const sde = sigma * Math.sqrt((at(s, s.vy, ep.start) || 0) + (at(s, s.vy, ep.end) || 0));
          eccSpeed = metric(
            (De / Te) * toMs,
            Math.sqrt((sde / De) ** 2 + (ste / Te) ** 2 + scaleRel ** 2),
          );
        } else if (units !== "mm") eccSpeed = NONE("not_calibrated");
        if (dir === "lower_first") {
          const p = ph.start - ep.end;
          pause =
            p >= 0 && p < 8
              ? metric(p, 0, {
                  abs: Math.sqrt(
                    timeErr(ep.end, eRefE) ** 2 + timeErr(ph.start, refinedStart) ** 2,
                  ),
                })
              : NONE("no_pause");
          if (pause.v != null && pause.u != null && pause.v < pause.u)
            pause = { v: 0, u: pause.u, tier: pause.tier };
        }
      }
    }
    // the rep's range: what the bar travelled while pressing (a VBT device's concentric
    // displacement), not the leg's extremes, which take in a settle at the bottom or a creep at the top
    const bottom = yStart;
    const top = yEnd;
    const romV = top - bottom;
    const romSd = sd;
    const rom =
      units === "mm"
        ? metric(romV, Math.sqrt((romSd / romV) ** 2 + scaleRel ** 2), {
            forceEstimate: notTracked,
          })
        : NONE("not_calibrated");
    // horizontal bar movement during the concentric
    let xShift: Metric = NONE(units !== "mm" ? "not_calibrated" : "not_measurable");
    let xDev: Metric = xShift;
    if (units === "mm" && sx.ok[ph.iStart] && sx.ok[ph.iEnd]) {
      const x0 = at(sx, sx.y, ph.start);
      const x1 = at(sx, sx.y, ph.end);
      let dev = 0;
      for (let i = ph.iStart; i <= ph.iEnd; i++)
        if (sx.ok[i]) dev = Math.max(dev, Math.abs(sx.y[i] - x0));
      const sdx = sigma * Math.SQRT2 * Math.sqrt(Math.max(0, sx.vy[ph.iStart] || 0));
      const abs = Math.sqrt(sdx ** 2 + 1);
      const sideways = scale.relErrX > 0.05 ? "camera_turned" : notTracked;
      xShift = {
        ...metric(x1 - x0, 0, { abs: Math.hypot(abs, Math.abs(x1 - x0) * scale.relErrX) }),
        ...(sideways ? { tier: "estimated" as Tier, why: sideways } : {}),
      };
      xDev = {
        ...metric(dev, 0, { abs: Math.hypot(abs, dev * scale.relErrX) }),
        ...(sideways ? { tier: "estimated" as Tier, why: sideways } : {}),
      };
    }
    // the sticking point: after the first velocity peak, the slowest point before the bar speeds up again
    let sticking: RepMetrics["sticking"] = null;
    if (!blind) {
      let firstPeak = -1;
      for (let i = ph.iStart + 1; i < ph.iEnd; i++) {
        if (!real(i - 1) || !real(i) || !real(i + 1)) continue;
        if (s.v[i] >= s.v[i - 1] && s.v[i] > s.v[i + 1] && s.v[i] >= 0.3 * peakV) {
          firstPeak = i;
          break;
        }
      }
      if (firstPeak > 0) {
        let minI = firstPeak;
        const noiseV = 3 * sigmaV;
        for (let i = firstPeak; i <= ph.iEnd; i++) {
          if (!real(i)) continue;
          if (s.v[i] < s.v[minI]) minI = i;
          const dipped = s.v[firstPeak] - s.v[minI];
          const recovered = s.v[i] - s.v[minI];
          if (
            dipped >= Math.max(0.08 * s.v[firstPeak], noiseV) &&
            recovered >= Math.max(0.12 * s.v[minI], noiseV)
          ) {
            const h = s.y[minI] - yStart;
            const hSd = sigma * Math.sqrt(s.vy[minI] || 0) + (s.v[minI] * dt) / 2;
            sticking = {
              at: Math.max(0, Math.min(1, h / D)),
              height:
                units === "mm"
                  ? metric(h, 0, { abs: Math.hypot(hSd, h * scaleRel) })
                  : NONE("not_calibrated"),
              dip: (s.v[firstPeak] - s.v[minI]) / s.v[firstPeak],
              time: s.t[minI],
            };
            break;
          }
        }
      }
    }
    out.push({
      n: out.length + 1,
      complete: top >= topRef - Math.max(0.15 * romRef, units === "mm" ? 40 : 0),
      dir,
      con: { start: ph.start, end: ph.end },
      ecc,
      mcv,
      peak,
      mpv,
      toPeak,
      conDur,
      eccDur,
      eccSpeed,
      pause,
      rom,
      bottom,
      top,
      xShift,
      xDev,
      sticking,
      coverage,
    });
  }
  return out;
}
