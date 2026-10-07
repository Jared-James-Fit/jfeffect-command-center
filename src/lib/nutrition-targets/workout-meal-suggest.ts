/**
 * One-tap Pre-/Post-Workout labels for an existing meal plan, using the same
 * reasoning the AI prompt uses. Only meal header lines change ("Meal 3" →
 * "Meal 3 (Pre-Workout)"); foods, amounts and macros are never touched.
 */
import { listMealHeaders, setMealTiming } from "@/lib/nutrition-targets/meal-timing";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";
import type { TrainingBucket } from "@/lib/nutrition-targets/training-pattern";

export type AutoLabelTime = TrainingBucket | "varies";
export type WorkoutMealPick = { pre: number | null; post: number | null };

/** Rest / non-training days never get workout meals. Anything else might be a training day. */
export function isTrainingDayLabel(label: string | null | undefined): boolean {
  return !/non[\s-]*training|\brest\b|\boff\b|recovery/i.test(String(label ?? ""));
}

/** Which meal (0-based, in eating order) is Pre- and Post-Workout for this training time. */
export function suggestWorkoutMeals(text: string | null | undefined, time: AutoLabelTime): WorkoutMealPick {
  const n = listMealHeaders(text).length;
  if (n < 2) return { pre: null, post: null };
  // Macros line up with headers only when both parsers see the same meals.
  const meals = structureMealPlanDay(text).meals;
  const aligned = meals.length === n;
  const protein = (i: number) => (aligned ? meals[i]?.macros?.protein ?? null : null);
  const carbs = (i: number) => (aligned ? meals[i]?.macros?.carbs ?? null : null);
  // A "real" meal can be a Post-Workout meal; a small snack shouldn't be.
  const isRealMeal = (i: number) => {
    const p = protein(i);
    return p == null || p >= 25;
  };
  const pair = (pre: number | null, post: number | null): WorkoutMealPick => {
    const clamp = (x: number | null) => (x == null ? null : Math.max(0, Math.min(n - 1, x)));
    const p = clamp(pre);
    const q = clamp(post);
    if (p != null && q != null && p >= q) return { pre: q > 0 ? q - 1 : null, post: q };
    return { pre: p, post: q };
  };
  const lunch = n <= 4 ? 1 : 2;

  switch (time) {
    case "early": {
      // Small carb snack first? That's the Pre-Workout; breakfast after is Post.
      const p0 = protein(0);
      const c0 = carbs(0);
      const snackFirst = p0 != null && p0 < 20 && (c0 == null || c0 <= 45);
      return snackFirst ? pair(0, 1) : pair(null, 0);
    }
    case "morning":
      return pair(0, 1);
    case "midday":
      // Late-morning meal before, lunch straight after.
      return n <= 3 ? pair(0, 1) : pair(1, 2);
    case "afternoon":
      return pair(lunch, lunch + 1);
    case "evening": {
      // Dinner after training = the last real meal (skip a small evening snack).
      let post = n >= 5 ? n - 2 : n - 1;
      for (let i = n - 1; i >= 1; i--) if (isRealMeal(i)) { post = i; break; }
      return pair(post - 1, post);
    }
    case "night":
      return pair(n - 2, n - 1);
    case "varies": {
      const pre = Math.floor((n - 1) / 2);
      return pair(pre, pre + 1);
    }
  }
}

/** Clear any existing workout tags on the day, then apply the pick. */
export function applyWorkoutMealPick(text: string, pick: WorkoutMealPick): string {
  let out = text;
  listMealHeaders(out).forEach((h, i) => {
    if (h.timing) out = setMealTiming(out, i, null);
  });
  if (pick.pre != null) out = setMealTiming(out, pick.pre, "pre");
  if (pick.post != null) out = setMealTiming(out, pick.post, "post");
  return out;
}

/**
 * Label every training day of a plan. Rest days are left exactly as they are.
 * Returns the new days plus a short summary of what changed.
 */
export function autoLabelPlan<D extends { day_label: string; notes?: string | null }>(
  days: D[],
  time: AutoLabelTime,
): { days: D[]; labelled: Array<{ day: string; pre: number | null; post: number | null }> } {
  const labelled: Array<{ day: string; pre: number | null; post: number | null }> = [];
  const next = days.map((d) => {
    if (!isTrainingDayLabel(d.day_label) || !d.notes) return d;
    const pick = suggestWorkoutMeals(d.notes, time);
    if (pick.pre == null && pick.post == null) return d;
    labelled.push({ day: d.day_label, ...pick });
    return { ...d, notes: applyWorkoutMealPick(d.notes, pick) };
  });
  return { days: next, labelled };
}
