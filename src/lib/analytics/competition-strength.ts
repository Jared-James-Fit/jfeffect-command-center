/**
 * Competition-lift strength over time: one deterministic read for the
 * analytics page's strength chart, its Overview tiles and the "Your total"
 * card, so they can never disagree.
 *
 * Four different things are kept apart and never summed into each other:
 *  - an ESTIMATE from a training set (`comparableE1rm`, strength-read.ts: a
 *    hard set, RPE 7+ / RIR ≤ 3, of 10 reps or fewer, read with its effort).
 *    A light day, a technique single at RPE 6 or an unrated back-off never
 *    makes a point: it says little about a max.
 *  - a MEET result: lifted on a platform, tested.
 *  - a coach's TRAINING MAX: a number the program reads loads from, not a
 *    measurement of the athlete.
 *  - age: an estimate is "current" only when it's from the last
 *    `CURRENT_DAYS`. An older one is shown with its date and never added into
 *    a current total (Nov 22 2026: an Aug 5 squat single + an Aug 5 bench
 *    single + a 600 lb coach max read as a "1,471 lb total, +27 vs last meet"
 *    while every November squat and bench set was RPE 6 or lighter).
 *
 * Competition lifts only: a variation (a paused bench, a high-bar squat) is
 * its own exercise with its own history and is never plotted as the comp lift.
 * All loads in lb (getClientResults' unit); the screen converts.
 */
import {
  comparableE1rm,
  effortOf,
  strengthTrend,
  type StrengthTrend,
} from "@/lib/analytics/strength-read";
import { parseLocalDate } from "@/lib/today";
import { neutralizeObviousLoadOutliers } from "@/lib/analytics/load-sanity";

export type CompLift = "squat" | "bench" | "deadlift";
export const COMP_LIFTS: CompLift[] = ["squat", "bench", "deadlift"];
export const COMP_LIFT_LABEL: Record<CompLift, string> = {
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
};

/** An estimate older than this isn't "current" strength. */
export const CURRENT_DAYS = 42;
const LB_PER_KG = 2.2046226;
const DAY = 86_400_000;

/** A competition lift from a getClientResults row, or null (variations and everything else). */
export function compLiftOfResult(r: any): CompLift | null {
  if (!r || r.is_competition_lift !== true) return null;
  const t = String(r.competition_lift_type ?? "").toLowerCase();
  if (t.includes("squat")) return "squat";
  if (t.includes("bench")) return "bench";
  if (t.includes("dead")) return "deadlift";
  return null;
}

function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type StrengthPoint = {
  lift: CompLift;
  /** yyyy-mm-dd, the athlete's own day */
  day: string;
  /** estimated max, lb (from the session's best comparable set) */
  e1rm: number;
  /** the set behind it */
  set: { load: number; reps: number; effort: number };
};

export type LightSession = { lift: CompLift; day: string; heaviest: number };

/**
 * One point per lift per training day: the day's best comparable estimate.
 * Days with only light or unrated sets are counted, never plotted.
 */
export function strengthPoints(results: any[]): { points: StrengthPoint[]; light: LightSession[] } {
  const byKey = new Map<
    string,
    { lift: CompLift; day: string; best: StrengthPoint | null; heaviest: number }
  >();
  // the shared guard: an absurd imported load (a typo, a unit slip ×10) never becomes a max
  const comp = neutralizeObviousLoadOutliers(
    (results ?? [])
      .filter((r) => compLiftOfResult(r))
      .map((r) => ({ ...r, est_1rm: Number(r.est_1rm) || 0 })),
  );
  for (const r of comp) {
    const lift = compLiftOfResult(r);
    if (!lift || !r.date) continue;
    const load = Number(r.load) || 0;
    const reps = Number(r.reps) || 0;
    if (!(load > 0) || !(reps > 0) || r.counts_load === false) continue;
    const day = localDay(r.date);
    const k = `${lift}|${day}`;
    const cur = byKey.get(k) ?? { lift, day, best: null, heaviest: 0 };
    cur.heaviest = Math.max(cur.heaviest, load);
    const e = comparableE1rm({ load, reps, rpe: r.rpe, rir: r.rir });
    if (e != null && (!cur.best || e > cur.best.e1rm)) {
      cur.best = {
        lift,
        day,
        e1rm: Math.round(e * 10) / 10,
        set: { load, reps, effort: effortOf({ rpe: r.rpe, rir: r.rir }) ?? 0 },
      };
    }
    byKey.set(k, cur);
  }
  const points: StrengthPoint[] = [];
  const light: LightSession[] = [];
  for (const v of byKey.values()) {
    if (v.best) points.push(v.best);
    else light.push({ lift: v.lift, day: v.day, heaviest: v.heaviest });
  }
  points.sort((a, b) => a.day.localeCompare(b.day) || a.lift.localeCompare(b.lift));
  light.sort((a, b) => a.day.localeCompare(b.day));
  return { points, light };
}

