/**
 * Editing a past day's sets from the exercise History sheet (in the workout,
 * without leaving it): weight, its unit, reps and RPE. Pure, so it's tested.
 *
 * The unit is a label on the number, never a conversion: a day logged as
 * "205 kg" that was really 205 lb is fixed by flipping the unit (Nicolas,
 * Oct 2026), and the database works out the kg / lb mirrors from the pair.
 */
import { WEIGHT_CAP, type WUnit } from "@/lib/workout-weight-input";
import { MAX_SET_CALORIES } from "@/lib/timed-cardio";
import { cardioClock, parseCardioTime, MAX_CARDIO_SECONDS } from "@/lib/cardio-history";

export type HistorySetRow = {
  id: string;
  entered_value?: number | string | null;
  entered_unit?: string | null;
  actual_load?: number | string | null;
  actual_load_unit?: string | null;
  actual_reps?: number | null;
  actual_rpe?: string | number | null;
  load_type?: string | null;
  is_bodyweight?: boolean | null;
};

export type SetDraft = {
  load: string;
  unit: WUnit;
  reps: string;
  rpe: string;
  /** Bodyweight / assisted sets keep their load as it is (only reps / RPE change). */
  loadEditable: boolean;
};

export const MAX_HISTORY_REPS = 100;

const asUnit = (u: unknown): WUnit | null => (u === "kg" || u === "lb" ? u : null);

/** Trim a stored number for a text box: 205.0000 → "205", 92.50 → "92.5". */
export function numberText(v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 10000) / 10000);
}

export function setEditDraft(set: HistorySetRow, fallbackUnit: WUnit): SetDraft {
  const unit = asUnit(set.entered_unit) ?? asUnit(set.actual_load_unit) ?? fallbackUnit;
  const loadEditable = !set.is_bodyweight && (set.load_type ?? "external") === "external";
  return {
    load: numberText(set.entered_value ?? set.actual_load),
    unit,
    reps: set.actual_reps != null ? String(set.actual_reps) : "",
    rpe: numberText(set.actual_rpe),
    loadEditable,
  };
}

/** What's wrong with a draft, in words, or null when it can be saved. */
export function setDraftIssue(d: SetDraft): string | null {
  if (d.loadEditable && d.load.trim() !== "") {
    if (!/^\d*\.?\d+$/.test(d.load.trim())) return "Weight must be a number";
    const n = Number(d.load);
    if (n > WEIGHT_CAP[d.unit]) {
      return d.unit === "kg" && n <= WEIGHT_CAP.lb
        ? `${n} kg is over ${WEIGHT_CAP.kg} kg. Tap kg to make it lb.`
        : `Weight is over ${WEIGHT_CAP[d.unit]} ${d.unit}`;
    }
  }
  if (d.reps.trim() !== "") {
    if (!/^\d+$/.test(d.reps.trim())) return "Reps must be a whole number";
    if (Number(d.reps) > MAX_HISTORY_REPS) return `Reps can't be over ${MAX_HISTORY_REPS}`;
  }
  if (d.rpe.trim() !== "") {
    const r = Number(d.rpe);
    if (!/^\d*\.?\d+$/.test(d.rpe.trim()) || r < 1 || r > 10 || (r * 2) % 1 !== 0) return "RPE is 1 to 10, in half steps";
  }
  return null;
}

export type SetPatch = {
  entered_value?: number | null;
  entered_unit?: WUnit;
  actual_load?: number | null;
  actual_load_unit?: WUnit;
  actual_reps?: number | null;
  actual_rpe?: string | null;
};

