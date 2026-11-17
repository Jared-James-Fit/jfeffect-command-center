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

export type PrefillKey =
  | "sex"
  | "height"
  | "nutrition_plan"
  | "full_name"
  | "age_class"
  | "weight_class"
  // The meet a checklist is for (meet-checklist.ts pickMeet) and the latest weigh-in.
  | "meet_name"
  | "meet_date"
  | "meet_weight_class"
  | "bodyweight";

const KEYS: PrefillKey[] = ["sex", "height", "nutrition_plan", "full_name", "age_class", "weight_class", "meet_name", "meet_date", "meet_weight_class", "bodyweight"];

export type PrefillProfile = {
  sex?: string | null;
  height_cm?: number | null;
  preferred_height_unit?: string | null;
  /** Has a meal plan they can see (null = unknown). */
  has_nutrition_plan?: boolean | null;
  full_name?: string | null;
  date_of_birth?: string | null;
  /** The meet the checklist is for: the one the coach sent it with, else their next meet. */
  meet?: { name: string | null; date: string | null; weightClass: string | null; source: string } | null;
  /** The latest weigh-in in their unit; only filled in by itself when it's from today or yesterday. */
  bodyweight?: { value: number; unit: "kg" | "lb"; date: string; fresh: boolean } | null;
};

/** A number answered in a unit (bodyweight): what the form keeps on screen. */
export type UnitValue = { value: string; unit: "kg" | "lb" };

export function questionPrefill(q: {
  validation?: Record<string, unknown> | null;
}): PrefillKey | null {
  const k = q.validation?.prefill;
  return typeof k === "string" && (KEYS as string[]).includes(k) ? (k as PrefillKey) : null;
}

/** The answer to pre-save for a question, or null to leave it blank. */
export function prefillAnswer(
  q: { validation?: Record<string, unknown> | null; options?: string[] | null },
  profile: PrefillProfile | null | undefined,
): string | UnitValue | null {
  const key = questionPrefill(q);
  if (!key || !profile) return null;
  if (key === "meet_name") return profile.meet?.name?.trim() || null;
  if (key === "meet_date") return profile.meet?.date || null;
  if (key === "meet_weight_class") {
    const cls = profile.meet?.weightClass?.trim();
    if (!cls) return null;
    // Choice questions only accept their exact option text ("83 kg" finds "Men's 83 kg" for a man).
    const opts = q.options ?? [];
    if (!opts.length || opts.includes(cls)) return cls;
    const n = cls.match(/\d+(?:\.\d+)?\s*\+?/)?.[0]?.replace(/\s+/g, "");
    if (!n) return null;
    const sex = String(profile.sex ?? "").toLowerCase();
    const want = sex.startsWith("m") ? /^men/i : sex.startsWith("f") || sex.startsWith("w") ? /^wom/i : null;
    const hits = opts.filter((o) => o.replace(/\s+/g, "").includes(`${n.replace("+", "")}kg${n.endsWith("+") ? "+" : ""}`) && (!n.endsWith("+") ? !/\+/.test(o) : true));
    const pick = want ? hits.find((o) => want.test(o)) : hits.length === 1 ? hits[0] : null;
    return pick ?? null;
  }
  if (key === "bodyweight") {
    const bw = profile.bodyweight;
    return bw && bw.fresh ? { value: String(bw.value), unit: bw.unit } : null;
  }
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
