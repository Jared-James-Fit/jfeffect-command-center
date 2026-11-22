/**
 * Create with Cleo: a member's meal-plan draft from a few tapped answers and
 * their own saved targets. Everything here is decided in code before a model
 * is asked anything: what the questions offer, the answers cleaned, who gets
 * no draft at all (the safety screen), what their plan must never hold, and
 * the targets the draft is written to (the member's own, never the model's).
 * The prompt itself is server only (create-prompt.server.ts). Pure.
 */
import { screenSafety } from "@/lib/nutrition-roadmap/safety";
import { allergensIn, DIET_RULES } from "@/lib/nutrition-targets/food-history";
import { dietTags } from "@/lib/nutrition-targets/food-notes";
import type { QA } from "@/lib/nutrition-request";

export const MEAL_COUNTS = [3, 4, 5, 6] as const;

export const TRAINING_TIMES = [
  "Early morning (before 8 AM)",
  "Morning (8–11 AM)",
  "Midday (11 AM–2 PM)",
  "Afternoon (2–5 PM)",
  "Evening (5–8 PM)",
  "Night (after 8 PM)",
  "It varies",
] as const;

export const LIKE_CHIPS = [
  "Chicken",
  "Lean beef",
  "Turkey",
  "Fish",
  "Eggs",
  "Greek yogurt",
  "Protein shakes",
  "Rice",
  "Potatoes",
  "Sweet potatoes",
  "Oats",
  "Pasta",
  "Bread or bagels",
  "Fruit",
  "Vegetables",
] as const;

/** What they won't eat or can't: each one a category the plan checks (food-history.ts). */
export const AVOID_CHIPS = ["Dairy", "Gluten", "Eggs", "Fish", "Shellfish", "Peanuts", "Tree nuts", "Soy", "Pork", "Red meat"] as const;

/** Diets, named as food-history's DIET_RULES names them. */
export const DIET_CHOICES = ["No restrictions", "Vegetarian", "Vegan", "Pescatarian", "Gluten-free", "Dairy-free", "Halal", "Kosher"] as const;

export const COOKING_CHOICES = [
  { key: "simple", label: "Simple", text: "A few plain foods, cooked fresh" },
  { key: "meal_prep", label: "Meal prep", text: "Cook once, eat the same containers" },
] as const;

export const BUDGET_CHOICES = [
  { key: "tight", label: "Tight", text: "The cheapest staples" },
  { key: "moderate", label: "Moderate", text: "Everyday groceries" },
  { key: "flexible", label: "Flexible", text: "Whatever fits best" },
] as const;

/** The health screen's choices: any but "none" means Cleo writes no draft. */
export const HEALTH_CHOICES = [
  { key: "under_18", label: "I'm under 18" },
  { key: "pregnant", label: "Pregnant or breastfeeding" },
  { key: "eating_disorder", label: "An eating disorder, now or in the past" },
  { key: "medical", label: "A medical condition or medication that affects eating (diabetes, kidney, heart, thyroid, digestive, GLP-1)" },
  { key: "none", label: "None of these" },
] as const;

export type HealthKey = (typeof HEALTH_CHOICES)[number]["key"];

export type CreateAnswers = {
  mealsPerDay: number;
  /** 0–7; 0 = they don't train. */
  trainingDays: number;
  trainingTime: string | null;
  likes: string[];
  likesText: string;
  avoid: string[];
  avoidText: string;
  diet: string;
  cooking: "simple" | "meal_prep";
  budget: "tight" | "moderate" | "flexible";
  health: HealthKey[];
};

