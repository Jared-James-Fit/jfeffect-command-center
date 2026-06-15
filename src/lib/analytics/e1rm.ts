/**
 * Unified estimated 1RM (e1RM) calculations.
 *
 * Single source of truth for e1RM math across the app. Other modules
 * (block-analytics, pl-programs, coach-intel, etc.) MUST import from here
 * rather than redefining their own formula, so powerlifting and bodybuilding
 * analytics stay consistent.
 */

/** Default formula. Epley with reps=1 short-circuit, rounded to 0.1. */
export function epley1RM(load: number, reps: number): number {
  if (!load || !reps || reps < 1) return 0;
  if (reps === 1) return load;
  return Math.round(load * (1 + reps / 30) * 10) / 10;
}

/**
 * Brzycki — slightly more conservative at high rep counts.
 * Returns 0 for reps >= 37 (formula breaks down).
 */
export function brzycki1RM(load: number, reps: number): number {
  if (!load || !reps || reps < 1 || reps >= 37) return 0;
  if (reps === 1) return load;
  return Math.round((load * 36) / (37 - reps) * 10) / 10;
}

export type E1RMFormula = "epley" | "brzycki";

/** Compute e1RM with the named formula (defaults to Epley). */
export function estimate1RM(
  load: number,
  reps: number,
  formula: E1RMFormula = "epley",
): number {
  return formula === "brzycki" ? brzycki1RM(load, reps) : epley1RM(load, reps);
}

/**
 * RPE → reps-in-reserve. Returns null for non-numeric input.
 * RPE 10 = 0 RIR, RPE 9.5 = 0.5 RIR, ... down to RPE 6 = 4 RIR.
 */
export function rpeToRir(rpe: number | string | null | undefined): number | null {
  if (rpe == null) return null;
  const n = typeof rpe === "number" ? rpe : parseFloat(String(rpe));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, 10 - n);
}

/**
 * RPE-adjusted e1RM. If RPE is provided, treat the set as if the lifter had
 * done `reps + rir` reps at the same load. Falls back to plain Epley when no
 * RPE is supplied.
 */
export function estimate1RMWithRpe(
  load: number,
  reps: number,
  rpe: number | string | null | undefined,
  formula: E1RMFormula = "epley",
): number {
  const rir = rpeToRir(rpe);
  const effectiveReps = rir == null ? reps : reps + rir;
  return estimate1RM(load, effectiveReps, formula);
}

/**
 * Heuristic for whether a logged set should count as a "working set" for
 * analytics (volume, e1RM trends, PRs). Warmup-style sets are excluded.
 *
 * A set is treated as working when:
 *   - load and reps are present and > 0, AND
 *   - either RPE is omitted/null OR RPE >= 6 (RPE < 6 is typical warmup territory).
 *
 * Callers that have an explicit `is_working_set` flag on the row should prefer
 * that and use this only as a fallback.
 */
export function isWorkingSet(opts: {
  load: number | null | undefined;
  reps: number | null | undefined;
  rpe?: number | string | null | undefined;
}): boolean {
  const load = Number(opts.load) || 0;
  const reps = Number(opts.reps) || 0;
  if (load <= 0 || reps <= 0) return false;
  if (opts.rpe == null || opts.rpe === "") return true;
  const n = typeof opts.rpe === "number" ? opts.rpe : parseFloat(String(opts.rpe));
  if (!Number.isFinite(n)) return true;
  return n >= 6;
}