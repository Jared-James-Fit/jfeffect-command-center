/**
 * Where bodyweight is heading. One weigh-in is never "the" weight: water,
 * glycogen, sodium, gut content and a hard training day all move the scale
 * 0.5–2% overnight. So the level they're at is a least-squares line through
 * the last few weeks of weigh-ins (its day-to-day scatter measured, so a
 * normal swing never reads as a trend), the rate is that line's slope, and a
 * projection to the target date carries an uncertainty band that widens the
 * further out it goes and the noisier their weigh-ins are. Pure, tested
 * (weight-management.test.ts).
 */
import { addDays, daysBetween, round } from "@/lib/weight-management/units";

export type WeighIn = { date: string; kg: number };

/** A weight class is "at most", a gain is "at least", maintenance is "around". */
export type GoalKind = "at_most" | "at_least" | "around";
export type TrajectoryGoal = { kg: number; date: string | null; kind: GoalKind };

export type Confidence = "low" | "moderate" | "high";

export const TREND_WINDOW_DAYS = 28;
export const WIDE_WINDOW_DAYS = 42;
export const MIN_TREND_WEIGH_INS = 4;
export const MIN_TREND_SPAN_DAYS = 10;
/** No weigh-in for this long and the reading is stale. */
export const STALE_DAYS = 10;

export type Trend = {
  kgPerWeek: number;
  pctPerWeek: number;
  /** Standard error of the weekly rate. */
  seKgPerWeek: number;
  /** Typical day-to-day scatter around the line (1 SD), kg. */
  noiseKg: number;
  /** The slope is at least 2 standard errors from flat: a real trend, not scatter. */
  clear: boolean;
  weighIns: number;
  from: string;
  to: string;
  spanDays: number;
  /** The line's value on the latest weigh-in day: their weight with the noise taken out. */
  levelKg: number;
};

export type TrajectoryStatus =
  | "not_enough_data"
  | "no_target"
  | "reached"
  | "on_track"
  | "ahead"
  | "behind"
  | "stalled"
  | "wrong_way";

export type Trajectory = {
  latest: WeighIn | null;
  /** Average of the weigh-ins in the 7 days ending on the latest one. */
  average7: { date: string; kg: number; n: number } | null;
  /** That 7-day average against the 7 days before it (both need 2+ weigh-ins). */
  weeklyChangeKg: number | null;
  trend: Trend | null;
  stale: boolean;
  weighInsLast14: number;
  /** Their weight now, noise removed where possible. */
  current: { kg: number; from: "trend" | "average" | "latest" } | null;
  goal: TrajectoryGoal | null;
  /** goal − current (negative = to lose). */
  gapKg: number | null;
  required: { kgPerWeek: number; pctPerWeek: number; weeksLeft: number } | null;
  projected: { date: string; kg: number; lowKg: number; highKg: number; confidence: Confidence } | null;
  status: TrajectoryStatus;
  /** The planned path from now to the goal date, weekly, with the band that still counts as on it. */
  path: Array<{ date: string; kg: number; lowKg: number; highKg: number }>;
  /** The latest weigh-in sits well off the line (water / gut content, not tissue). */
  fluctuation: { deltaKg: number; direction: "above" | "below" } | null;
};

type Fit = { slopePerDay: number; seSlopePerDay: number; noise: number; n: number; meanKg: number; at: (date: string) => number; from: string; to: string };

function fit(points: WeighIn[]): Fit | null {
  const n = points.length;
  if (n < 2) return null;
  const x0 = points[0].date;
  const xs = points.map((p) => daysBetween(x0, p.date));
  const ys = points.map((p) => p.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx <= 0) return null;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  const ssr = xs.reduce((a, x, i) => a + (ys[i] - (my + slope * (x - mx))) ** 2, 0);
  const noise = n > 2 ? Math.sqrt(ssr / (n - 2)) : 0;
  return {
    slopePerDay: slope,
    seSlopePerDay: noise / Math.sqrt(sxx),
    noise,
    n,
    meanKg: my,
    at: (date: string) => my + slope * (daysBetween(x0, date) - mx),
    from: points[0].date,
    to: points[n - 1].date,
  };
}

