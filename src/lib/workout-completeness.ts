/**
 * Shared workout completeness logic.
 *
 * Single source of truth used by both the coaching-client (`pl_*`) and
 * membership (`member_*`) backends. Pure functions only — no Supabase
 * imports — so they can run on server and client and be unit-tested.
 *
 * "Required sets" are the sets prescribed by the template (or 1 per
 * exercise when no prescribed count exists). "Meaningfully logged" means
 * at least one quantitative field is populated relative to the metric
 * type. Explicitly skipped exercises do NOT count against the user.
 */

export type LoggingQuality =
  | "complete"
  | "mostly_logged"
  | "partially_logged"
  | "minimal_logging"
  | "no_logs";

/** What kind of result counts a row as "logged". */
export type RowMetricKind =
  | "load_reps"   // standard strength
  | "bodyweight" // reps only
  | "timed"      // duration seconds
  | "distance"   // distance + optional time
  | "rpe_only";  // freeform/RPE only

export interface RequiredRowSpec {
  rowId: string;
  /** Prescribed set count. Falsy → assume 1. */
  prescribedSets?: number | null;
  metricKind: RowMetricKind;
  /** Row was explicitly marked as skipped. Doesn't count as missing. */
  skipped?: boolean;
}

export interface LoggedSetSpec {
  rowId: string;
  setIndex: number;
  reps?: number | null;
  loadLb?: number | null;
  loadKg?: number | null;
  rpe?: number | string | null;
  rir?: number | string | null;
  completedDurationSeconds?: number | null;
  distance?: number | null;
}

export interface CompletenessSummary {
  requiredSets: number;
  loggedSets: number;
  skippedExercises: number;
  loggingPercentage: number; // 0..100, rounded to 1 decimal
  loggingQuality: LoggingQuality;
  completedWithMissingLogs: boolean;
}

/** A set is "logged" if the kind-appropriate field has a real value. */
export function isSetMeaningfullyLogged(set: LoggedSetSpec, kind: RowMetricKind): boolean {
  const num = (v: unknown) =>
    v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;
  // For load values, accept zero as a valid logged value — 0 lb / 0 kg means
  // bodyweight or unloaded (e.g. assisted machines, paused holds, mobility
  // work). The set is still meaningfully logged as long as reps are present.
  const numOrZero = (v: unknown) =>
    v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
  switch (kind) {
    case "load_reps":
      return num(set.reps) && (numOrZero(set.loadLb) || numOrZero(set.loadKg));
    case "bodyweight":
      return num(set.reps);
    case "timed":
      return num(set.completedDurationSeconds);
    case "distance":
      return num(set.distance);
    case "rpe_only":
      return num(set.rpe) || num(set.rir) || num(set.reps);
    default:
      return false;
  }
}

export function countRequiredSets(rows: RequiredRowSpec[]): number {
  let total = 0;
  for (const r of rows) {
    if (r.skipped) continue;
    total += Math.max(1, Number(r.prescribedSets) || 1);
  }
  return total;
}

export function countLoggedSets(
  rows: RequiredRowSpec[],
  sets: LoggedSetSpec[],
): number {
  if (!sets.length) return 0;
  const kindByRow = new Map(rows.map((r) => [r.rowId, r.metricKind] as const));
  const skipped = new Set(rows.filter((r) => r.skipped).map((r) => r.rowId));
  let n = 0;
  for (const s of sets) {
    if (skipped.has(s.rowId)) continue;
    const kind = kindByRow.get(s.rowId) ?? "load_reps";
    if (isSetMeaningfullyLogged(s, kind)) n++;
  }
  return n;
}

export function countSkippedExercises(rows: RequiredRowSpec[]): number {
  return rows.reduce((n, r) => n + (r.skipped ? 1 : 0), 0);
}

/** Maps a 0-100 percentage to the shared quality bucket. */
export function categorizeLoggingQuality(percentage: number): LoggingQuality {
  if (!Number.isFinite(percentage) || percentage <= 0) return "no_logs";
  if (percentage >= 100) return "complete";
  if (percentage >= 80) return "mostly_logged";
  if (percentage >= 50) return "partially_logged";
  return "minimal_logging";
}

export function summarizeCompleteness(
  rows: RequiredRowSpec[],
  sets: LoggedSetSpec[],
): CompletenessSummary {
  const requiredSets = countRequiredSets(rows);
  const loggedSets = countLoggedSets(rows, sets);
  const skippedExercises = countSkippedExercises(rows);
  const loggingPercentage =
    requiredSets > 0
      ? Math.round((Math.min(loggedSets, requiredSets) / requiredSets) * 1000) / 10
      : 0;
  const loggingQuality = categorizeLoggingQuality(loggingPercentage);
  const completedWithMissingLogs = requiredSets > 0 && loggedSets < requiredSets;
  return {
    requiredSets,
    loggedSets,
    skippedExercises,
    loggingPercentage,
    loggingQuality,
    completedWithMissingLogs,
  };
}

/** An exercise row as the completeness check reads it (pl_exercise_rows + its exercise). */
export type CompletenessExerciseRow = {
  id: string;
  sets?: number | string | null;
  tracking_type?: string | null;
  measurement_type?: string | null;
  duration_seconds?: number | string | null;
  reps_text?: string | null;
  /** The plan's cardio row (workout-cardio.ts isPlanCardioRow): done any time that day, never a missed log. */
  cardio_target_id?: string | null;
  skipped?: boolean | null;
  exercises?: { default_measurement_type?: string | null } | null;
};

