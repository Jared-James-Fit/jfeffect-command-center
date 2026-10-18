import type { ActivityLevel } from "./formula";

// What someone types into the targets calculator, checked in plain words
// before it reaches the formula. Pure, tested.

export type Units = "metric" | "imperial";

export interface BodyFields {
  units: Units;
  age: string;
  weight: string;
  heightCm: string;
  heightFt: string;
  heightIn: string;
}

const LB_TO_KG = 0.45359237;

/** One message per field that's typed but can't be right (empty is not an error). */
export function bodyInputIssues(f: BodyFields): { age: string | null; weight: string | null; height: string | null } {
  const age = f.age ? Number(f.age) : null;
  const w = f.weight ? Number(f.weight) : null;
  let height: string | null = null;
  if (f.units === "metric") {
    const cm = f.heightCm ? Number(f.heightCm) : null;
    if (cm != null && (cm < 120 || cm > 230)) height = "Enter your height in cm, like 175.";
  } else {
    const ft = f.heightFt ? Number(f.heightFt) : null;
    const inch = f.heightIn ? Number(f.heightIn) : null;
    if (ft != null && (ft < 4 || ft > 7)) height = "Feet should be 4 to 7.";
    else if (inch != null && inch > 11) height = "Inches should be 0 to 11.";
  }
  return {
    age: age != null && (age < 13 || age > 100) ? "Age should be 13 to 100." : null,
    weight:
      w != null && (!Number.isFinite(w) || (f.units === "metric" ? w < 30 || w > 300 : w < 66 || w > 660))
        ? f.units === "metric"
          ? "Enter your weight in kg, like 80."
          : "Enter your weight in lb, like 180."
        : null,
    height,
  };
}

/** kg / cm / whole years, or null until every field is filled in and sensible. */
export function toMetricBody(f: BodyFields): { kg: number; cm: number; age: number } | null {
  const issues = bodyInputIssues(f);
  if (issues.age || issues.weight || issues.height) return null;
  const age = Number(f.age);
  const w = Number(f.weight);
  if (!age || !w) return null;
  const cm =
    f.units === "metric"
      ? Number(f.heightCm)
      : f.heightFt
        ? (Number(f.heightFt) * 12 + Number(f.heightIn || 0)) * 2.54
        : 0;
  if (!cm) return null;
  return { kg: f.units === "metric" ? w : w * LB_TO_KG, cm, age: Math.round(age) };
}

/** A starting guess from the sessions a week they committed to. */
export function activityFromTrainingDays(days: number | null | undefined): ActivityLevel | null {
  if (!days || days < 1) return null;
  if (days <= 2) return "light";
  if (days <= 5) return "moderate";
  return "very";
}
