/**
 * The performance calendar: one square per day, read from logged sets and the
 * workouts written for those days (pure, tested in analytics-redesign.test.ts).
 *
 * Each day has a state (done, partly done, missed, rest, planned ahead, no
 * data yet) and, for the metric picked, a level 0–4 against the athlete's OWN
 * training (never a universal scale):
 *  - activity: working sets that day, against their own quartiles;
 *  - volume: weight moved (loaded sets × reps), against their own quartiles;
 *  - intensity: the day's average RPE (rated sets only; unrated days say so);
 *  - strength: the best change that day in a COMPARABLE performance, an
 *    exercise's estimate against its own best in the 120 days before
 *    (strength-estimate.ts: hard sets against hard and lighter sets; a lighter
 *    set only ever shows progress, since it's a lower bound). How heavy the day
 *    was is never strength;
 *  - prs: all-time records that day, one per exercise.
 * A missed day is never a zero: it's its own state, and a day before the
 * first logged workout is "no data", never "rest".
 */
import { sessionEstimates, type SessionEstimate } from "@/lib/analytics/strength-estimate";
import { localDay } from "@/lib/analytics/lift-strength";

export type CalendarMetric = "activity" | "strength" | "volume" | "intensity" | "prs";
export const CALENDAR_METRICS: Array<{ key: CalendarMetric; label: string }> = [
  { key: "activity", label: "Sets" },
  { key: "strength", label: "Strength" },
  { key: "volume", label: "Weight lifted" },
  { key: "intensity", label: "Effort" },
  { key: "prs", label: "Records" },
];

export type DayState =
  | "done"
  | "partial"
  | "missed"
  | "rest"
  | "planned"
  | "today"
  | "future"
  | "none";

export type DayTopSet = {
  exercise: string;
  load: number;
  reps: number;
  rpe: number | null;
  comp: boolean;
};

export type DaySummary = {
  day: string;
  state: DayState;
  dayIds: string[];
  sets: number;
  reps: number;
  /** lb × reps, loaded sets only */
  tonnageLb: number;
  avgRpe: number | null;
  ratedSets: number;
  plannedSets: number | null;
  plannedWorkouts: number;
  prs: Array<{ exercise: string; load: number; reps: number }>;
  /** the day's best change in a comparable performance, % (null: nothing comparable) */
  strength: { exercise: string; pct: number; e1rm: number; prior: number } | null;
  /** the heaviest set of each exercise, competition lifts first, at most 4 */
  topSets: DayTopSet[];
  exercises: number;
  level: number;
};

export type PlanDay = { day: string | null; dayId: string; sets: number | null; isTime?: boolean };
export type PrMark = { date: string; exercise_name: string; load: number; reps: number };

const DAY = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
export const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const PRIOR_DAYS = 120;
/** under this share of the written sets, a trained day is "partly done" */
export const PARTIAL_SHARE = 0.6;

