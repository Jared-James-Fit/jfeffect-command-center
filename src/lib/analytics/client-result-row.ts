/**
 * One logged set as every analytics read sees it (getClientResults): the
 * select and the mapping, shared by the browser loader and the server reads
 * that must say the same numbers (a specialist's Performance tab). Pure.
 */
import { epley1RM } from "@/lib/analytics/e1rm";

/** The select getClientResults reads pl_row_results with. */
export const CLIENT_RESULT_SELECT =
  "id, set_index, actual_load, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, actual_reps, actual_rpe, actual_rir, mean_concentric_velocity_mps, velocity_excluded, velocity_quality, velocity_uncertainty, is_bodyweight, load_type, notes, completed_at, completed_duration_seconds, row_id, pl_exercise_rows(exercise_id, exercise_name_override, day_id, sort_order, purpose_label, movement_family, exercises(name, muscle_group, primary_muscle_group, muscle_groups, secondary_muscle_groups, counts_toward_volume, category, competition_lift_type, is_competition_lift, movement_family, primary_movement_pattern))";

/**
 * What a logged set carries in lb. Prefers the stored normalized mirrors,
 * then the entered unit: never sums kg-logged sets as lb.
 */
export function resultLoadLb(r: {
  normalized_lb?: number | string | null;
  normalized_kg?: number | string | null;
  entered_value?: number | string | null;
  entered_unit?: string | null;
  actual_load?: number | string | null;
  actual_load_unit?: string | null;
}): number {
  if (r.normalized_lb != null) return Number(r.normalized_lb) || 0;
  if (r.normalized_kg != null) return (Number(r.normalized_kg) || 0) * 2.2046226;
  const n = Number(r.entered_value ?? r.actual_load) || 0;
  return (r.entered_unit ?? r.actual_load_unit ?? "lb") === "kg" ? n * 2.2046226 : n;
}

/** One row of CLIENT_RESULT_SELECT as the analytics read it (load always in lb). */
export function mapClientResultRow(r: any) {
  const loadLb = resultLoadLb(r);
  const loadType: "external" | "bodyweight" | "assisted" =
    r.load_type === "assisted" || r.load_type === "bodyweight" || r.load_type === "external"
      ? r.load_type
      : r.is_bodyweight === true
        ? "bodyweight"
        : "external";
  const isBodyweight = loadType === "bodyweight";
  const isAssisted = loadType === "assisted";
  // A set carries external load only when a positive load was logged.
  // Bodyweight (and legacy zero-load) sets are still real, completed sets:
  // they must survive into set counts, reps, adherence and frequency, but
  // they must never produce a 0 lb "PR" or fake tonnage.
  // Assisted sets carry a POSITIVE assistance number, not external load.
  // They count as real sets/reps/volume-by-muscle, but must never inflate
  // "Weight Lifted" tonnage or produce external-load PRs.
  const hasLoad = loadLb > 0 && !isAssisted;
  return {
    id: r.id,
    set_index: r.set_index,
    // `load` is now ALWAYS in LB. Display code is responsible for
    // converting to the viewer's preferred unit before rendering.
    load: isAssisted ? 0 : loadLb,
    is_bodyweight: isBodyweight,
    load_type: loadType,
    /** Assistance amount in LB (assisted sets only). Lower is better. */
    assist_lb: isAssisted ? loadLb : null,
    counts_load: hasLoad,
    reps: Number(r.actual_reps) || 0,
    rpe: r.actual_rpe ?? null,
    rir: r.actual_rir ?? null,
    velocity_mps:
      !r.velocity_excluded && r.mean_concentric_velocity_mps != null
        ? Number(r.mean_concentric_velocity_mps)
        : null,
    velocity_quality: r.velocity_quality ?? null,
    velocity_uncertainty: r.velocity_uncertainty ?? null,
    exercise_note: r.notes ?? null,
    duration_seconds: r.completed_duration_seconds ?? null,
    row_id: r.row_id,
    day_id: r.pl_exercise_rows?.day_id ?? null,
    /** The row's place in its workout: with set_index, the order sets were done. */
    row_order: r.pl_exercise_rows?.sort_order ?? 0,
    purpose_label: r.pl_exercise_rows?.purpose_label ?? null,
    movement_family: r.pl_exercise_rows?.movement_family ?? null,
    date: r.completed_at,
    est_1rm: hasLoad ? epley1RM(loadLb, Number(r.actual_reps) || 0) : 0,
    exercise_id: r.pl_exercise_rows?.exercise_id ?? null,
    exercise_name:
      r.pl_exercise_rows?.exercises?.name ??
      r.pl_exercise_rows?.exercise_name_override ??
      "Unknown",
    muscle_group:
      r.pl_exercise_rows?.exercises?.primary_muscle_group ??
      r.pl_exercise_rows?.exercises?.muscle_group ??
      "Other",
    primary_muscles: (r.pl_exercise_rows?.exercises?.muscle_groups ?? []) as string[],
    secondary_muscles: (r.pl_exercise_rows?.exercises?.secondary_muscle_groups ?? []) as string[],
    counts_toward_volume: r.pl_exercise_rows?.exercises?.counts_toward_volume !== false,
    category: r.pl_exercise_rows?.exercises?.category ?? null,
    // what training-load.ts reads a set's lift and movement pattern from
    competition_lift_type: r.pl_exercise_rows?.exercises?.competition_lift_type ?? null,
    is_competition_lift: r.pl_exercise_rows?.exercises?.is_competition_lift === true,
    exercise_movement_family: r.pl_exercise_rows?.exercises?.movement_family ?? null,
    primary_movement_pattern: r.pl_exercise_rows?.exercises?.primary_movement_pattern ?? null,
  };
}
