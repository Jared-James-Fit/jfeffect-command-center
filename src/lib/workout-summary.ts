// Auto-derive a workout summary from logged set results.
// Stays intentionally simple — completion %, with light boost for notes,
// light penalty for pain. No DB schema changes.

export type SummaryRow = {
  id: string;
  sets?: number | null;
  exercises?: { id?: string | null; name?: string | null } | null;
  exercise_name_override?: string | null;
  /** Row was explicitly marked as skipped. Doesn't count against completion. */
  skipped?: boolean | null;
  /** Present for timed exercises (planks, holds, cardio). */
  measurement_type?: string | null;
  tracking_type?: string | null;
};

export type SummaryResult = {
  row_id: string;
  actual_load: number | null;
  actual_reps: number | null;
  actual_load_unit: "kg" | "lb" | null;
  actual_rpe: number | null;
  completed_at: string | null;
  /** Set duration for timed exercises. A set counts as completed when >0. */
  completed_duration_seconds?: number | null;
};

const KG_PER_LB = 0.45359237;
const LB_PER_KG = 1 / KG_PER_LB;

function toUnit(load: number, from: "kg" | "lb" | null | undefined, to: "kg" | "lb"): number {
  if (!from || from === to) return load;
  return from === "kg" ? load * LB_PER_KG : load * KG_PER_LB;
}

export type WorkoutSummary = {
  displayUnit: "kg" | "lb";
  prescribedSets: number;
  completedSets: number;
  completionPct: number;
  totalReps: number;
  totalLifted: number;          // in displayUnit
  totalLiftedFmt: string;       // "18,450 lb"
  exercisesTotal: number;
  exercisesCompleted: number;
  missedExercises: string[];
  avgRpe: number | null;
  score: number;                // 0-100
};

type Opts = {
  displayUnit?: "kg" | "lb";
  hasPain?: boolean;
  hasNote?: boolean;
};

export function computeWorkoutSummary(
  rows: SummaryRow[],
  results: SummaryResult[],
  opts: Opts = {},
): WorkoutSummary {
  const displayUnit = opts.displayUnit ?? "lb";

  const byRow = new Map<string, SummaryResult[]>();
  for (const r of results) {
    if (!byRow.has(r.row_id)) byRow.set(r.row_id, []);
    byRow.get(r.row_id)!.push(r);
  }

  let prescribedSets = 0;
  let completedSets = 0;
  let totalReps = 0;
  let totalLifted = 0;
  let rpeSum = 0;
  let rpeCount = 0;
  let exercisesCompleted = 0;
  const missedExercises: string[] = [];

  for (const row of rows) {
    // Explicitly skipped rows don't count for or against the score.
    if (row.skipped) continue;
    const sets = Math.max(0, Number(row.sets ?? 0));
    prescribedSets += sets;
    // A set counts as completed if it has reps logged OR duration logged
    // (timed exercises like planks/holds/cardio don't populate actual_reps).
    const rs = (byRow.get(row.id) ?? []).filter(
      (r) =>
        (Number(r.actual_reps ?? 0) > 0) ||
        (Number(r.completed_duration_seconds ?? 0) > 0),
    );
    if (rs.length > 0) {
      exercisesCompleted += 1;
      for (const r of rs) {
        completedSets += 1;
        const reps = Number(r.actual_reps ?? 0);
        totalReps += reps;
        const load = Number(r.actual_load ?? 0);
        if (load > 0 && reps > 0) {
          totalLifted += toUnit(load, r.actual_load_unit, displayUnit) * reps;
        }
        if (r.actual_rpe != null) {
          rpeSum += Number(r.actual_rpe);
          rpeCount += 1;
        }
      }
    } else {
      const name = row.exercise_name_override || row.exercises?.name || "Exercise";
      missedExercises.push(name);
    }
  }

  const completionPct = prescribedSets > 0
    ? Math.min(100, Math.round((completedSets / prescribedSets) * 100))
    : (exercisesCompleted > 0 ? 100 : 0);

  let score = completionPct;
  if (opts.hasPain) score -= 10;
  if (opts.hasNote) score += 3;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const totalLiftedRounded = Math.round(totalLifted);
  const consideredRows = rows.filter((r) => !r.skipped).length;

  return {
    displayUnit,
    prescribedSets,
    completedSets,
    completionPct,
    totalReps,
    totalLifted: totalLiftedRounded,
    totalLiftedFmt: `${totalLiftedRounded.toLocaleString()} ${displayUnit}`,
    exercisesTotal: consideredRows,
    exercisesCompleted,
    missedExercises,
    avgRpe: rpeCount > 0 ? Math.round((rpeSum / rpeCount) * 10) / 10 : null,
    score,
  };
}