function exKey(r: any): string {
  return r.exercise_id
    ? `id:${r.exercise_id}`
    : `name:${String(r.exercise_name ?? "")
        .trim()
        .toLowerCase()}`;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Each exercise's comparable-performance change per day (see the module note). */
export function strengthChanges(
  results: any[],
): Map<string, { exercise: string; pct: number; e1rm: number; prior: number }> {
  const byEx = new Map<
    string,
    { name: string; sets: Array<{ day: string; load: number; reps: number; rpe: any; rir: any }> }
  >();
  for (const r of results ?? []) {
    if (!r?.date || !(Number(r.load) > 0) || r.counts_load === false) continue;
    const k = exKey(r);
    const cur = byEx.get(k) ?? { name: String(r.exercise_name ?? "Exercise"), sets: [] };
    cur.name = String(r.exercise_name ?? cur.name);
    cur.sets.push({
      day: localDay(r.date),
      load: Number(r.load),
      reps: Number(r.reps) || 0,
      rpe: r.rpe,
      rir: r.rir,
    });
    byEx.set(k, cur);
  }
  const best = new Map<string, { exercise: string; pct: number; e1rm: number; prior: number }>();
  for (const { name, sets } of byEx.values()) {
    const sess: SessionEstimate[] = sessionEstimates(sets).filter(
      (s) => !s.outlier && s.confidence !== "low",
    );
    for (let i = 0; i < sess.length; i++) {
      const s = sess[i];
      const t = dayMs(s.day);
      const prior = sess.slice(0, i).filter((p) => t - dayMs(p.day) <= PRIOR_DAYS * DAY);
      if (prior.length < 2) continue;
      const pb = Math.max(...prior.map((p) => p.e1rm));
      const pct = Math.round(((s.e1rm - pb) / pb) * 1000) / 10;
      // a lighter set is a lower bound: it can show progress, never a drop
      if (s.confidence === "medium" && pct <= 0) continue;
      const cur = best.get(s.day);
      if (!cur || pct > cur.pct) best.set(s.day, { exercise: name, pct, e1rm: s.e1rm, prior: pb });
    }
  }
  return best;
}

function quartiles(xs: number[]): [number, number, number] {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  if (!s.length) return [0, 0, 0];
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return [q(0.25), q(0.5), q(0.75)];
}

function quartileLevel(v: number, q: [number, number, number]): number {
  if (!(v > 0)) return 0;
  if (v <= q[0]) return 1;
  if (v <= q[1]) return 2;
  if (v <= q[2]) return 3;
  return 4;
}

export function strengthLevel(pct: number | null): number {
  if (pct == null) return 1;
  if (pct >= 3) return 4;
  if (pct > 0) return 3;
  if (pct >= -3) return 2;
  return 1;
}

export function intensityLevel(avgRpe: number | null): number {
  if (avgRpe == null) return 1;
  if (avgRpe >= 8.5) return 4;
  if (avgRpe >= 7.5) return 3;
  if (avgRpe >= 6.5) return 2;
  return 1;
}

/**
 * Every day from `start` to `end` with its state and level for `metric`.
 * `results` are getClientResults rows (all history: strength reads the days
 * before the range too); `plan` the workouts written for the range.
 */
export function buildCalendar(input: {
  results: any[];
  plan: PlanDay[];
  prs: PrMark[];
  start: string;
  end: string;
  today: string;
  metric: CalendarMetric;
  /** the first day anything was logged, ever (days before it are "no data") */
  firstLog?: string | null;
  strength?: Map<string, { exercise: string; pct: number; e1rm: number; prior: number }>;
}): DaySummary[] {
  const { start, end, today } = input;
  const byDay = new Map<string, any[]>();
  for (const r of input.results ?? []) {
    if (!r?.date || !(Number(r.reps) > 0)) continue;
    const d = localDay(r.date);
    if (d < start || d > end) continue;
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r);
  }
  const planByDay = new Map<string, { sets: number; ids: Set<string> }>();
  for (const p of input.plan ?? []) {
    if (!p.day) continue;
    const cur = planByDay.get(p.day) ?? { sets: 0, ids: new Set<string>() };
    if (!p.isTime) cur.sets += Math.max(0, Number(p.sets) || 0);
    cur.ids.add(p.dayId);
    planByDay.set(p.day, cur);
  }
  const prByDay = new Map<string, Map<string, PrMark>>();
  for (const p of input.prs ?? []) {
    const d = localDay(p.date);
    const m = prByDay.get(d) ?? new Map<string, PrMark>();
    const prev = m.get(p.exercise_name);
    if (!prev || p.load * (1 + p.reps / 30) > prev.load * (1 + prev.reps / 30))
      m.set(p.exercise_name, p);
    prByDay.set(d, m);
  }
  const strength = input.strength ?? strengthChanges(input.results);
  const firstLog = input.firstLog ?? null;

  const days: DaySummary[] = [];
  for (let t = dayMs(start); t <= dayMs(end); t += DAY) {
    const day = dayStr(t);
    const rs = byDay.get(day) ?? [];
    const plan = planByDay.get(day);
    const rated = rs
      .map((r) => num(r.rpe) ?? (num(r.rir) != null ? 10 - num(r.rir)! : null))
      .filter((x): x is number => x != null && x > 0);
    const tonnage = rs.reduce(
      (a, r) => a + (r.counts_load === false ? 0 : (Number(r.load) || 0) * (Number(r.reps) || 0)),
      0,
    );
    const dayIds = [...new Set(rs.map((r) => r.day_id).filter(Boolean))] as string[];
    let state: DayState;
    if (rs.length) {
      state =
        plan && plan.sets > 0 && rs.length < plan.sets * PARTIAL_SHARE && day < today
          ? "partial"
          : "done";
    } else if (day > today) state = plan ? "planned" : "future";
    else if (day === today) state = plan ? "today" : "rest";
    else if (plan) state = "missed";
    else state = firstLog && day >= firstLog ? "rest" : "none";
    // the heaviest set of each exercise, competition lifts first
    const heaviest = new Map<string, DayTopSet>();
    for (const r of rs) {
      if (!(Number(r.load) > 0)) continue;
      const name = String(r.exercise_name ?? "Exercise");
      const cur = heaviest.get(name);
      if (!cur || Number(r.load) > cur.load) {
        heaviest.set(name, {
          exercise: name,
          load: Number(r.load),
          reps: Number(r.reps) || 0,
          rpe: num(r.rpe),
          comp: r.is_competition_lift === true,
        });
      }
    }
    const topSets = [...heaviest.values()]
      .sort((a, b) => Number(b.comp) - Number(a.comp) || b.load - a.load)
      .slice(0, 4);
    days.push({
      day,
      state,
      dayIds,
      sets: rs.length,
      reps: rs.reduce((a, r) => a + (Number(r.reps) || 0), 0),
      tonnageLb: Math.round(tonnage),
      avgRpe: rated.length
        ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10
        : null,
      ratedSets: rated.length,
      plannedSets: plan ? plan.sets : null,
      plannedWorkouts: plan ? plan.ids.size : 0,
      prs: [...(prByDay.get(day)?.values() ?? [])].map((p) => ({
        exercise: p.exercise_name,
        load: p.load,
        reps: p.reps,
      })),
      strength: rs.length ? (strength.get(day) ?? null) : null,
      topSets,
      exercises: new Set(rs.map((r) => exKey(r))).size,
      level: 0,
    });
  }
  // levels against the athlete's own trained days in the range
  const trained = days.filter((d) => d.sets > 0);
  const qSets = quartiles(trained.map((d) => d.sets));
  const qTon = quartiles(trained.map((d) => d.tonnageLb));
  for (const d of days) {
    if (!d.sets) continue;
    switch (input.metric) {
      case "activity":
        d.level = Math.max(1, quartileLevel(d.sets, qSets));
        break;
      case "volume":
        d.level = Math.max(1, quartileLevel(d.tonnageLb, qTon));
        break;
      case "intensity":
        d.level = intensityLevel(d.avgRpe);
        break;
      case "strength":
        d.level = strengthLevel(d.strength?.pct ?? null);
        break;
      case "prs":
        d.level = d.prs.length >= 3 ? 4 : d.prs.length === 2 ? 3 : d.prs.length === 1 ? 2 : 1;
        break;
    }
  }
  return days;
}

