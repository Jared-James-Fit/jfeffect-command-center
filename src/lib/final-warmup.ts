/**
 * Logged warm-up sets (optional, any external-load exercise).
 *
 * They live in their own table (pl_warmup_sets), never in pl_row_results: that
 * table feeds records, tonnage, league points, completion and coach review, none
 * of which should ever see a warm-up. The load-suggestion engine reads the
 * heaviest warm-up of the day (the "final" one) with any others close to its
 * weight, whatever order they were logged in (readWarmups, load-suggestion.ts,
 * note 8).
 */
import { classifyExercise, type MovementPattern } from "@/lib/exercise-classifier";
import { percentOf1RM } from "@/lib/load-suggestion";
import { rangeLift } from "@/lib/workouts/pick-range";

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

/**
 * The most reps a warm-up can be logged with (pl_warmup_sets_reps_check): an
 * accessory's warm-up is often 10–15 easy reps. The suggestion engine reads only
 * warm-ups of WARMUP_MAX_REPS (8) or fewer; longer ones are logged, never read.
 */
export const WARMUP_LOG_MAX_REPS = 30;

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

/**
 * Which warm-up is the "final" one: the heaviest, compared across units; a tie
 * goes to the harder-rated (a missing rating counts as 7), then the one with
 * more reps, then the id. Never the order they were logged in, so the same
 * warm-ups typed in any order are read the same (readWarmups does the same).
 */
function isMoreFinal(a: WarmupSetRow, b: WarmupSetRow): boolean {
  const kg = (w: WarmupSetRow) => (w.unit === "kg" ? w.load : w.load * KG_PER_LB);
  const d = kg(a) - kg(b);
  if (Math.abs(d) > 1e-6) return d > 0;
  const ra = a.rpe ?? 7;
  const rb = b.rpe ?? 7;
  if (ra !== rb) return ra > rb;
  if (a.reps !== b.reps) return a.reps > b.reps;
  return String(a.id) > String(b.id);
}

/** The final warm-up's row (isMoreFinal), or null. */
export function finalWarmupRow(sets: WarmupSetRow[]): WarmupSetRow | null {
  let best: WarmupSetRow | null = null;
  for (const s of sets) if (!best || isMoreFinal(s, best)) best = s;
  return best;
}

/** The final warm-up in the display unit (isMoreFinal), or null. */
export function pickFinalWarmup(
  sets: WarmupSetRow[],
  unit: WarmupUnit,
): { load: number; reps: number; rpe: number | null } | null {
  const best = finalWarmupRow(sets);
  return best ? warmupInUnit(best, unit) : null;
}

/**
 * Every warm-up in the display unit for the suggestion engine (readWarmups),
 * in one fixed order (heaviest first) so the screen's memo sees the same list
 * however they were logged.
 */
export function warmupsForModel(sets: WarmupSetRow[], unit: WarmupUnit): Array<{ load: number; reps: number; rpe: number | null }> {
  return [...sets]
    .sort((a, b) => (isMoreFinal(a, b) ? -1 : isMoreFinal(b, a) ? 1 : 0))
    .map((s) => warmupInUnit(s, unit));
}

/**
 * Said when the last warm-up was too easy to read (RPE 5 or easier, header
 * note 8 in load-suggestion.ts): the number stays history's, or, with no
 * history, waits for the first set. Never a made-up weight.
 */
export const WARMUP_TOO_EASY = "RPE too low for a reliable estimate";

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

/** The heavy compound patterns a lifter ramps up to on a bar. */
const HEAVY_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  "squat",
  "hinge",
  "hip_thrust",
  "horizontal_press",
  "incline_press",
  "vertical_press",
]);
/** A barbell (or bar-like) implement: plates go on, a last warm-up is a real read. */
const BAR = /\b(barbell|bb|trap bar|hex bar|safety (squat )?bar|ssb|cambered|axle|smith)\b/i;
const NOT_BAR = /\b(dumbbells?|db|cables?|bands?|kettlebells?|kb|landmine|goblet|machine)\b/i;
/**
 * How a card offers warm-ups (WarmupRows): "last" for a heavy barbell compound
 * (the squat, bench and deadlift and their barbell variations, and any barbell /
 * trap-bar / Smith squat, hinge, hip thrust or press), where the last warm-up
 * reads the day well enough to set the working weight, so it's an open row before
 * set 1; "secondary" for everything else (bodybuilding accessories, dumbbell and
 * machine work): + Warm-up under the sets, folded away once logged.
 */
export function warmupStyleOf(family: string, exerciseName: string | null | undefined, equipment?: string | null): "last" | "secondary" {
  const text = `${exerciseName ?? ""} ${equipment ?? ""}`;
  if (family === "squat" || family === "bench" || family === "deadlift") return rangeLift(family, exerciseName, equipment) ? "last" : "secondary";
  if (!exerciseName || NOT_BAR.test(text) || !BAR.test(text)) return "secondary";
  return HEAVY_PATTERNS.has(classifyExercise(exerciseName).pattern) ? "last" : "secondary";
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
