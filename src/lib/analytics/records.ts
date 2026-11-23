/**
 * Records and lifetime achievements (pure, tested in analytics-redesign.test.ts).
 *
 * A personal record is an improvement over an established record, never the
 * first time an exercise is logged (that's its baseline, kept apart as
 * `firsts`). One per exercise per day (three rising sets in one workout are
 * one record, the best), and only when it beats the record it replaces by
 * `MIN_PR_GAIN_PCT` and a pound: a 0.1 lb "PR" from a rounding difference
 * inflates the count and means nothing.
 *
 * Kinds: an estimated-max record (the set's e1RM beat every earlier set's) and
 * a heaviest-weight record (the most weight ever lifted on it, any reps). A
 * set can be both; it's listed once with both named.
 */
import { localDay } from "@/lib/analytics/lift-strength";

export const MIN_PR_GAIN_PCT = 0.5;
const LB_PER_KG = 2.2046226;

export type RecordKind = "e1rm" | "weight";
export type PersonalRecord = {
  id: string;
  day: string;
  exercise: string;
  exerciseKey: string;
  load: number;
  reps: number;
  rpe: number | null;
  e1rm: number;
  kinds: RecordKind[];
  /** what it beat: the earlier best e1RM / heaviest load (lb) */
  prior: { e1rm: number; load: number };
  gainPct: number;
  comp: boolean;
};

export type Baseline = { day: string; exercise: string; load: number; reps: number };

function exKey(r: any): string {
  return r.exercise_id
    ? `id:${r.exercise_id}`
    : `name:${String(r.exercise_name ?? "")
        .trim()
        .toLowerCase()}`;
}
const epley = (load: number, reps: number) => (reps <= 1 ? load : load * (1 + reps / 30));

/** Records in the order they happened (oldest first). `results`: every logged set, getClientResults rows. */
export function personalRecords(results: any[]): { records: PersonalRecord[]; firsts: Baseline[] } {
  const ordered = (results ?? [])
    .filter(
      (r) =>
        r?.date &&
        Number(r.load) > 0 &&
        Number(r.reps) > 0 &&
        r.counts_load !== false &&
        !r.analytics_load_outlier,
    )
    .slice()
    .sort((a, b) => {
      const da = localDay(a.date);
      const db = localDay(b.date);
      if (da !== db) return da.localeCompare(db);
      return (a.row_order ?? 0) - (b.row_order ?? 0) || (a.set_index ?? 0) - (b.set_index ?? 0);
    });
  const best = new Map<string, { e1rm: number; load: number }>();
  const firsts: Baseline[] = [];
  const byDayEx = new Map<string, PersonalRecord>();
  // the record standing at the START of each day: later sets that day beat it, never each other
  const dayStart = new Map<string, { e1rm: number; load: number }>();
  let curDay = "";
  for (const r of ordered) {
    const day = localDay(r.date);
    if (day !== curDay) {
      curDay = day;
      dayStart.clear();
    }
    const k = exKey(r);
    const load = Number(r.load);
    const reps = Number(r.reps);
    const e = epley(load, Math.min(reps, 12));
    const before = best.get(k);
    if (!before) {
      firsts.push({ day, exercise: String(r.exercise_name ?? "Exercise"), load, reps });
      best.set(k, { e1rm: e, load });
      dayStart.set(k, { e1rm: Infinity, load: Infinity });
      continue;
    }
    if (!dayStart.has(k)) dayStart.set(k, { ...before });
    const base = dayStart.get(k)!;
    const kinds: RecordKind[] = [];
    const gainE = base.e1rm > 0 ? ((e - base.e1rm) / base.e1rm) * 100 : 0;
    const gainW = base.load > 0 ? ((load - base.load) / base.load) * 100 : 0;
    if (reps <= 12 && gainE >= MIN_PR_GAIN_PCT && e - base.e1rm >= 1) kinds.push("e1rm");
    if (gainW >= MIN_PR_GAIN_PCT && load - base.load >= 1) kinds.push("weight");
    best.set(k, { e1rm: Math.max(before.e1rm, e), load: Math.max(before.load, load) });
    if (!kinds.length) continue;
    const key = `${day}|${k}`;
    const rec: PersonalRecord = {
      id: String(r.id ?? key),
      day,
      exercise: String(r.exercise_name ?? "Exercise"),
      exerciseKey: k,
      load,
      reps,
      rpe: r.rpe != null && r.rpe !== "" ? Number(r.rpe) : null,
      e1rm: Math.round(e * 10) / 10,
      kinds,
      prior: { e1rm: Math.round(base.e1rm * 10) / 10, load: base.load },
      gainPct: Math.round(Math.max(gainE, gainW) * 10) / 10,
      comp: r.is_competition_lift === true,
    };
    const prev = byDayEx.get(key);
    if (!prev || rec.e1rm > prev.e1rm || (rec.e1rm === prev.e1rm && rec.load > prev.load)) {
      if (prev) rec.kinds = [...new Set([...prev.kinds, ...rec.kinds])];
      byDayEx.set(key, rec);
    } else prev.kinds = [...new Set([...prev.kinds, ...rec.kinds])];
  }
  return { records: [...byDayEx.values()].sort((a, b) => a.day.localeCompare(b.day)), firsts };
}