/** Clean, one a day (the last one logged that day wins), oldest first. */
export function cleanWeighIns(points: WeighIn[]): WeighIn[] {
  const byDay = new Map<string, number>();
  for (const p of points) {
    const d = String(p.date ?? "").slice(0, 10);
    const kg = Number(p.kg);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(kg) || kg < 25 || kg > 350) continue;
    byDay.set(d, kg);
  }
  return [...byDay.entries()].map(([date, kg]) => ({ date, kg })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The trend over the last 4 weeks (6 when 4 is too thin): 4+ weigh-ins over
 * 10+ days, else null (never a trend from two numbers). `since` leaves out
 * the days before it (the first week of a new plan) when enough is left.
 */
export function recentTrend(points: WeighIn[], opts: { since?: string | null } = {}): Trend | null {
  const pts = cleanWeighIns(points);
  if (!pts.length) return null;
  const end = pts[pts.length - 1].date;
  const usable = (xs: WeighIn[]) => xs.length >= MIN_TREND_WEIGH_INS && daysBetween(xs[0].date, xs[xs.length - 1].date) >= MIN_TREND_SPAN_DAYS;
  const window = (days: number) => pts.filter((p) => daysBetween(p.date, end) < days && (!opts.since || p.date >= opts.since));
  let use = window(TREND_WINDOW_DAYS);
  if (!usable(use)) use = window(WIDE_WINDOW_DAYS);
  if (!usable(use) && opts.since) return recentTrend(points);
  if (!usable(use)) return null;
  const f = fit(use);
  if (!f) return null;
  const level = f.at(end);
  const kgPerWeek = f.slopePerDay * 7;
  const se = f.seSlopePerDay * 7;
  return {
    kgPerWeek: round(kgPerWeek, 3),
    pctPerWeek: round((kgPerWeek / level) * 100, 2),
    seKgPerWeek: round(se, 3),
    noiseKg: round(f.noise, 2),
    clear: se === 0 ? kgPerWeek !== 0 : Math.abs(kgPerWeek) >= 2 * se,
    weighIns: f.n,
    from: f.from,
    to: f.to,
    spanDays: daysBetween(f.from, f.to),
    levelKg: round(level, 2),
  };
}

function averageEnding(pts: WeighIn[], end: string, days = 7): { kg: number; n: number } | null {
  const xs = pts.filter((p) => p.date <= end && daysBetween(p.date, end) < days);
  if (!xs.length) return null;
  return { kg: round(xs.reduce((a, p) => a + p.kg, 0) / xs.length, 2), n: xs.length };
}

/** Within this of the goal counts as there: half a percent of bodyweight, never under 0.3 kg. */
export const toleranceKg = (kg: number) => Math.max(0.3, kg * 0.005);

function satisfies(kg: number, goal: TrajectoryGoal): boolean {
  if (goal.kind === "at_most") return kg <= goal.kg;
  if (goal.kind === "at_least") return kg >= goal.kg;
  return Math.abs(kg - goal.kg) <= toleranceKg(goal.kg);
}

/** Their bodyweight read against a goal (or none), as of `today`. */
export function buildTrajectory(x: { weighIns: WeighIn[]; today: string; goal?: TrajectoryGoal | null; trendSince?: string | null }): Trajectory {
  const pts = cleanWeighIns(x.weighIns);
  const latest = pts[pts.length - 1] ?? null;
  const goal = x.goal && Number.isFinite(x.goal.kg) && x.goal.kg > 0 ? x.goal : null;
  const empty: Trajectory = {
    latest,
    average7: null,
    weeklyChangeKg: null,
    trend: null,
    stale: true,
    weighInsLast14: 0,
    current: null,
    goal,
    gapKg: null,
    required: null,
    projected: null,
    status: "not_enough_data",
    path: [],
    fluctuation: null,
  };
  if (!latest) return empty;

  const avgNow = averageEnding(pts, latest.date);
  const avgBefore = averageEnding(pts, addDays(latest.date, -7));
  const weeklyChangeKg = avgNow && avgBefore && avgNow.n >= 2 && avgBefore.n >= 2 ? round(avgNow.kg - avgBefore.kg, 2) : null;
  const trend = recentTrend(pts, { since: x.trendSince ?? null });
  const stale = daysBetween(latest.date, x.today) > STALE_DAYS;
  const weighInsLast14 = pts.filter((p) => daysBetween(p.date, x.today) < 14 && p.date <= x.today).length;
  const current: Trajectory["current"] = trend
    ? { kg: trend.levelKg, from: "trend" }
    : avgNow && avgNow.n >= 2
      ? { kg: avgNow.kg, from: "average" }
      : { kg: latest.kg, from: "latest" };

  // the latest weigh-in against the line through the ones before it (it can't pull the line toward itself)
  let fluctuation: Trajectory["fluctuation"] = null;
  const before = recentTrend(pts.slice(0, -1));
  if (trend && before && before.noiseKg > 0 && daysBetween(before.to, latest.date) <= 7) {
    const expected = before.levelKg + (before.kgPerWeek * daysBetween(before.to, latest.date)) / 7;
    const delta = latest.kg - expected;
    if (Math.abs(delta) > Math.max(2.5 * before.noiseKg, latest.kg * 0.006)) fluctuation = { deltaKg: round(delta, 2), direction: delta > 0 ? "above" : "below" };
  }

  const base = { ...empty, latest, average7: avgNow ? { date: latest.date, ...avgNow } : null, weeklyChangeKg, trend, stale, weighInsLast14, current, fluctuation };
  if (!goal) return { ...base, status: trend ? "no_target" : "not_enough_data" };

  const gapKg = round(goal.kg - current.kg, 2);
  const needed = goal.kind === "at_most" ? Math.min(0, gapKg) : goal.kind === "at_least" ? Math.max(0, gapKg) : gapKg;
  const weeksLeft = goal.date ? daysBetween(x.today, goal.date) / 7 : null;
  const required =
    weeksLeft != null && weeksLeft > 0
      ? { kgPerWeek: round(needed / weeksLeft, 3), pctPerWeek: round((needed / weeksLeft / current.kg) * 100, 2), weeksLeft: round(weeksLeft, 1) }
      : null;

  let projected: Trajectory["projected"] = null;
  const path: Trajectory["path"] = [];
  if (goal.date && weeksLeft != null && weeksLeft > 0 && trend) {
    const weeksFromLevel = daysBetween(trend.to, goal.date) / 7;
    const kg = trend.levelKg + trend.kgPerWeek * weeksFromLevel;
    const half = 2 * Math.sqrt((trend.seKgPerWeek * weeksFromLevel) ** 2 + trend.noiseKg ** 2);
    const confidence: Confidence =
      trend.clear && trend.weighIns >= 12 && trend.spanDays >= 21 && weeksLeft <= 6 ? "high" : trend.weighIns >= 8 && weeksLeft <= 12 ? "moderate" : "low";
    projected = { date: goal.date, kg: round(kg, 2), lowKg: round(kg - half, 2), highKg: round(kg + half, 2), confidence };
  }
  if (goal.date && weeksLeft != null && weeksLeft > 0) {
    const band = Math.max(goal.kg * 0.005, trend?.noiseKg ?? 0);
    const totalDays = daysBetween(latest.date, goal.date);
    const steps = Math.min(52, Math.max(1, Math.ceil(totalDays / 7)));
    for (let i = 0; i <= steps; i++) {
      const d = i === steps ? goal.date : addDays(latest.date, i * 7);
      const frac = totalDays > 0 ? daysBetween(latest.date, d) / totalDays : 1;
      const kg = current.kg + (goal.kg - current.kg) * frac;
      path.push({ date: d, kg: round(kg, 2), lowKg: round(kg - band, 2), highKg: round(kg + band, 2) });
    }
  }

  const status = ((): TrajectoryStatus => {
    // a weigh-in from weeks ago says nothing about today: never "reached" on a stale reading
    if (!stale && satisfies(current.kg, goal) && (!projected || satisfies(projected.kg, goal))) return "reached";
    if (!trend || stale) return "not_enough_data";
    const toward = goal.kind === "around" ? Math.sign(gapKg) : goal.kind === "at_most" ? -1 : 1;
    const moving = trend.clear ? Math.sign(trend.kgPerWeek) : 0;
    if (moving !== 0 && moving !== toward) return "wrong_way";
    if (!projected) return moving === toward ? "on_track" : "stalled";
    // a projection within tolerance of the goal is on it (the goal for a class already has its buffer)
    const near = { ...goal, kg: goal.kind === "at_most" ? goal.kg + toleranceKg(goal.kg) / 2 : goal.kind === "at_least" ? goal.kg - toleranceKg(goal.kg) / 2 : goal.kg };
    if (satisfies(projected.kg, near)) {
      const fast = required && Math.abs(trend.kgPerWeek) > Math.abs(required.kgPerWeek) * 1.25;
      const sure = goal.kind === "at_most" ? projected.highKg <= goal.kg : goal.kind === "at_least" ? projected.lowKg >= goal.kg : true;
      return fast && sure && goal.kind !== "around" ? "ahead" : "on_track";
    }
    return moving === 0 ? "stalled" : "behind";
  })();

  return { ...base, gapKg, required, projected, status, path };
}
