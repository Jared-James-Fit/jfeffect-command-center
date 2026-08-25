/**
 * Estimated workout duration — resolution + formatting.
 *
 * Canonical sources, in priority order (most specific wins):
 *   1. pl_days.duration_override_min  — coach explicitly set this day
 *   2. pl_days.duration_estimate_min  — stored day-level estimate
 *   3. pl_blocks.estimated_minutes    — block-level per-workout estimate
 *   4. estimateDayMinutes(rows)       — deterministic fallback computed
 *      from the prescribed sets/rest of the day's exercise rows
 *      (src/lib/pl-programs.ts — the same estimator program planning uses)
 *
 * This module adds NO new duration storage. Estimated (pre-workout) and
 * actual (post-workout, pl_day_completions.actual_duration_min) durations
 * stay strictly separate; nothing here writes to either.
 */
import { estimateDayMinutes, type RowForEstimate } from "@/lib/pl-programs";

export interface DayEstimateFields {
  duration_override_min?: number | null;
  duration_estimate_min?: number | null;
}

export interface BlockEstimateFields {
  estimated_minutes?: number | null;
}

function positive(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/**
 * Resolve the best available estimated duration in minutes for a workout day.
 * Returns null when no estimate exists (callers render nothing — graceful).
 */
export function resolveEstimatedWorkoutMinutes(opts: {
  day?: DayEstimateFields | null;
  block?: BlockEstimateFields | null;
  rows?: RowForEstimate[] | null;
}): number | null {
  const fromDayOverride = positive(opts.day?.duration_override_min);
  if (fromDayOverride != null) return fromDayOverride;
  const fromDayEstimate = positive(opts.day?.duration_estimate_min);
  if (fromDayEstimate != null) return fromDayEstimate;
  const fromBlock = positive(opts.block?.estimated_minutes);
  if (fromBlock != null) return fromBlock;
  const rows = opts.rows ?? [];
  if (rows.length > 0) return estimateDayMinutes(rows);
  return null;
}

/** Compact display: "≈ 45 min". Empty string when there is no estimate. */
export function formatEstimatedMinutes(min: number | null | undefined): string {
  const v = positive(min);
  return v == null ? "" : `≈ ${v} min`;
}
