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
 * The app's one reps × reps-in-reserve model (the RTS chart): %1RM at RPE 10
 * for 1..12 reps, an effort read as reps + RIR. The suggested weights are
 * backtested on it (load-suggestion.ts) and every estimated max reads it, so a
 * suggestion and an estimate never read the same set two ways.
 */
export const PCT_AT_RPE10 = [1.0, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68];
/**
 * Effective reps (reps + RIR) the chart still answers for. Past 12 it is an
 * Epley-shaped tail: rough as an absolute %1RM, but only used to move between
 * nearby rep counts.
 */
export const MAX_EFFECTIVE_REPS = 30;

/** Fraction of 1RM for `reps` performed with `rir` reps left in the tank. */
export function percentOf1RM(reps: number, rir: number): number | null {
  const e = reps + Math.max(0, rir);
  if (!Number.isFinite(e) || e < 1 || e > MAX_EFFECTIVE_REPS) return null;
  if (e <= PCT_AT_RPE10.length) {
    const lo = Math.floor(e);
    const hi = Math.ceil(e);
    const a = PCT_AT_RPE10[lo - 1];
    const b = PCT_AT_RPE10[hi - 1];
    return a + (b - a) * (e - lo);
  }
  const n = PCT_AT_RPE10.length;
  return PCT_AT_RPE10[n - 1] * ((1 + n / 30) / (1 + e / 30));
}

/**
 * RPE-adjusted e1RM on the chart (`percentOf1RM`): the load over the share of
 * a max that reps × reps-left means. With no RPE, the formula named (Epley by
 * default) on the reps done.
 */
export function estimate1RMWithRpe(
  load: number,
  reps: number,
  rpe: number | string | null | undefined,
  formula: E1RMFormula = "epley",
): number {
  const rir = rpeToRir(rpe);
  if (rir == null) return estimate1RM(load, reps, formula);
  if (!load || !reps || reps < 1) return 0;
  const pct = percentOf1RM(reps, rir);
  return pct && pct > 0 ? Math.round((load / pct) * 10) / 10 : 0;
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