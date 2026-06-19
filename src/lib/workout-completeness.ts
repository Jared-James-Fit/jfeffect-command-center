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
  switch (kind) {
    case "load_reps":
      return num(set.reps) && (num(set.loadLb) || num(set.loadKg));
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