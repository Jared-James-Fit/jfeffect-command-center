/**
 * What bar speed to expect for a set (pure): the athlete's own load–velocity
 * relationship for one exercise, from their own measured sets and nothing
 * else (never a population table, never a universal threshold).
 *
 * One definition throughout: the set-average mean concentric velocity (m/s)
 * the video engine logs (verdict.ts), from reads it accepted. Speeds typed in
 * from a device are left out: a device's number for a multi-rep set is its
 * own choice of rep (often the last), so mixing the two would compare
 * different things.
 *
 * The model is a weighted least-squares line, v = a + b·load (+ c·(reps − 1)
 * when the athlete has filmed enough different rep counts to learn how much
 * a longer set slows the average), recent sets counting more. It says
 * nothing (`ok: false` with why) unless it has earned a number:
 *   - at least MIN_SETS sets from MIN_SESSIONS sessions in the last
 *     WINDOW_DAYS;
 *   - a slope only when the loads span enough of a range and the line
 *     clearly falls (heavier is slower, t ≤ −2); otherwise a flat estimate
 *     that is only offered near the loads it was measured at;
 *   - never outside the loads (± EXTRAPOLATE) or rep counts it has seen;
 *   - never with a 95 % prediction interval wider than ±MAX_HALF_WIDTH.
 * Sets already measured today shift the line by their average difference
 * from it (shrunk toward zero until there are several), which is what "today
 * is a fast / slow day" means in numbers.
 */

export type VelocitySample = {
  /** The set's load (kg). */
  loadKg: number;
  reps: number;
  /** Set-average mean concentric velocity (m/s), video-measured and accepted. */
  mcv: number;
  /** When the set was done (ISO). */
  at: string;
  /** The workout it was in (sets of one session aren't independent days). */
  session: string;
};

export const MODEL_RULES = {
  WINDOW_DAYS: 180,
  HALF_LIFE_DAYS: 60,
  MIN_SETS: 5,
  MIN_SESSIONS: 2,
  /** A slope needs the loads to span at least this share of their mean, and 10 kg. */
  MIN_LOAD_SPREAD: 0.1,
  MIN_LOAD_SPREAD_KG: 10,
  /** How far past the loads it has seen it will speak (share of the nearest end). */
  EXTRAPOLATE: 0.05,
  /** A flat estimate is offered only this close to the loads it came from. */
  FLAT_NEAR: 0.04,
  /** The widest 95 % prediction interval worth showing (± m/s). */
  MAX_HALF_WIDTH: 0.1,
  /** Rep counts: a learned rep effect needs this many distinct counts with 2+ sets each. */
  REP_LEVELS: 2,
} as const;

export type VelocityModel =
  | {
      ok: true;
      kind: "line" | "flat";
      a: number;
      b: number;
      c: number;
      /** Residual standard deviation (m/s) and the pieces for the prediction interval. */
      s: number;
      n: number;
      sessions: number;
      loadRange: [number, number];
      repsRange: [number, number];
      /** Weighted means and spread for the interval. */
      meanLoad: number;
      sxx: number;
      sumW: number;
    }
  | {
      ok: false;
      why: "too_few_sets" | "too_few_sessions" | "noisy";
      n: number;
      sessions: number;
    };

export type VelocityPrediction = {
  /** Expected set-average MCV (m/s, 2 decimals shown). */
  v: number;
  /** 95 % prediction interval. */
  lo: number;
  hi: number;
  sets: number;
  sessions: number;
  /** The line was moved by sets measured earlier today. */
  today: boolean;
};

const DAY = 86_400_000;

function weight(at: string, now: number): number {
  const age = Math.max(0, (now - Date.parse(at)) / DAY);
  return 0.5 ** (age / MODEL_RULES.HALF_LIFE_DAYS);
}

/** Solve a small symmetric system (Gaussian elimination with partial pivoting). */
function solve(A: number[][], y: number[]): number[] | null {
  const n = y.length;
  const M = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = Array.from({ length: n }, (_, i) => (i === j ? 1 : 0));
    const x = solve(A, e);
    if (!x) return null;
    cols.push(x);
  }
  return A.map((_, i) => cols.map((c) => c[i]));
}

