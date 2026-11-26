/**
 * A specialist's Footage tab: an athlete's set videos with what was lifted
 * on each (exercise, day, weight, reps, logged and prescribed effort, measured
 * bar speed). Pure; the server joins the rows (specialist.functions.ts) and
 * this says them, so the list and its tests agree.
 *
 * The competition lifts lead: a game day coach studies the squat, bench and
 * deadlift first. Measured bar speed is only ever the set's own accepted read,
 * never an estimate.
 */
import { compLiftOfResult, type CompLift } from "@/lib/analytics/competition-strength";
import { rangeLift } from "@/lib/workouts/pick-range";
import { setTitle } from "@/lib/set-videos/label";

const LB_PER_KG = 2.2046226218;

export type FootageSource = {
  id: string;
  created_at: string;
  set_index: number | null;
  warmup: boolean;
  /** The set's name in its workout ("Top set", "Backoff 2"), when known. */
  set_name?: string | null;
  exercise_name: string | null;
  workout_title: string | null;
  duration_s: number | null;
  /** The workout's own day (yyyy-mm-dd), when it has one. */
  day_date: string | null;
  result: {
    completed_at: string | null;
    entered_value: number | null;
    entered_unit: string | null;
    normalized_kg: number | null;
    actual_reps: number | null;
    actual_rpe: string | number | null;
    actual_rir: string | number | null;
    mean_concentric_velocity_mps: number | null;
    velocity_excluded: boolean | null;
    velocity_quality: string | null;
    load_type: string | null;
    is_bodyweight: boolean | null;
  } | null;
  row: {
    rpe: string | null;
    rir: string | null;
    reps_text: string | null;
    sets: number | null;
    purpose_label: string | null;
    exercise_name_override: string | null;
  } | null;
  exercise: {
    name: string | null;
    is_competition_lift: boolean | null;
    competition_lift_type: string | null;
    movement_family: string | null;
    equipment: string | null;
  } | null;
};