/**
 * The sets a workout asks for, one entry per exercise row: Finish and the
 * re-sync after a finished workout is edited (syncFinishedWorkout) read a
 * workout the same way, so its stored logged % never depends on which one ran.
 */
export function requiredRowsFromExerciseRows(rows: readonly CompletenessExerciseRow[]): RequiredRowSpec[] {
  return rows
    .filter((r) => !r?.cardio_target_id)
    .map((r) => ({
      rowId: String(r.id),
      prescribedSets: Math.max(1, Number(r.sets) || 1),
      skipped: !!r.skipped,
      metricKind: (
        r?.tracking_type === "time" ||
        r?.measurement_type === "time" ||
        r?.exercises?.default_measurement_type === "time" ||
        (r?.duration_seconds != null && Number(r.duration_seconds) > 0) ||
        /\b(sec(onds?)?|min(utes?)?)\b/i.test(String(r?.reps_text ?? ""))
      ) ? "timed" : "load_reps",
    }));
}

/** The completion row's stored numbers, as summarizeCompleteness writes them. */
export type StoredCompleteness = {
  required_sets_count?: number | null;
  logged_sets_count?: number | null;
  skipped_exercises_count?: number | null;
  logging_percentage?: number | string | null;
  logging_quality?: string | null;
  completed_with_missing_logs?: boolean | null;
};

/** The completion row's fields that differ from a fresh summary (empty when it's in step). */
export function completenessPatch(stored: StoredCompleteness | null | undefined, s: CompletenessSummary): Partial<{
  required_sets_count: number;
  logged_sets_count: number;
  skipped_exercises_count: number;
  logging_percentage: number;
  logging_quality: LoggingQuality;
  completed_with_missing_logs: boolean;
}> {
  const out: Record<string, unknown> = {};
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  if (num(stored?.required_sets_count) !== s.requiredSets) out.required_sets_count = s.requiredSets;
  if (num(stored?.logged_sets_count) !== s.loggedSets) out.logged_sets_count = s.loggedSets;
  if (num(stored?.skipped_exercises_count) !== s.skippedExercises) out.skipped_exercises_count = s.skippedExercises;
  if (num(stored?.logging_percentage) !== s.loggingPercentage) out.logging_percentage = s.loggingPercentage;
  if ((stored?.logging_quality ?? null) !== s.loggingQuality) out.logging_quality = s.loggingQuality;
  if ((stored?.completed_with_missing_logs ?? null) !== s.completedWithMissingLogs) out.completed_with_missing_logs = s.completedWithMissingLogs;
  return out as any;
}

/**
 * Estimated workout duration in minutes, derived from prescribed sets +
 * per-row rest. Used by the workout-open screen's time pill so the
 * estimate adapts to what's actually programmed instead of a static
 * coach-entered value. Formula per row:
 *
 *   sets × (avgSetSeconds + restSecondsForCategory)
 *
 * Defaults to a 40s work set and a category-aware rest midpoint when the
 * row doesn't carry an explicit `rest_seconds` value.
 */
export interface EstimatedDurationRow {
  prescribedSets?: number | null;
  restSeconds?: number | null;
  category?: string | null;
  /** Average work time per set, defaults to 40s for strength rows. */
  avgSetSeconds?: number | null;
  skipped?: boolean | null;
}

const REST_MIDPOINT_BY_CATEGORY: Record<string, number> = {
  squat: 180, deadlift: 180, bench: 150, "bench press": 150,
  compound: 150, strength: 120, hypertrophy: 75, accessory: 75,
  isolation: 60, core: 45, cardio: 30, conditioning: 30,
};

function restMidpoint(category?: string | null): number {
  if (!category) return 90;
  const key = String(category).trim().toLowerCase();
  return REST_MIDPOINT_BY_CATEGORY[key] ?? 90;
}

export function estimateWorkoutDurationMinutes(rows: EstimatedDurationRow[]): number {
  let totalSeconds = 0;
  for (const r of rows) {
    if (r.skipped) continue;
    const sets = Math.max(1, Number(r.prescribedSets) || 1);
    const avgSet = Number.isFinite(Number(r.avgSetSeconds)) && Number(r.avgSetSeconds) > 0
      ? Number(r.avgSetSeconds)
      : 40;
    const rest = Number.isFinite(Number(r.restSeconds)) && Number(r.restSeconds) > 0
      ? Number(r.restSeconds)
      : restMidpoint(r.category);
    totalSeconds += sets * (avgSet + rest);
  }
  return Math.max(5, Math.round(totalSeconds / 60));
}

/** Display range "low–high min" suitable for a pill badge. */
export function estimatedDurationLabel(rows: EstimatedDurationRow[]): string | null {
  if (!rows || rows.length === 0) return null;
  const min = estimateWorkoutDurationMinutes(rows);
  if (!Number.isFinite(min) || min <= 0) return null;
  const low = Math.max(5, Math.round((min * 0.9) / 5) * 5);
  const high = Math.round((min * 1.1) / 5) * 5;
  return low === high ? `${min} min` : `${low}–${high} min`;
}