/** Fit the athlete's load–velocity line for one exercise. */
export function fitLoadVelocity(
  samples: readonly VelocitySample[],
  now: number = Date.now(),
): VelocityModel {
  const use = samples.filter(
    (s) =>
      Number.isFinite(s.loadKg) &&
      s.loadKg > 0 &&
      Number.isFinite(s.mcv) &&
      s.mcv > 0 &&
      s.mcv <= 3.5 &&
      s.reps >= 1 &&
      now - Date.parse(s.at) <= MODEL_RULES.WINDOW_DAYS * DAY,
  );
  const sessions = new Set(use.map((s) => s.session)).size;
  if (use.length < MODEL_RULES.MIN_SETS)
    return { ok: false, why: "too_few_sets", n: use.length, sessions };
  if (sessions < MODEL_RULES.MIN_SESSIONS)
    return { ok: false, why: "too_few_sessions", n: use.length, sessions };

  const w = use.map((s) => weight(s.at, now));
  const sumW = w.reduce((a, b) => a + b, 0);
  const meanLoad = use.reduce((a, s, i) => a + w[i] * s.loadKg, 0) / sumW;
  const loads = use.map((s) => s.loadKg);
  const loadRange: [number, number] = [Math.min(...loads), Math.max(...loads)];
  const reps = use.map((s) => s.reps);
  const repsRange: [number, number] = [Math.min(...reps), Math.max(...reps)];
  const spread = loadRange[1] - loadRange[0];
  const wideEnough =
    spread >= Math.max(MODEL_RULES.MIN_LOAD_SPREAD * meanLoad, MODEL_RULES.MIN_LOAD_SPREAD_KG);
  const repCounts = new Map<number, number>();
  for (const r of reps) repCounts.set(r, (repCounts.get(r) ?? 0) + 1);
  const repLevels = [...repCounts.values()].filter((k) => k >= 2).length;
  const useReps = wideEnough && repLevels >= MODEL_RULES.REP_LEVELS;

  // design: [1, load − mean, (reps − 1)]
  const rows = use.map((s) => {
    const r = [1];
    if (wideEnough) r.push(s.loadKg - meanLoad);
    if (useReps) r.push(s.reps - 1);
    return r;
  });
  const p = rows[0].length;
  const XtWX = Array.from({ length: p }, () => Array(p).fill(0));
  const XtWy = Array(p).fill(0);
  rows.forEach((r, i) => {
    for (let a = 0; a < p; a++) {
      XtWy[a] += w[i] * r[a] * use[i].mcv;
      for (let b = 0; b < p; b++) XtWX[a][b] += w[i] * r[a] * r[b];
    }
  });
  const beta = solve(XtWX, XtWy);
  if (!beta) return { ok: false, why: "noisy", n: use.length, sessions };
  const fitted = rows.map((r) => r.reduce((acc, x, k) => acc + x * beta[k], 0));
  const sse = use.reduce((acc, s, i) => acc + w[i] * (s.mcv - fitted[i]) ** 2, 0);
  // effective sample size for the weighted residual variance
  const nEff = sumW ** 2 / w.reduce((a, x) => a + x * x, 0);
  const dof = Math.max(1, nEff - p);
  const s = Math.max(0.01, Math.sqrt(sse / sumW) * Math.sqrt(nEff / dof));
  const sxx = use.reduce((acc, x, i) => acc + w[i] * (x.loadKg - meanLoad) ** 2, 0);

  let kind: "line" | "flat" = "flat";
  let b = 0;
  if (wideEnough) {
    const inv = invert(XtWX);
    const seB = inv ? Math.sqrt(Math.max(0, inv[1][1])) * s : Infinity;
    // heavier must be slower, clearly: anything else is noise or a mix of different lifts
    if (beta[1] < 0 && beta[1] / seB <= -2) {
      kind = "line";
      b = beta[1];
    }
  }
  const c = useReps && kind === "line" ? beta[2] : 0;
  // refit as flat when the slope wasn't earned (the intercept is then the weighted mean)
  const a = kind === "line" ? beta[0] : use.reduce((acc, x, i) => acc + w[i] * x.mcv, 0) / sumW;
  const sFlat =
    kind === "line"
      ? s
      : Math.max(
          0.01,
          Math.sqrt(use.reduce((acc, x, i) => acc + w[i] * (x.mcv - a) ** 2, 0) / sumW) *
            Math.sqrt(nEff / Math.max(1, nEff - 1)),
        );
  return {
    ok: true,
    kind,
    a,
    b,
    c,
    s: sFlat,
    n: use.length,
    sessions,
    loadRange,
    repsRange,
    meanLoad,
    sxx,
    sumW,
  };
}

