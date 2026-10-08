/**
 * Profile-prefilled form questions. A question opts in with
 * `validation.prefill` ("sex" | "height"); the renderer saves the profile
 * value as the answer when the client opens the form (they can change it),
 * and a changed sex answer is written back to the profile on submit.
 */
import { formatHeight, type HeightUnit } from "@/lib/basic-info";
import { sexLabel } from "@/lib/athlete-sex";

export type PrefillKey = "sex" | "height";

export type PrefillProfile = {
  sex?: string | null;
  height_cm?: number | null;
  preferred_height_unit?: string | null;
};

export function questionPrefill(q: {
  validation?: Record<string, unknown> | null;
}): PrefillKey | null {
  const k = q.validation?.prefill;
  return k === "sex" || k === "height" ? k : null;
}

/** The answer to pre-save for a question, or null to leave it blank. */
export function prefillAnswer(
  q: { validation?: Record<string, unknown> | null; options?: string[] | null },
  profile: PrefillProfile | null | undefined,
): string | null {
  const key = questionPrefill(q);
  if (!key || !profile) return null;
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