/**
 * How the squares are laid out: a month grid for a few weeks; weeks as
 * columns (GitHub's) when they fit the width without a sideways scroll; else
 * small month calendars that wrap, so a year on a phone stays readable
 * instead of shrinking to specks or scrolling sideways.
 */
export type CalendarLayout = "month" | "weeks" | "months";
export const MIN_CELL = 11;
export function calendarLayout(start: string, end: string, width = Infinity): CalendarLayout {
  const span = (dayMs(end) - dayMs(start)) / DAY + 1;
  if (span <= 42) return "month";
  const weeks = Math.ceil(span / 7) + 1;
  if (weeks * (MIN_CELL + 3) + 16 <= width) return "weeks";
  return "months";
}

/** The days by calendar month, oldest first, each padded to start on its Monday. */
export function monthBlocks(
  days: DaySummary[],
): Array<{ key: string; cells: Array<DaySummary | null> }> {
  const by = new Map<string, DaySummary[]>();
  for (const d of days) {
    const k = d.day.slice(0, 7);
    (by.get(k) ?? by.set(k, []).get(k)!).push(d);
  }
  return [...by.entries()].map(([key, ds]) => {
    const lead = (new Date(dayMs(ds[0].day)).getUTCDay() + 6) % 7;
    return { key, cells: [...Array<null>(lead).fill(null), ...ds] };
  });
}

/** Monday of a day's week. */
export function mondayOf(day: string): string {
  const t = dayMs(day);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return dayStr(t - dow * DAY);
}

/** The days as weeks (Monday first), padded with nulls outside the range. */
export function weekColumns(days: DaySummary[]): Array<Array<DaySummary | null>> {
  if (!days.length) return [];
  const map = new Map(days.map((d) => [d.day, d]));
  const cols: Array<Array<DaySummary | null>> = [];
  for (let m = dayMs(mondayOf(days[0].day)); m <= dayMs(days[days.length - 1].day); m += 7 * DAY) {
    const col: Array<DaySummary | null> = [];
    for (let i = 0; i < 7; i++) col.push(map.get(dayStr(m + i * DAY)) ?? null);
    cols.push(col);
  }
  return cols;
}

/** The span's totals in words-ready numbers: days trained, planned done, longest weekly streak. */
export function calendarTotals(days: DaySummary[]) {
  const trained = days.filter((d) => d.state === "done" || d.state === "partial").length;
  const planned = days.filter(
    (d) =>
      d.plannedWorkouts > 0 &&
      (d.state === "done" || d.state === "partial" || d.state === "missed"),
  ).length;
  const plannedDone = days.filter(
    (d) => d.plannedWorkouts > 0 && (d.state === "done" || d.state === "partial"),
  ).length;
  const missed = days.filter((d) => d.state === "missed").length;
  const prs = days.reduce((a, d) => a + d.prs.length, 0);
  // consecutive weeks with a trained day (the current week counts once it has one)
  const weeks = weekColumns(days);
  let streak = 0;
  let best = 0;
  for (const w of weeks) {
    const any = w.some((d) => d && (d.state === "done" || d.state === "partial"));
    const over = w.every((d) => !d || (d.state !== "future" && d.state !== "planned"));
    if (any) {
      streak++;
      best = Math.max(best, streak);
    } else if (over) streak = 0;
  }
  return { trained, planned, plannedDone, missed, prs, bestStreak: best, currentStreak: streak };
}
