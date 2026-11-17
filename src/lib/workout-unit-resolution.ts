/**
 * Which unit (kg / lb) each exercise card in a workout uses.
 *
 * Pure on purpose (no network imports) so it can be unit-tested.
 *
 * Priority for an exercise (first wins):
 *   1. The client's saved preference for the exercise (they tapped kg / lb on it)
 *   2. The unit of their latest logs of it (`recentUnit`: the newest few loaded
 *      sets, so a lift they moved from kg to lb follows the move)
 *   3. For a squat / bench / deadlift variation, the unit of their latest logs
 *      of any lift in that family
 *   4. The unit nearly all their recent loaded logs are in (`athleteHabitUnit`)
 *   5. The account's unit (clients.preferred_weight_unit once
 *      weight_unit_confirmed_at is set): only when the logs show no habit
 *   6. The coach's unit on the program row (pl_exercise_rows.load_unit)
 *   7. The exercise library default (exercises.default_load_unit)
 *   8. The workout default (kg for competition lifts, lb otherwise)
 *
 * Step 3 exists because athletes who squat in lb opened their first
 * Competition Squat in kg (the competition-lift default) and typed their lb
 * numbers into it: 305 lb saved as 305 kg (672 lb) and landed in the Hall of
 * Strength review (Jarrett, Marc, Nicolas, Colten, Shaina — Oct 2026).
 *
 * Step 4 exists because a lift with no family history still fell to the kg
 * default: Nicolas logs everything in lb, yet his first Competition Deadlift
 * (Oct 10 2026, his deadlift family empty: RDLs are a hinge) opened in kg and
 * 135 / 185 / 205 lb saved as kg, so the next deadlift day suggested 440 lb.
 *
 * Step 4 comes before step 5 because what someone actually logs is the
 * equipment in their gym, and the account's unit is also the unit for maxes,
 * bodyweight and analytics: Jared McIntyre's account said kg (stamped
 * "confirmed" by a migration, never chosen; all 68 of his weigh-ins are lb)
 * while 148 of his last 150 loaded sets were lb, so every exercise he'd never
 * logged opened in kg (Nov 16 2026: 15 lb Cable Hip Adduction and a 25 lb
 * Pull Up saved as kg, which then kept those cards in kg).
 *
 * Steps 2 and 3 read the newest logs, never a vote over a mixed window: his
 * Competition Deadlift had 8 kg sets from October under 4 lb sets from
 * November, and a majority vote put it back in kg.
 *
 * One unit per exercise per workout: the first card of an exercise decides and
 * every later card of that exercise follows. Resolving cards independently let
 * a backoff the coach prescribed in kg open in kg while the top set of the same
 * exercise opened in lb, so "135" typed on the backoff saved as 135 kg
 * (297.6 lb) — Jared McIntyre, Paused Bench, Oct 2026.
 */

export type WUnit = "kg" | "lb";

export function resolveExerciseUnit(args: {
  prefUnit?: WUnit | null;
  historyUnit?: WUnit | null;
  familyUnit?: WUnit | null;
  /** What the athlete's recent loaded logs are nearly all in. */
  habitUnit?: WUnit | null;
  /** The account's confirmed unit (only used when there's no habit). */
  athleteUnit?: WUnit | null;
  rowLoadUnit?: WUnit | null;
  exerciseDefault?: WUnit | null;
  workoutUnit: WUnit;
}): WUnit {
  return (
    args.prefUnit ||
    args.historyUnit ||
    args.familyUnit ||
    args.habitUnit ||
    args.athleteUnit ||
    args.rowLoadUnit ||
    args.exerciseDefault ||
    args.workoutUnit
  );
}

/** Pick the most-common unit from a list of recent logged units. */
export function modeUnit(units: (string | null | undefined)[]): WUnit | null {
  let kg = 0;
  let lb = 0;
  for (const u of units) {
    if (u === "kg") kg++;
    else if (u === "lb") lb++;
  }
  if (kg === 0 && lb === 0) return null;
  return kg > lb ? "kg" : "lb";
}

const isUnit = (u: unknown): u is WUnit => u === "kg" || u === "lb";

/** How many of an exercise's newest loaded sets decide its unit (about one session). */
export const RECENT_EXERCISE_LOGS = 3;
/** How many of a lift family's newest loaded sets decide its unit. */
export const RECENT_FAMILY_LOGS = 6;

/**
 * The unit of the newest logs (`units` newest first): the majority of the first
 * `take`, a tie going to the newest. Null when there are none.
 */
export function recentUnit(units: (string | null | undefined)[], take: number): WUnit | null {
  const recent = units.filter(isUnit).slice(0, Math.max(1, take));
  if (!recent.length) return null;
  const kg = recent.filter((u) => u === "kg").length;
  const lb = recent.length - kg;
  if (kg === lb) return recent[0];
  return kg > lb ? "kg" : "lb";
}

/**
 * A log's unit only means something when a weight was typed: a bodyweight set
 * saved as "0 kg" (or with no load) took whatever the card showed. Logs that
 * don't carry `actual_load` at all (an older caller) are counted.
 */
const carriesLoad = (h: any): boolean =>
  !h || !("actual_load" in h) ? true : Number(h.actual_load) > 0;

/** A habit needs this many recent loaded logs… */
export const ATHLETE_HABIT_MIN_LOGS = 5;
/** …and this share of them in one unit (a kg machine or two in an lb gym is still lb). */
export const ATHLETE_HABIT_SHARE = 0.75;

/**
 * The unit an athlete logs in, from their recent loaded logs of anything
 * (`{ actual_load_unit, actual_load }`), or null when there's no clear habit.
 */
