/**
 * A plan brought in (imported, or drafted by Cleo) as the Nutrition Studio's
 * starting draft: `MemberPlanStudio seed` (member-plan-studio.tsx). The days
 * keep the plan's own text as their notes (the one record every reader
 * understands); their numbers are the plan's own Daily Total for an import,
 * or the member's own targets for a draft written to them. When each day is
 * used follows its name, the way the coach's editor reads it. Pure.
 */
import { normalizeDayLabel } from "@/lib/client-nutrition-day";
import { parseFoodWeighingRules } from "@/lib/nutrition-targets/meal-plan-parse";
import { phaseFromPlanText } from "@/lib/nutrition-cardio";
import { mealCount, readPlanText } from "./read";
import type { MemberTargets } from "./create";

/** The same shape as the Studio's StudioPlanDay. */
export type SeedDay = {
  day_label: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  notes: string;
  use_on: string | null;
  weekdays: string[] | null;
};

export type StudioSeed = { days: SeedDay[]; phase: string | null; weighing: string | null };

/** The phases the Studio offers (member-plan-studio.tsx PHASES); any other reads as none. */
const STUDIO_PHASES = new Set(["Fat Loss", "Maintenance", "Muscle Gain", "Recomp", "Performance"]);

const round = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n));

/** When a day is used, from its name: a training day, a rest day, a high day; else left to its name. */
export function useOnFor(label: string): string | null {
  switch (normalizeDayLabel(label)) {
    case "training":
      return "training";
    case "non_training":
      return "rest";
    case "high":
      return "high";
    default:
      return null;
  }
}

/**
 * The Studio's draft from a plan's text, or null when it has no days with meals.
 * One day is "Every day"; several keep their names. With `targets` (a Cleo draft),
 * every day carries the member's own targets; else the plan's own numbers.
 */
export function seedFromPlan(text: string, opts: { targets?: MemberTargets | null } = {}): StudioSeed | null {
  const read = readPlanText(text);
  if (!read) return null;
  const one = read.days.length === 1;
  const t = opts.targets;
  const days: SeedDay[] = read.days.map((d) => ({
    day_label: one ? "Every day" : d.day_label,
    calories: t ? round(t.calories) : round(d.calories),
    protein: t ? round(t.protein_g) : round(d.protein),
    carbs: t ? round(t.carbs_g) : round(d.carbs),
    fats: t ? round(t.fat_g) : round(d.fats),
    notes: (d.notes ?? "").trim(),
    use_on: one ? "every_day" : useOnFor(d.day_label),
    weekdays: null,
  }));
  const phase = phaseFromPlanText(read.text);
  return { days, phase: phase && STUDIO_PHASES.has(phase) ? phase : null, weighing: parseFoodWeighingRules(read.text) };
}

/** One line per day for the preview: its name, its numbers and how many meals. */
export type DaySummary = { label: string; calories: number | null; protein: number | null; carbs: number | null; fats: number | null; meals: number };

export function seedSummary(seed: StudioSeed): DaySummary[] {
  return seed.days.map((d) => ({
    label: d.day_label,
    calories: d.calories,
    protein: d.protein,
    carbs: d.carbs,
    fats: d.fats,
    meals: mealCount(d.notes),
  }));
}