/** A record worth leading with: a competition lift's, else a barbell main lift's or a big gain. */
export function isHeadlineRecord(r: PersonalRecord): boolean {
  return (
    (r.comp && r.reps <= 10) || (/\b(squat|bench|deadlift)\b/i.test(r.exercise) && r.reps <= 5)
  );
}

export type ExerciseRecords = {
  exercise: string;
  key: string;
  bestE1rm: PersonalRecord | null;
  heaviest: { load: number; reps: number; day: string } | null;
  records: PersonalRecord[];
  lastDay: string;
};

/** Records grouped by exercise, the exercise with the most recent record first. */
export function recordsByExercise(records: PersonalRecord[], results: any[]): ExerciseRecords[] {
  const heaviest = new Map<string, { load: number; reps: number; day: string }>();
  for (const r of results ?? []) {
    if (!r?.date || !(Number(r.load) > 0) || r.counts_load === false || r.analytics_load_outlier)
      continue;
    const k = exKey(r);
    const cur = heaviest.get(k);
    if (!cur || Number(r.load) > cur.load)
      heaviest.set(k, { load: Number(r.load), reps: Number(r.reps) || 0, day: localDay(r.date) });
  }
  const by = new Map<string, ExerciseRecords>();
  for (const rec of records) {
    const cur = by.get(rec.exerciseKey) ?? {
      exercise: rec.exercise,
      key: rec.exerciseKey,
      bestE1rm: null,
      heaviest: heaviest.get(rec.exerciseKey) ?? null,
      records: [],
      lastDay: rec.day,
    };
    cur.records.push(rec);
    cur.exercise = rec.exercise;
    if (!cur.bestE1rm || rec.e1rm > cur.bestE1rm.e1rm) cur.bestE1rm = rec;
    if (rec.day > cur.lastDay) cur.lastDay = rec.day;
    by.set(rec.exerciseKey, cur);
  }
  return [...by.values()].sort((a, b) => b.lastDay.localeCompare(a.lastDay));
}

export type Lifetime = {
  workouts: number;
  sets: number;
  reps: number;
  /** total weight moved, loaded sets (load × reps) */
  liftedLb: number;
  liftedKg: number;
  records: number;
  exercises: number;
  firstDay: string | null;
  activeWeeks: number;
  bestStreakWeeks: number;
  /** the week with the most records, and the block of months with the most */
  bestWeek: { monday: string; records: number } | null;
};

const DAY = 86_400_000;
const mondayOf = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * DAY).toISOString().slice(0, 10);
};

export function lifetimeTotals(results: any[], records: PersonalRecord[]): Lifetime {
  const days = new Set<string>();
  const weeks = new Set<string>();
  const exs = new Set<string>();
  let reps = 0;
  let lifted = 0;
  let sets = 0;
  let first: string | null = null;
  for (const r of results ?? []) {
    if (!r?.date || !(Number(r.reps) > 0)) continue;
    const d = localDay(r.date);
    days.add(d);
    weeks.add(mondayOf(d));
    exs.add(exKey(r));
    sets++;
    reps += Number(r.reps) || 0;
    if (r.counts_load !== false && !r.analytics_load_outlier)
      lifted += (Number(r.load) || 0) * (Number(r.reps) || 0);
    if (!first || d < first) first = d;
  }
  const sortedWeeks = [...weeks].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const w of sortedWeeks) {
    const t = Date.parse(`${w}T12:00:00Z`);
    run = prev != null && t - prev === 7 * DAY ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  const perWeek = new Map<string, number>();
  for (const r of records) perWeek.set(mondayOf(r.day), (perWeek.get(mondayOf(r.day)) ?? 0) + 1);
  let bestWeek: Lifetime["bestWeek"] = null;
  for (const [monday, n] of perWeek)
    if (!bestWeek || n > bestWeek.records) bestWeek = { monday, records: n };
  return {
    workouts: days.size,
    sets,
    reps,
    liftedLb: Math.round(lifted),
    liftedKg: Math.round(lifted / LB_PER_KG),
    records: records.length,
    exercises: exs.size,
    firstDay: first,
    activeWeeks: weeks.size,
    bestStreakWeeks: best,
    bestWeek: bestWeek && bestWeek.records >= 2 ? bestWeek : null,
  };
}

/** The next round number of pounds / kilograms moved, for a quiet "next milestone" line. */
export function nextLiftedMilestone(lb: number, unit: "lb" | "kg"): number {
  const v = unit === "kg" ? lb / LB_PER_KG : lb;
  const steps = [
    10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000,
  ];
  return steps.find((s) => s > v) ?? Math.ceil(v / 10_000_000 + 1) * 10_000_000;
}
