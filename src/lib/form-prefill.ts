/**
 * Profile-prefilled form questions. A question opts in with
 * `validation.prefill` ("sex" | "height" | "nutrition_plan" | "full_name";
 * "age_class" / "weight_class" only read the profile for a hint); the renderer
 * saves the profile value as the answer when the client opens the form (they
 * can change it), and a changed sex answer is written back to the profile on
 * submit. "nutrition_plan" answers "This is my first plan" for a client with
 * no meal plan yet, and leaves it for them to choose otherwise.
 */
import { formatHeight, type HeightUnit } from "@/lib/basic-info";
import { sexLabel } from "@/lib/athlete-sex";
import { MEAL_CHOICE } from "@/lib/nutrition-history";

export type PrefillKey = "sex" | "height" | "nutrition_plan" | "full_name" | "age_class" | "weight_class";

export type PrefillProfile = {
  sex?: string | null;
  height_cm?: number | null;
  preferred_height_unit?: string | null;
  /** Has a meal plan they can see (null = unknown). */
  has_nutrition_plan?: boolean | null;
  full_name?: string | null;
  date_of_birth?: string | null;
};

export function questionPrefill(q: {
  validation?: Record<string, unknown> | null;
}): PrefillKey | null {
  const k = q.validation?.prefill;
  return k === "sex" || k === "height" || k === "nutrition_plan" || k === "full_name" || k === "age_class" || k === "weight_class"
    ? k
    : null;
}

/** The answer to pre-save for a question, or null to leave it blank. */
export function prefillAnswer(
  q: { validation?: Record<string, unknown> | null; options?: string[] | null },
  profile: PrefillProfile | null | undefined,
): string | null {
  const key = questionPrefill(q);
  if (!key || !profile) return null;
  // Age and weight class only use the profile for a hint (classes overlap, and a planned class is theirs to say).
  if (key === "age_class" || key === "weight_class") return null;
  if (key === "full_name") return profile.full_name?.trim() || null;
  if (key === "nutrition_plan") {
    if (profile.has_nutrition_plan !== false) return null;
    return !q.options?.length || q.options.includes(MEAL_CHOICE.first) ? MEAL_CHOICE.first : null;
  }
  if (key === "sex") {
    const label = sexLabel(profile.sex);
    // Choice questions only accept their exact option text.
    if (!label) return null;
    return !q.options?.length || q.options.includes(label) ? label : null;
  }
  if (profile.height_cm == null) return null;
  const unit: HeightUnit = profile.preferred_height_unit === "metric" ? "metric" : "imperial";
  return formatHeight(Number(profile.height_cm), unit);
}