/** The member's own targets (member_nutrition_targets, or their own plan's day). */
export type MemberTargets = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  goal?: string | null;
};

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
const pickMany = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => (allowed as readonly string[]).includes(x as string)))] : [];
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** The answers as the server keeps them: only the choices offered, typed words trimmed. */
export function cleanAnswers(raw: any): CreateAnswers {
  const trainingDays = clampInt(raw?.trainingDays, 0, 7, 3);
  const health = pickMany(raw?.health, HEALTH_CHOICES.map((h) => h.key));
  return {
    mealsPerDay: clampInt(raw?.mealsPerDay, 3, 6, 4),
    trainingDays,
    trainingTime: trainingDays > 0 ? pick(raw?.trainingTime, TRAINING_TIMES) : null,
    likes: pickMany(raw?.likes, LIKE_CHIPS),
    likesText: text(raw?.likesText, 300),
    avoid: pickMany(raw?.avoid, AVOID_CHIPS),
    avoidText: text(raw?.avoidText, 300),
    diet: pick(raw?.diet, DIET_CHOICES) ?? "No restrictions",
    cooking: raw?.cooking === "simple" ? "simple" : "meal_prep",
    budget: pick(raw?.budget, ["tight", "moderate", "flexible"] as const) ?? "moderate",
    // "none" means nothing only on its own
    health: health.length > 1 ? health.filter((h) => h !== "none") : health,
  };
}

/** What's missing before a draft can be asked for (the screens walk through these). */
export function missingAnswers(a: Partial<CreateAnswers> & { health?: string[] }): string[] {
  const out: string[] = [];
  if (!a.mealsPerDay) out.push("meals");
  if (a.trainingDays == null) out.push("training");
  if ((a.trainingDays ?? 0) > 0 && !a.trainingTime) out.push("time");
  if (!a.health?.length) out.push("health");
  return out;
}

/* ------------------------------------------------------------------ */
/*  The safety screen                                                  */
/* ------------------------------------------------------------------ */

export type CreateSafety =
  | { ok: true }
  | { ok: false; reason: "eating_disorder" | "minor" | "pregnancy" | "medical"; message: string };

const SAFETY_MESSAGE: Record<Exclude<CreateSafety, { ok: true }>["reason"], string> = {
  eating_disorder:
    "Cleo doesn't write meal plans for anyone with an eating disorder, now or in the past. The best place to plan your eating is with a doctor or registered dietitian who knows your history. If things feel hard right now, please reach out to someone you trust or a local support line.",
  minor:
    "Cleo doesn't write meal plans for anyone under 18. Your eating is best planned with a parent or guardian and a doctor or registered dietitian, so it fuels your training and your growth.",
  pregnancy:
    "Cleo doesn't write meal plans during pregnancy or while breastfeeding: what you need changes along the way, and a doctor or registered dietitian can plan it with you.",
  medical:
    "Cleo doesn't write meal plans alongside a medical condition or medication that affects eating, because what's right for you depends on it. A doctor or registered dietitian can plan it with you. If you already have a plan from them, you can import it instead.",
};

/**
 * Who gets no draft, decided in code before any model is asked: under 18, pregnant or
 * breastfeeding, an eating-disorder history, or a medical condition named (in their
 * answers, their health profile or their words; the roadmap's screenSafety and the
 * Nutrition Update's safetyNotes terms). An eating disorder is checked first, so its
 * message never points them at counting food themselves.
 */
export function createSafety(a: CreateAnswers, onFile: { age: number | null; healthTexts: string[] }): CreateSafety {
  const said: string[] = [...onFile.healthTexts, a.avoidText, a.likesText];
  if (a.health.includes("pregnant")) said.push("pregnant");
  if (a.health.includes("eating_disorder")) said.push("eating disorder");
  const s = screenSafety({
    age: a.health.includes("under_18") ? 17 : onFile.age,
    sex: null,
    heightCm: null,
    kg: null,
    healthTexts: said.filter(Boolean),
    recentLowEnergy: 0,
    recentChecks: 0,
    cycleChanged: false,
    illness: false,
    trendPctPerWeek: null,
    intakeKcal: null,
    rmr: null,
    losing: false,
  });
  const has = (k: string) => s.flags.some((f) => f.key === k);
  const reason = has("eating_disorder")
    ? "eating_disorder"
    : has("minor")
      ? "minor"
      : has("pregnancy")
        ? "pregnancy"
        : a.health.includes("medical") || s.flags.some((f) => f.key.startsWith("medical:"))
          ? "medical"
          : null;
  return reason ? { ok: false, reason, message: SAFETY_MESSAGE[reason] } : { ok: true };
}

