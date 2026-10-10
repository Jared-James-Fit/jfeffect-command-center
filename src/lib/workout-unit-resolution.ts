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
 *   4. The coach's unit on the program row (pl_exercise_rows.load_unit)
 *   5. The exercise library default (exercises.default_load_unit)
 *   6. The workout default (kg for competition lifts, lb otherwise)
 *
 * Step 3 exists because athletes who squat in lb opened their first
 * Competition Squat in kg (the competition-lift default) and typed their lb
 * numbers into it: 305 lb saved as 305 kg (672 lb) and landed in the Hall of
 * Strength review (Jarrett, Marc, Nicolas, Colten, Shaina — Oct 2026).
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
  rowLoadUnit?: WUnit | null;
  exerciseDefault?: WUnit | null;
  workoutUnit: WUnit;
}): WUnit {
  return (
    args.prefUnit ||
    args.historyUnit ||
    args.familyUnit ||
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
  overrides: Record<string, WUnit>;
}): Record<string, WUnit> {
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
      rowLoadUnit: isUnit(r.load_unit) ? r.load_unit : null,
      exerciseDefault: libraryDefault,
      workoutUnit: isCompLift ? "kg" : "lb",
    });
    map[rowKey] = resolved;
    byExercise[preferenceKey] = resolved;
  }
  return map;
}