/** Only what changed, or null when nothing did. */
export function setEditPatch(set: HistorySetRow, d: SetDraft, fallbackUnit: WUnit): SetPatch | null {
  const before = setEditDraft(set, fallbackUnit);
  const patch: SetPatch = {};
  if (d.loadEditable) {
    const next = d.load.trim() === "" ? null : Number(d.load);
    const prev = before.load === "" ? null : Number(before.load);
    if (next !== prev || d.unit !== before.unit) {
      patch.entered_value = next;
      patch.actual_load = next;
      patch.entered_unit = d.unit;
      patch.actual_load_unit = d.unit;
    }
  }
  const reps = d.reps.trim() === "" ? null : Number(d.reps);
  if (reps !== (before.reps === "" ? null : Number(before.reps))) patch.actual_reps = reps;
  const rpe = d.rpe.trim() === "" ? null : numberText(d.rpe);
  if (rpe !== (before.rpe === "" ? null : before.rpe)) patch.actual_rpe = rpe;
  return Object.keys(patch).length ? patch : null;
}

/**
 * Everything a past set feeds, refreshed after an edit: the History sheet, the
 * rep records, "Last time" and the load suggestions (workout-previous-lifts),
 * the open workout's own sets, and the unit habits.
 */
export const HISTORY_EDIT_QUERY_KEYS: ReadonlyArray<readonly string[]> = [
  ["exercise-history"],
  ["exercise-records"],
  ["workout-previous-lifts"],
  ["pl-day-results"],
  ["workout-records-review"],
  ["client-exercise-unit-history"],
  ["client-lift-family-unit-history"],
  // a cardio set's time / calories / RPE feed the plan's cardio log and the analytics
  ["cardio-analytics"],
  ["cardio-completion"],
  ["client-cardio-resolved"],
];

/* ── cardio (a treadmill walk, a bike): time, calories, RPE ─────────────── */

export type CardioHistoryRow = {
  id: string;
  completed_duration_seconds?: number | null;
  actual_calories?: number | null;
  actual_rpe?: string | number | null;
};

export type CardioDraft = { time: string; calories: string; rpe: string };

export function cardioEditDraft(set: CardioHistoryRow): CardioDraft {
  const secs = Number(set.completed_duration_seconds);
  return {
    time: Number.isFinite(secs) && secs > 0 ? cardioClock(secs) : "",
    calories: set.actual_calories != null ? String(Math.round(Number(set.actual_calories))) : "",
    rpe: numberText(set.actual_rpe),
  };
}

/** What's wrong with a cardio draft, in words, or null when it can be saved. */
export function cardioDraftIssue(d: CardioDraft): string | null {
  if (d.time.trim() !== "") {
    const t = parseCardioTime(d.time);
    if (t == null) return "Time is minutes, or mm:ss (like 18:30)";
    if (t > MAX_CARDIO_SECONDS) return "Time can't be over 6 hours";
  }
  if (d.calories.trim() !== "") {
    if (!/^\d+$/.test(d.calories.trim())) return "Calories must be a whole number";
    if (Number(d.calories) > MAX_SET_CALORIES) return `Calories can't be over ${MAX_SET_CALORIES}`;
  }
  if (d.rpe.trim() !== "") {
    const r = Number(d.rpe);
    if (!/^\d*\.?\d+$/.test(d.rpe.trim()) || r < 1 || r > 10 || (r * 2) % 1 !== 0) return "RPE is 1 to 10, in half steps";
  }
  return null;
}

export type CardioPatch = {
  completed_duration_seconds?: number | null;
  actual_calories?: number | null;
  actual_rpe?: string | null;
};

/** Only what changed, or null when nothing did. The plan's cardio log follows by itself (its trigger). */
export function cardioEditPatch(set: CardioHistoryRow, d: CardioDraft): CardioPatch | null {
  const before = cardioEditDraft(set);
  const patch: CardioPatch = {};
  const t = d.time.trim() === "" ? null : parseCardioTime(d.time);
  const tPrev = before.time === "" ? null : parseCardioTime(before.time);
  if (t !== tPrev) patch.completed_duration_seconds = t;
  const cal = d.calories.trim() === "" ? null : Number(d.calories);
  if (cal !== (before.calories === "" ? null : Number(before.calories))) patch.actual_calories = cal;
  const rpe = d.rpe.trim() === "" ? null : numberText(d.rpe);
  if (rpe !== (before.rpe === "" ? null : before.rpe)) patch.actual_rpe = rpe;
  return Object.keys(patch).length ? patch : null;
}