export function athleteHabitUnit(logs: any[] | null | undefined): WUnit | null {
  let kg = 0;
  let lb = 0;
  for (const h of logs ?? []) {
    if (!(Number(h?.actual_load) > 0)) continue;
    if (h?.actual_load_unit === "kg") kg++;
    else if (h?.actual_load_unit === "lb") lb++;
  }
  const total = kg + lb;
  if (total < ATHLETE_HABIT_MIN_LOGS) return null;
  if (lb / total >= ATHLETE_HABIT_SHARE) return "lb";
  if (kg / total >= ATHLETE_HABIT_SHARE) return "kg";
  return null;
}

/** Families where plates make the unit habitual (exercises.movement_family). */
const MAIN_LIFT_FAMILIES = new Set(["squat", "bench", "deadlift"]);
export const isMainLiftFamily = (family: unknown): family is string =>
  typeof family === "string" && MAIN_LIFT_FAMILIES.has(family);

/** Map `row:<id>` -> unit for every exercise row in the workout. */
export function resolveWorkoutRowUnits(input: {
  rows: any[];
  prefRows: any[];
  /** Logs of this workout's exercises, newest first: { actual_load_unit, actual_load?, pl_exercise_rows: { exercise_id } } */
  historyRows: any[];
  /** The athlete's recent logs of anything, newest first: { actual_load_unit, actual_load, pl_exercise_rows: { exercises: { movement_family } } } */
  familyHistoryRows?: any[];
  /** The unit the account says (clients.preferred_weight_unit), only once confirmed. */
  athleteChosenUnit?: WUnit | null;
  /**
   * The athlete's habit as last read on this device: stands in for
   * `familyHistoryRows` until they've loaded (undefined), so the first paint
   * already shows the unit the logs will.
   */
  habitHint?: WUnit | null;
  overrides: Record<string, WUnit>;
}): Record<string, WUnit> {
  const habitUnit = input.familyHistoryRows === undefined
    ? (isUnit(input.habitHint) ? input.habitHint : null)
    : athleteHabitUnit(input.familyHistoryRows);
  const athleteUnit = isUnit(input.athleteChosenUnit) ? input.athleteChosenUnit : null;
  const prefByEx: Record<string, WUnit> = {};
  for (const p of input.prefRows) {
    if (p?.exercise_id && isUnit(p.unit)) prefByEx[p.exercise_id] = p.unit;
  }
  const historyByEx: Record<string, string[]> = {};
  for (const h of input.historyRows) {
    const exId = h?.pl_exercise_rows?.exercise_id;
    if (!exId || !carriesLoad(h)) continue;
    (historyByEx[exId] ||= []).push(h.actual_load_unit);
  }
  const historyByFamily: Record<string, string[]> = {};
  for (const h of input.familyHistoryRows ?? []) {
    const family = h?.pl_exercise_rows?.exercises?.movement_family;
    if (!isMainLiftFamily(family)) continue;
    if (h.actual_load != null && !(Number(h.actual_load) > 0)) continue;
    (historyByFamily[family] ||= []).push(h.actual_load_unit);
  }

  const map: Record<string, WUnit> = {};
  const byExercise: Record<string, WUnit> = {};
  for (const r of input.rows) {
    const exId = r.exercises?.id ?? r.exercise_id ?? null;
    const rowKey = `row:${r.id}`;
    // Unit choice belongs to the canonical exercise, not the program row, so
    // repeated cards for the same exercise always agree and switch together.
    const preferenceKey = exId ? `exercise:${exId}` : rowKey;
    const decided = byExercise[preferenceKey];
    if (decided) {
      map[rowKey] = decided;
      continue;
    }
    const isCompLift =
      r.exercises?.is_competition_lift === true ||
      r.exercises?.competition_lift_type === "squat" ||
      r.exercises?.competition_lift_type === "bench" ||
      r.exercises?.competition_lift_type === "deadlift";
    const libraryDefault: WUnit = isUnit(r.exercises?.default_load_unit)
      ? r.exercises.default_load_unit
      : (isCompLift ? "kg" : "lb");
    const family = r.exercises?.movement_family;
    const resolved = input.overrides[preferenceKey] ?? resolveExerciseUnit({
      prefUnit: exId ? prefByEx[exId] ?? null : null,
      historyUnit: exId ? recentUnit(historyByEx[exId] ?? [], RECENT_EXERCISE_LOGS) : null,
      familyUnit: isMainLiftFamily(family) ? recentUnit(historyByFamily[family] ?? [], RECENT_FAMILY_LOGS) : null,
      habitUnit,
      athleteUnit,
      rowLoadUnit: isUnit(r.load_unit) ? r.load_unit : null,
      exerciseDefault: libraryDefault,
      workoutUnit: isCompLift ? "kg" : "lb",
    });
    map[rowKey] = resolved;
    byExercise[preferenceKey] = resolved;
  }
  return map;
}

/**
 * The athlete's habit as last read on this phone (a per-device first-paint
 * hint, never the source of truth: the logs replace it as soon as they load).
 */
const HABIT_HINT_KEY = (clientId: string) => `jf:unit-habit:${clientId}`;

export function readUnitHabitHint(clientId: string | null | undefined): WUnit | null {
  if (!clientId) return null;
  try {
    const v = globalThis.localStorage?.getItem(HABIT_HINT_KEY(clientId));
    return isUnit(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeUnitHabitHint(clientId: string, unit: WUnit | null): void {
  try {
    const store = globalThis.localStorage;
    if (!store) return;
    if (unit) store.setItem(HABIT_HINT_KEY(clientId), unit);
    else store.removeItem(HABIT_HINT_KEY(clientId));
  } catch {
    /* storage unavailable */
  }
}
