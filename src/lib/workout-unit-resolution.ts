/**
 * Which unit (kg / lb) each exercise card in a workout uses.
 *
 * Pure on purpose (no network imports) so it can be unit-tested.
 *
 * Priority for an exercise (first wins):
 *   1. The client's saved preference for the exercise
 *   2. The most common unit in their recent logs of it
 *   3. For a squat / bench / deadlift variation, the most common unit in their
 *      recent logs of any lift in that family
 *   4. The athlete's own unit: the one they chose (clients.preferred_weight_unit
 *      once weight_unit_confirmed_at is set), else the unit nearly all their
 *      recent loaded logs are in (`athleteHabitUnit`)
 *   5. The coach's unit on the program row (pl_exercise_rows.load_unit)
 *   6. The exercise library default (exercises.default_load_unit)
 *   7. The workout default (kg for competition lifts, lb otherwise)
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
  athleteUnit?: WUnit | null;
  rowLoadUnit?: WUnit | null;
  exerciseDefault?: WUnit | null;
  workoutUnit: WUnit;
}): WUnit {
  return (
    args.prefUnit ||
    args.historyUnit ||
    args.familyUnit ||
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
  historyRows: any[];
  /** Recent logs of any exercise: { actual_load_unit, actual_load, pl_exercise_rows: { exercises: { movement_family } } } */
  familyHistoryRows?: any[];
  /** The unit the athlete chose (clients.preferred_weight_unit), only once they confirmed it. */
  athleteChosenUnit?: WUnit | null;
  overrides: Record<string, WUnit>;
}): Record<string, WUnit> {
  const athleteUnit = (isUnit(input.athleteChosenUnit) ? input.athleteChosenUnit : null)
    ?? athleteHabitUnit(input.familyHistoryRows);
  const prefByEx: Record<string, WUnit> = {};
  for (const p of input.prefRows) {
    if (p?.exercise_id && isUnit(p.unit)) prefByEx[p.exercise_id] = p.unit;
  }
  const historyByEx: Record<string, string[]> = {};
  for (const h of input.historyRows) {
    const exId = h?.pl_exercise_rows?.exercise_id;
    if (!exId) continue;
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
      historyUnit: exId ? modeUnit(historyByEx[exId] ?? []) : null,
      familyUnit: isMainLiftFamily(family) ? modeUnit(historyByFamily[family] ?? []) : null,
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