/** The expected set-average velocity for a set, or null when the model can't speak for it. */
export function predictVelocity(
  model: VelocityModel,
  loadKg: number,
  reps: number,
  today: readonly { loadKg: number; reps: number; mcv: number }[] = [],
): VelocityPrediction | null {
  if (!model.ok || !(loadKg > 0) || !(reps >= 1)) return null;
  const [lo, hi] = model.loadRange;
  const margin = model.kind === "flat" ? MODEL_RULES.FLAT_NEAR : MODEL_RULES.EXTRAPOLATE;
  if (loadKg < lo * (1 - margin) || loadKg > hi * (1 + margin)) return null;
  // rep counts it hasn't seen (±1 when it learned how reps change the average, exactly otherwise)
  const repSlack = model.c !== 0 ? 1 : 0;
  if (reps < model.repsRange[0] - repSlack || reps > model.repsRange[1] + repSlack) return null;
  const line = (L: number, r: number) =>
    model.a + model.b * (model.kind === "line" ? L - model.meanLoad : 0) + model.c * (r - 1);
  // today's measured sets: how far off the line today runs, shrunk until there are a few
  const offs = today
    .filter((t) => t.loadKg > 0 && t.mcv > 0)
    .map((t) => t.mcv - line(t.loadKg, t.reps));
  const shift = offs.length
    ? (offs.reduce((a, b) => a + b, 0) / offs.length) * (offs.length / (offs.length + 1))
    : 0;
  const v = line(loadKg, reps) + shift;
  // the line's own uncertainty at this load: its level (1 / Σw) and its slope ((L − L̄)² / Sxx)
  const lev =
    1 / Math.max(1, model.sumW) +
    (model.kind === "line" && model.sxx > 0 ? (loadKg - model.meanLoad) ** 2 / model.sxx : 0);
  const half = 2 * model.s * Math.sqrt(1 + lev);
  if (!(v > 0.05) || half > MODEL_RULES.MAX_HALF_WIDTH) return null;
  return {
    v,
    lo: Math.max(0, v - half),
    hi: v + half,
    sets: model.n,
    sessions: model.sessions,
    today: offs.length > 0,
  };
}

export type Deviation = "as_expected" | "faster" | "slower";

/** A measured set against what was expected: only outside the 95 % interval is it worth saying. */
export function compareToExpected(measured: number, p: VelocityPrediction): Deviation {
  if (measured > p.hi) return "faster";
  if (measured < p.lo) return "slower";
  return "as_expected";
}

/** "Not enough measured sets yet (2 of 5)." — why there's no expected speed. */
export function whyNoPrediction(model: VelocityModel): string {
  if (model.ok) return "This load or rep count is outside what you've filmed for this lift.";
  if (model.why === "too_few_sets")
    return `Not enough measured sets yet (${model.n} of ${MODEL_RULES.MIN_SETS}).`;
  if (model.why === "too_few_sessions") return "Needs measured sets from at least 2 workouts.";
  return "Your measured sets don't agree closely enough yet.";
}

/** Today's measured sets apart from the history the line is drawn from (a local calendar day). */
export function splitToday<T extends { sample: VelocitySample }>(
  rows: readonly T[],
  now: number = Date.now(),
): { history: VelocitySample[]; today: VelocitySample[] } {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const history: VelocitySample[] = [];
  const today: VelocitySample[] = [];
  for (const r of rows) (Date.parse(r.sample.at) >= start ? today : history).push(r.sample);
  return { history, today };
}
