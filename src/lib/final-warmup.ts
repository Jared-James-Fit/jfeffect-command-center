/**
 * Logged warm-up sets (optional, any external-load exercise).
 *
 * They live in their own table (pl_warmup_sets), never in pl_row_results: that
 * table feeds records, tonnage, league points, completion and coach review, none
 * of which should ever see a warm-up. The load-suggestion engine reads only the
 * heaviest warm-up of the day (the "final" one) — see load-suggestion.ts, note 8.
 */
import { classifyExercise, type MovementPattern } from "@/lib/exercise-classifier";
import { percentOf1RM } from "@/lib/load-suggestion";

export type WarmupUnit = "kg" | "lb";

export interface WarmupSetRow {
  id: string;
  load: number;
  unit: WarmupUnit;
  reps: number;
  /** How hard it felt (6–10), or null when the athlete didn't say. */
  rpe: number | null;
  created_at?: string;
}

const KG_PER_LB = 0.45359237;

export function warmupInUnit(
  w: Pick<WarmupSetRow, "load" | "unit" | "reps" | "rpe">,
  unit: WarmupUnit,
): { load: number; reps: number; rpe: number | null } {
  const load = w.unit === unit ? w.load : unit === "kg" ? w.load * KG_PER_LB : w.load / KG_PER_LB;
  return { load, reps: w.reps, rpe: w.rpe };
}

/** Normalises a raw DB row (numeric columns can arrive as strings). */
export function normalizeWarmupRow(r: any): WarmupSetRow | null {
  const load = Number(r?.load);
  const reps = Number(r?.reps);
  if (!(load > 0) || !(reps >= 1) || (r?.unit !== "kg" && r?.unit !== "lb")) return null;
  const rpe = r?.rpe == null ? null : Number(r.rpe);
  return {
    id: String(r.id),
    load,
    unit: r.unit,
    reps,
    rpe: rpe != null && Number.isFinite(rpe) ? rpe : null,
    created_at: r.created_at,
  };
}

/** The "final" warm-up = the heaviest one logged (ties: the latest), in the display unit. */
export function pickFinalWarmup(
  sets: WarmupSetRow[],
  unit: WarmupUnit,
): { load: number; reps: number; rpe: number | null } | null {
  let best: { load: number; reps: number; rpe: number | null } | null = null;
  for (const s of sets) {
    const c = warmupInUnit(s, unit);
    if (!best || c.load >= best.load) best = c;
  }
  return best;
}

/** Human summary: "140 kg × 2 · RPE 7". */
export function describeWarmup(
  w: Pick<WarmupSetRow, "load" | "unit" | "reps" | "rpe">,
  unit: WarmupUnit,
): string {
  const { load, reps, rpe } = warmupInUnit(w, unit);
  const n = Math.round(load * 10) / 10;
  return `${n} ${unit} × ${reps}${rpe != null ? ` · RPE ${rpe}` : ""}`;
}

/**
 * Compound lifts where the last warm-up reads the day well enough to tune the
 * working weight: squats, lunges, hinges, hip thrusts, presses, dips, rows and
 * pulldowns. Isolation work (curls, raises, extensions, leg curls, calves,
 * core) skips the prompt — a feeler set there is clutter, not information —
 * though any loaded exercise can still log warm-ups from its ⋯ menu.
 */
const RAMP_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  "squat",
  "lunge",
  "hinge",
  "hip_thrust",
  "horizontal_press",
  "incline_press",
  "vertical_press",
  "dip",
  "horizontal_pull",
  "vertical_pull",
]);

/** Whether a lift's card offers the "last warm-up" gauge. */
export function offersLastWarmup(family: string, exerciseName: string | null | undefined): boolean {
  // Squat / bench / deadlift families always ramp up.
  if (family !== "accessory") return true;
  return !!exerciseName && RAMP_PATTERNS.has(classifyExercise(exerciseName).pattern);
}

/** Lowest RPE a 1RM estimate is shown for — easier sets are rated too loosely to say much. */
export const E1RM_MIN_RPE = 6;

/**
 * Rough 1RM from one set: load ÷ the RPE chart's %1RM for reps @ RPE (the same
 * chart the load suggestions use), rounded to the nearest 5 lb / 2.5 kg. Null
 * when one set can't support it: no RPE, easier than RPE 6, or over 10 reps.
 */
export function estimateOneRepMax(
  set: { load: number; reps: number; rpe: number | null },
  unit: WarmupUnit,
): number | null {
  const { load, reps, rpe } = set;
  if (!(load > 0) || !Number.isInteger(reps) || reps < 1 || reps > 10) return null;
  if (rpe == null || !Number.isFinite(rpe) || rpe < E1RM_MIN_RPE || rpe > 10) return null;
  const pct = percentOf1RM(reps, 10 - rpe);
  if (!pct) return null;
  const step = unit === "kg" ? 2.5 : 5;
  return Math.round(load / pct / step) * step;
}

/** "RPE 8" → "about 2 reps left"; halves read as a range. */
export function repsLeftLabel(rpe: number): string {
  const rir = 10 - rpe;
  if (rir <= 0) return "nothing left";
  if (rir >= 5) return "5+ reps left";
  if (Number.isInteger(rir)) return `about ${rir} rep${rir === 1 ? "" : "s"} left`;
  return `${Math.floor(rir)}–${Math.ceil(rir)} reps left`;
}
