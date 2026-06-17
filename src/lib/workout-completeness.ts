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