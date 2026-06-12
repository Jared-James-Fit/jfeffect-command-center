import { supabase } from "@/integrations/supabase/client";

export type WUnit = "kg" | "lb";

const sb = supabase as any;

/**
 * Per-exercise unit preference resolution.
 *
 * Priority (first wins):
 *   1. Client's saved preference for this exercise (client_exercise_unit_prefs)
 *   2. Auto-detected mode from the client's recent logged history for this exercise
 *   3. The coach's row-level default on this program row (pl_exercise_rows.load_unit)
 *   4. The exercise library default (exercises.default_load_unit)
 *   5. The workout-level / client-level default
 */
export function resolveExerciseUnit(args: {
  prefUnit?: WUnit | null;
  historyUnit?: WUnit | null;
  rowLoadUnit?: WUnit | null;
  exerciseDefault?: WUnit | null;
  workoutUnit: WUnit;
}): WUnit {
  return (
    args.prefUnit ||
    args.historyUnit ||
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

/** Upsert a single client/exercise unit preference. */
export async function saveExerciseUnitPref(
  clientId: string,
  exerciseId: string,
  unit: WUnit,
): Promise<void> {
  await sb
    .from("client_exercise_unit_prefs")
    .upsert({ client_id: clientId, exercise_id: exerciseId, unit }, { onConflict: "client_id,exercise_id" });
}

/** Bulk upsert prefs for many exercises in one call (used by the global toggle). */
export async function saveExerciseUnitPrefsBulk(
  clientId: string,
  exerciseIds: string[],
  unit: WUnit,
): Promise<void> {
  const rows = exerciseIds.filter(Boolean).map((id) => ({ client_id: clientId, exercise_id: id, unit }));
  if (!rows.length) return;
  await sb
    .from("client_exercise_unit_prefs")
    .upsert(rows, { onConflict: "client_id,exercise_id" });
}