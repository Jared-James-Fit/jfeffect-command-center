/**
 * Load–velocity, across sessions (pure). For one athlete and one exercise,
 * each analysed set gives a point: the load on the bar and the set's fastest
 * rep's mean concentric velocity. Bar speed falls in a near-straight line as
 * the load goes up, and that line is the athlete's own: where today's set
 * sits against it says whether the bar moved as usual for that load.
 *
 * A line is only drawn from enough real spread: at least 3 sets, at least 2
 * different loads 15 % or more apart, falling as load rises, and fitting
 * well (r² ≥ 0.7). A day is called faster or slower than usual only beyond
 * a normal day-to-day swing (6 %: the same load rarely moves at exactly the
 * same speed twice) and beyond the set's own margin, and only inside the
 * loads the line was drawn from. No 1RM is predicted from it.
 */

export type LvPoint = {
  /** Load on the bar (kg). */
  kg: number;
  /** The set's fastest rep's mean concentric velocity (m/s). */
  v: number;
  /** Its 95 % margin (m/s), when known. */
  u?: number | null;
  tier: "measured" | "estimated";
  at: string;
  id: string;
  reps?: number | null;
  rpe?: number | null;
};

export type LvProfile = {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  minKg: number;
  maxKg: number;
};

export const LV_MIN_POINTS = 3;
export const LV_MIN_SPREAD = 0.15;
export const LV_MIN_R2 = 0.7;
/** Normal day-to-day swing of bar speed at the same load. */
export const DAY_TO_DAY = 0.06;

export function fitProfile(points: LvPoint[]): LvProfile | null {
  const pts = points.filter((p) => p.kg > 0 && p.v > 0 && p.v < 3.5);
  if (pts.length < LV_MIN_POINTS) return null;
  const loads = pts.map((p) => p.kg);
  const minKg = Math.min(...loads);
  const maxKg = Math.max(...loads);
  if ((maxKg - minKg) / maxKg < LV_MIN_SPREAD) return null;
  const n = pts.length;
  const mx = loads.reduce((a, b) => a + b, 0) / n;
  const my = pts.reduce((a, p) => a + p.v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pts) {
    sxy += (p.kg - mx) * (p.v - my);
    sxx += (p.kg - mx) ** 2;
    syy += (p.v - my) ** 2;
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  const slope = sxy / sxx;
  if (!(slope < 0)) return null;
  const intercept = my - slope * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  if (r2 < LV_MIN_R2) return null;
  return { slope, intercept, r2, n, minKg, maxKg };
}

export type LvComparison = { expected: number; diff: number; call: "faster" | "slower" | "usual" };

/** Today's set against the line (the line fitted without today's set), or null outside its range. */
export function compareToProfile(
  profile: LvProfile,
  kg: number,
  v: number,
  margin = 0,
): LvComparison | null {
  if (kg < profile.minKg * 0.95 || kg > profile.maxKg * 1.05) return null;
  const expected = profile.intercept + profile.slope * kg;
  if (!(expected > 0)) return null;
  const diff = v / expected - 1;
  const bar = Math.max(DAY_TO_DAY, margin / expected);
  return { expected, diff, call: diff > bar ? "faster" : diff < -bar ? "slower" : "usual" };
}