/** Age in whole years on a day (YYYY-MM-DD birth date), or null. */
export function ageOn(dob: string | null | undefined, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob ?? ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

/* ------------------------------------------------------------------ */
/*  What the plan must never hold                                      */
/* ------------------------------------------------------------------ */

const CHIP_CATEGORY: Record<string, string> = { Pork: "Pork", "Red meat": "Red meat" };

/**
 * The categories their draft must never hold (allergenConflicts' categories): what they
 * ticked, the allergens their words name, and everything their diet rules out.
 */
export function restrictionsOf(a: Pick<CreateAnswers, "avoid" | "avoidText" | "diet">): { categories: string[]; label: string | null } {
  const cats = new Set<string>();
  for (const c of a.avoid) cats.add(CHIP_CATEGORY[c] ?? c);
  for (const c of allergensIn(a.avoidText)) cats.add(c);
  const diets = new Set(dietTags([a.avoidText]));
  if (a.diet && a.diet !== "No restrictions") diets.add(a.diet);
  for (const d of diets) for (const c of DIET_RULES[d] ?? []) cats.add(c);
  const label = [
    ...a.avoid,
    a.avoidText,
    ...[...diets].map((d) => `diet: ${d}`),
  ]
    .filter(Boolean)
    .join(", ");
  return { categories: [...cats], label: label || null };
}

/* ------------------------------------------------------------------ */
/*  Their answers and targets as the meal-plan writer reads them        */
/* ------------------------------------------------------------------ */

/** The plan's phase from the goal on their saved targets. */
export function phaseForGoal(goal: string | null | undefined): string {
  if (goal === "lose") return "Fat Loss";
  if (goal === "gain") return "Muscle Gain";
  return "Maintenance";
}

/**
 * Their answers as the Nutrition Update's questions, so the same client details
 * (mealPlanUserPrompt) read them: each label holds the words `answerFor` looks for.
 */
export function createQAs(a: CreateAnswers): QA[] {
  const avoid = [...a.avoid, a.avoidText].filter(Boolean).join(", ");
  const likes = [...a.likes, a.likesText].filter(Boolean).join(", ");
  return [
    { label: "Meals per day", value: String(a.mealsPerDay) },
    { label: "Training days per week", value: String(a.trainingDays) },
    { label: "What time do you usually train?", value: a.trainingDays > 0 ? a.trainingTime ?? "" : "They don't train" },
    { label: "Allergies or foods you won't eat", value: avoid || "None" },
    { label: "Foods you love", value: likes || "No preference" },
  ];
}

/** Their targets in the targets block's own format (parseAiTargets reads it back for the checks). */
export function createTargetsText(t: MemberTargets): string {
  return [
    "CALORIE TARGETS:",
    `Every Day: ${Math.round(t.calories)}`,
    "",
    "MACRO TARGETS:",
    "Every Day:",
    `Protein: ${Math.round(t.protein_g)} g`,
    `Carbs: ${Math.round(t.carbs_g)} g`,
    `Fat: ${Math.round(t.fat_g)} g`,
  ].join("\n");
}

/** Targets that can be written to: calories and every macro, in a range a person could eat. */
export function usableTargets(t: Partial<MemberTargets> | null | undefined): MemberTargets | null {
  if (!t) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
  const kcal = n(t.calories);
  const p = n(t.protein_g);
  const c = n(t.carbs_g);
  const f = n(t.fat_g);
  if (!(kcal >= 1000 && kcal <= 6000) || !(p > 0) || !(c >= 0) || !(f > 0)) return null;
  return { calories: kcal, protein_g: p, carbs_g: c, fat_g: f, goal: t.goal ?? null };
}