export type FootageItem = {
  id: string;
  /** yyyy-mm-dd: the day it was trained */
  day: string;
  exercise: string;
  lift: CompLift | null;
  /** a barbell variation of a competition lift (pause squat, close-grip bench…) */
  variation: boolean;
  setName: string;
  /** what was on the bar, as typed, with the other unit worked out */
  weight: { value: number; unit: "kg" | "lb"; kg: number; lb: number } | null;
  bodyweight: boolean;
  reps: number | null;
  loggedEffort: string | null;
  prescribedEffort: string | null;
  prescribedReps: string | null;
  /** measured, never estimated */
  velocity: { mps: number; quality: string | null } | null;
  durationS: number | null;
  createdAt: string;
};

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function dayOf(src: FootageSource): string {
  if (src.day_date && /^\d{4}-\d{2}-\d{2}$/.test(src.day_date)) return src.day_date;
  const iso = src.result?.completed_at ?? src.created_at;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function effortWords(rpe: unknown, rir: unknown): string | null {
  const r = rpe == null || rpe === "" ? null : String(rpe).trim();
  if (r) return `RPE ${r}`;
  const i = rir == null || rir === "" ? null : String(rir).trim();
  if (i) return `RIR ${i}`;
  return null;
}

export function footageItem(src: FootageSource): FootageItem {
  const ex = src.exercise;
  const exercise =
    (src.row?.exercise_name_override || ex?.name || src.exercise_name || "Exercise").trim() ||
    "Exercise";
  const lift = ex
    ? compLiftOfResult({
        is_competition_lift: ex.is_competition_lift === true,
        competition_lift_type: ex.competition_lift_type,
      })
    : null;
  const variation =
    !lift && rangeLift(ex?.movement_family ?? null, exercise, ex?.equipment ?? null);
  const r = src.result;
  const bodyweight =
    r?.load_type === "bodyweight" || (r?.load_type == null && r?.is_bodyweight === true);
  let weight: FootageItem["weight"] = null;
  const typed = r?.entered_value != null ? Number(r.entered_value) : null;
  const unit = String(r?.entered_unit ?? "").toLowerCase() === "kg" ? "kg" : "lb";
  if (r && r.load_type !== "assisted" && typed != null && Number.isFinite(typed) && typed > 0) {
    const kg =
      r.normalized_kg != null && Number(r.normalized_kg) > 0
        ? Number(r.normalized_kg)
        : unit === "kg"
          ? typed
          : typed / LB_PER_KG;
    weight = { value: round(typed, 2), unit, kg: round(kg, 1), lb: round(kg * LB_PER_KG, 1) };
  }
  const v = r?.mean_concentric_velocity_mps;
  const velocity =
    r && !r.velocity_excluded && v != null && Number(v) > 0
      ? { mps: round(Number(v), 2), quality: r.velocity_quality ?? null }
      : null;
  const reps =
    r?.actual_reps != null && Number(r.actual_reps) > 0 ? Math.round(Number(r.actual_reps)) : null;
  return {
    id: src.id,
    day: dayOf(src),
    exercise,
    lift,
    variation,
    setName: src.warmup
      ? "Warm-up"
      : src.set_name?.trim() || (src.set_index != null ? setTitle(src.set_index) : "Set"),
    weight,
    bodyweight,
    reps,
    loggedEffort: r ? effortWords(r.actual_rpe, r.actual_rir) : null,
    prescribedEffort: src.warmup ? null : effortWords(src.row?.rpe, src.row?.rir),
    prescribedReps: src.warmup ? null : src.row?.reps_text?.trim() || null,
    velocity,
    durationS: src.duration_s != null && src.duration_s > 0 ? Math.round(src.duration_s) : null,
    createdAt: src.created_at,
  };
}

export type FootageFilter =
  | "competition"
  | "squat"
  | "bench"
  | "deadlift"
  | "variations"
  | "all"
  | "unwatched";

export const FILTER_LABELS: Record<FootageFilter, string> = {
  competition: "Competition lifts",
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
  variations: "Variations",
  all: "All",
  unwatched: "Unwatched",
};

export function matchesFilter(
  item: FootageItem,
  filter: FootageFilter,
  watched: ReadonlySet<string>,
): boolean {
  switch (filter) {
    case "competition":
      return item.lift != null;
    case "squat":
    case "bench":
    case "deadlift":
      return item.lift === filter;
    case "variations":
      return item.variation;
    case "unwatched":
      return !watched.has(item.id);
    default:
      return true;
  }
}

/** The filters worth offering for this footage (never a chip that shows nothing). */
export function availableFilters(
  items: FootageItem[],
  watched: ReadonlySet<string>,
): FootageFilter[] {
  const all: FootageFilter[] = [
    "competition",
    "squat",
    "bench",
    "deadlift",
    "variations",
    "unwatched",
    "all",
  ];
  return all.filter((f) => f === "all" || items.some((i) => matchesFilter(i, f, watched)));
}

/** Competition lifts first when there are any, else everything. */
export function defaultFilter(items: FootageItem[]): FootageFilter {
  return items.some((i) => i.lift != null) ? "competition" : "all";
}

/** Newest first; on the same day the competition lifts lead, then the order they were filmed. */
export function sortFootage(items: FootageItem[]): FootageItem[] {
  return items.slice().sort((a, b) => {
    if (a.day !== b.day) return b.day.localeCompare(a.day);
    const la = a.lift ? 0 : a.variation ? 1 : 2;
    const lb = b.lift ? 0 : b.variation ? 1 : 2;
    if (la !== lb) return la - lb;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** Earlier clips worth putting beside this one: the same exercise first, then the same competition lift. */
export function compareCandidates(
  items: FootageItem[],
  item: FootageItem,
  max = 12,
): FootageItem[] {
  const same = (x: FootageItem) => x.exercise.toLowerCase() === item.exercise.toLowerCase();
  return items
    .filter((x) => x.id !== item.id && (same(x) || (item.lift != null && x.lift === item.lift)))
    .sort((a, b) => Number(same(b)) - Number(same(a)) || b.day.localeCompare(a.day))
    .slice(0, max);
}

/** "140 kg × 3 @ RPE 8" with the other unit after it: what goes under a clip. */
export function footageLine(item: FootageItem, unit: "kg" | "lb"): string {
  const parts: string[] = [];
  const w = item.weight;
  const load = w ? `${unit === "kg" ? w.kg : w.lb} ${unit}` : item.bodyweight ? "BW" : null;
  if (load && item.reps) parts.push(`${load} × ${item.reps}`);
  else if (load) parts.push(load);
  else if (item.reps) parts.push(`${item.reps} ${item.reps === 1 ? "rep" : "reps"}`);
  if (item.loggedEffort) parts.push(item.loggedEffort);
  return parts.join(" @ ");
}