export type MeetResult = {
  /** yyyy-mm-dd as stored (a date, never read as UTC midnight) */
  date: string;
  name: string | null;
  lifts: Record<CompLift, number>;
  total: number;
  bodyweightLb: number | null;
};

/** athlete_powerlifting_results rows (kg) → meets in lb, newest first. Incomplete meets are left out. */
export function meetsFromRows(rows: any[]): MeetResult[] {
  const out: MeetResult[] = [];
  for (const m of rows ?? []) {
    const s = Number(m?.squat_kg),
      b = Number(m?.bench_kg),
      d = Number(m?.deadlift_kg);
    if (!m?.meet_date || !(s > 0 && b > 0 && d > 0)) continue;
    const bw = Number(m.bodyweight_kg);
    out.push({
      date: String(m.meet_date).slice(0, 10),
      name: m.meet_name ?? null,
      lifts: { squat: s * LB_PER_KG, bench: b * LB_PER_KG, deadlift: d * LB_PER_KG },
      total: (s + b + d) * LB_PER_KG,
      bodyweightLb: bw > 0 ? bw * LB_PER_KG : null,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** The meet's day for display: a stored date is that calendar day in any time zone. */
export function meetDay(m: Pick<MeetResult, "date">): Date | null {
  return parseLocalDate(m.date);
}

export type LiftEstimate = { lb: number; day: string; set: StrengthPoint["set"] };

export type LiftStanding = {
  lift: CompLift;
  /** best comparable estimate from the last CURRENT_DAYS, or null */
  current: LiftEstimate | null;
  /** the most recent comparable estimate ever (may be old); null with none */
  latest: LiftEstimate | null;
  /** days since `latest` */
  latestAgeDays: number | null;
  /** the coach's training max for the lift (lb), never an estimate of the athlete */
  trainingMax: { lb: number; date: string | null } | null;
};

export type TotalStanding = {
  lifts: Record<CompLift, LiftStanding>;
  /** squat + bench + deadlift current estimates; null unless all three are current */
  currentTotal: number | null;
  /** the lifts without a current estimate (why there's no current total) */
  missing: CompLift[];
  lastMeet: MeetResult | null;
  /** currentTotal against the last meet's total; only with both */
  vsMeet: number | null;
};

/**
 * Where the athlete stands on the competition lifts today. `trainingMaxes`
 * are the coach's (lb); they're listed, never mixed into an estimate.
 */
export function totalStanding(input: {
  points: StrengthPoint[];
  meets: MeetResult[];
  trainingMaxes?: Partial<Record<CompLift, { lb: number; date: string | null }>>;
  today: string;
}): TotalStanding {
  const todayMs = Date.parse(`${input.today}T12:00:00Z`);
  const ageOf = (day: string) => Math.round((todayMs - Date.parse(`${day}T12:00:00Z`)) / DAY);
  const lifts = {} as Record<CompLift, LiftStanding>;
  for (const lift of COMP_LIFTS) {
    const pts = input.points.filter((p) => p.lift === lift && p.day <= input.today);
    const latestP = pts[pts.length - 1] ?? null;
    const recent = pts.filter((p) => ageOf(p.day) <= CURRENT_DAYS);
    const bestRecent = recent.reduce<StrengthPoint | null>(
      (a, p) => (!a || p.e1rm > a.e1rm ? p : a),
      null,
    );
    lifts[lift] = {
      lift,
      current: bestRecent
        ? { lb: bestRecent.e1rm, day: bestRecent.day, set: bestRecent.set }
        : null,
      latest: latestP ? { lb: latestP.e1rm, day: latestP.day, set: latestP.set } : null,
      latestAgeDays: latestP ? ageOf(latestP.day) : null,
      trainingMax: input.trainingMaxes?.[lift] ?? null,
    };
  }
  const missing = COMP_LIFTS.filter((l) => !lifts[l].current);
  const currentTotal = missing.length
    ? null
    : COMP_LIFTS.reduce((a, l) => a + lifts[l].current!.lb, 0);
  const lastMeet = input.meets.find((m) => m.date <= input.today) ?? null;
  return {
    lifts,
    currentTotal: currentTotal != null ? Math.round(currentTotal * 10) / 10 : null,
    missing,
    lastMeet,
    vsMeet:
      currentTotal != null && lastMeet
        ? Math.round((currentTotal - lastMeet.total) * 10) / 10
        : null,
  };
}

/** Each lift's trend over the points in a period (strength-read's rule: "too early" with too little). */
export function liftTrends(points: StrengthPoint[]): Record<CompLift, StrengthTrend> {
  const out = {} as Record<CompLift, StrengthTrend>;
  for (const lift of COMP_LIFTS) {
    out[lift] = strengthTrend(
      points.filter((p) => p.lift === lift).map((p) => ({ date: p.day, value: p.e1rm })),
    );
  }
  return out;
}

/**
 * The chart's resolution: a point per session up to ~4 months, then the
 * week's best, then the month's best (a year of sessions is ~150 points a
 * lift, unreadable on a phone). The best, never the average: strength shows
 * in the best sessions.
 */
export type Grain = "session" | "week" | "month";
export function grainFor(spanDays: number): Grain {
  if (spanDays <= 120) return "session";
  if (spanDays <= 400) return "week";
  return "month";
}

function bucketKey(day: string, grain: Grain): string {
  if (grain === "session") return day;
  if (grain === "month") return `${day.slice(0, 7)}-01`;
  const n = Date.parse(`${day}T00:00:00Z`) / DAY;
  const dow = (new Date(n * DAY).getUTCDay() + 6) % 7;
  return new Date((n - dow) * DAY).toISOString().slice(0, 10);
}

export function bucketPoints(points: StrengthPoint[], grain: Grain): StrengthPoint[] {
  if (grain === "session") return points;
  const best = new Map<string, StrengthPoint>();
  for (const p of points) {
    const k = `${p.lift}|${bucketKey(p.day, grain)}`;
    const cur = best.get(k);
    if (!cur || p.e1rm > cur.e1rm) best.set(k, { ...p });
  }
  return [...best.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Strength relative to bodyweight: each point over the average weigh-in in
 * the 7 days up to it (none within 14 days → the point is left out, never
 * guessed). Weigh-ins in lb, oldest first.
 */
export function relativeToBodyweight<T extends { day: string; value: number }>(
  points: T[],
  weighIns: Array<{ day: string; lb: number }>,
): Array<T & { bw: number }> {
  const out: Array<T & { bw: number }> = [];
  const w = weighIns.slice().sort((a, b) => a.day.localeCompare(b.day));
  for (const p of points) {
    const t = Date.parse(`${p.day}T12:00:00Z`);
    const near = w.filter((x) => {
      const d = (t - Date.parse(`${x.day}T12:00:00Z`)) / DAY;
      return d >= 0 && d <= 6;
    });
    let bw: number | null = null;
    if (near.length) bw = near.reduce((a, x) => a + x.lb, 0) / near.length;
    else {
      const prior = w.filter((x) => x.day <= p.day);
      const last = prior[prior.length - 1];
      if (last && (t - Date.parse(`${last.day}T12:00:00Z`)) / DAY <= 14) bw = last.lb;
    }
    if (bw && bw > 0) out.push({ ...p, value: Math.round((p.value / bw) * 100) / 100, bw });
  }
  return out;
}
