/**
 * Member nutrition target calculator.
 *
 * BMR  → Mifflin–St Jeor (kg, cm, years)
 *        male:   10*kg + 6.25*cm − 5*age + 5
 *        female: 10*kg + 6.25*cm − 5*age − 161
 * TDEE → BMR × PAL (activity multiplier)
 * Goal → TDEE × (1 − deficit) | TDEE | TDEE × (1 + surplus)
 * Protein/Fat → grams per kg of bodyweight (configurable)
 * Carbs → remaining kcal ÷ 4
 * Water → ml per kg of bodyweight
 */

export type ActivityLevel = "sedentary" | "light" | "moderate" | "very" | "extra";
export type BiologicalSex = "male" | "female";
export type NutritionGoal = "lose" | "maintain" | "gain";
export type GoalIntensity = "conservative" | "standard" | "aggressive";

export type FormulaSettings = {
  deficit_percent: number;
  surplus_percent: number;
  protein_g_per_kg: number;
  fat_g_per_kg: number;
  pal_sedentary: number;
  pal_light: number;
  pal_moderate: number;
  pal_very: number;
  pal_extra: number;
  water_ml_per_kg: number;
};

export const DEFAULT_FORMULA_SETTINGS: FormulaSettings = {
  deficit_percent: 0.20,
  surplus_percent: 0.10,
  protein_g_per_kg: 2.0,
  fat_g_per_kg: 0.9,
  pal_sedentary: 1.2,
  pal_light: 1.375,
  pal_moderate: 1.55,
  pal_very: 1.725,
  pal_extra: 1.9,
  water_ml_per_kg: 35,
};

export const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; hint: string }[] = [
  { value: "sedentary", label: "Sedentary", hint: "Desk job, little/no exercise" },
  { value: "light", label: "Lightly Active", hint: "Light exercise 1–3 days/week" },
  { value: "moderate", label: "Moderately Active", hint: "Moderate exercise 3–5 days/week" },
  { value: "very", label: "Very Active", hint: "Hard exercise 6–7 days/week" },
  { value: "extra", label: "Extra Active", hint: "Physical job + daily training" },
];

export const GOAL_OPTIONS: { value: NutritionGoal; label: string; hint: string }[] = [
  { value: "lose", label: "Lose Fat", hint: "Slow, steady deficit" },
  { value: "maintain", label: "Maintain", hint: "Body recomp / hold weight" },
  { value: "gain", label: "Build Muscle", hint: "Lean surplus" },
];

/**
 * Intensity presets scale the formula's default deficit/surplus.
 * Conservative = gentler change; Aggressive = larger swing.
 * `maintain` ignores intensity (no deficit/surplus to scale).
 */
export const INTENSITY_OPTIONS: { value: GoalIntensity; label: string; multiplier: number; hint: string }[] = [
  { value: "conservative", label: "Conservative", multiplier: 0.5, hint: "Slow & sustainable" },
  { value: "standard",     label: "Standard",     multiplier: 1.0, hint: "Recommended default" },
  { value: "aggressive",   label: "Aggressive",   multiplier: 1.5, hint: "Faster — harder to sustain" },
];

export function applyIntensity(
  settings: FormulaSettings,
  goal: NutritionGoal,
  intensity: GoalIntensity = "standard",
): FormulaSettings {
  if (goal === "maintain" || intensity === "standard") return settings;
  const mult = INTENSITY_OPTIONS.find((o) => o.value === intensity)?.multiplier ?? 1;
  return {
    ...settings,
    deficit_percent: Math.min(0.4, settings.deficit_percent * mult),
    surplus_percent: Math.min(0.3, settings.surplus_percent * mult),
  };
}

export type FormulaInput = {
  bodyweightKg: number;
  heightCm: number;
  ageYears: number;
  sex: BiologicalSex;
  activity: ActivityLevel;
  goal: NutritionGoal;
  intensity?: GoalIntensity;
};

export type CalculatedTargets = {
  bmr: number;
  tdee: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  water_ml: number;
};

function palFor(activity: ActivityLevel, s: FormulaSettings): number {
  switch (activity) {
    case "sedentary": return s.pal_sedentary;
    case "light":     return s.pal_light;
    case "moderate":  return s.pal_moderate;
    case "very":      return s.pal_very;
    case "extra":     return s.pal_extra;
  }
}

export function calculateTargets(
  input: FormulaInput,
  settings: FormulaSettings = DEFAULT_FORMULA_SETTINGS,
): CalculatedTargets {
  const { bodyweightKg: kg, heightCm: cm, ageYears: age, sex, activity, goal } = input;
  const bmrBase = 10 * kg + 6.25 * cm - 5 * age;
  const bmr = sex === "male" ? bmrBase + 5 : bmrBase - 161;
  const tdee = bmr * palFor(activity, settings);

  let calories: number;
  if (goal === "lose")      calories = tdee * (1 - settings.deficit_percent);
  else if (goal === "gain") calories = tdee * (1 + settings.surplus_percent);
  else                       calories = tdee;

  const protein_g = Math.round(kg * settings.protein_g_per_kg);
  const fat_g     = Math.round(kg * settings.fat_g_per_kg);
  const remainingKcal = Math.max(0, calories - protein_g * 4 - fat_g * 9);
  const carbs_g = Math.round(remainingKcal / 4);
  const water_ml = Math.round(kg * settings.water_ml_per_kg);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories: Math.round(calories / 10) * 10,
    protein_g,
    fat_g,
    carbs_g,
    water_ml,
  };
}

export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}