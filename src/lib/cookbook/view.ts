/**
 * How the Cookbook reads a recipe row: one pure shape for the list and the
 * recipe screen (per-serving numbers, ingredients, steps, the cutting and
 * bulking lines, tips), and the list's filters. Works for the curated set
 * (library.ts) and for any recipe the coach writes in the admin editor, from
 * the same body format (recipe-format.ts).
 */

import { parseRecipeBody, type RecipeSection } from "@/lib/recipe-format";
import { getRecipeCardMeta } from "@/lib/recipe-meta";
import type { Recipe } from "@/lib/recipes";
import { goalFit } from "./library";

export type CookbookGroup = "all" | "breakfast" | "meals" | "snacks" | "sweet" | "meal-prep";
export type CookbookGoal = "any" | "cutting" | "bulking";

export const COOKBOOK_GROUPS: { value: CookbookGroup; label: string; categories: string[] }[] = [
  { value: "all", label: "All", categories: [] },
  { value: "breakfast", label: "Breakfast", categories: ["Breakfast"] },
  { value: "meals", label: "Meals", categories: ["Lunch", "Dinner"] },
  { value: "snacks", label: "Snacks", categories: ["Snack", "Custom"] },
  { value: "sweet", label: "Sweet", categories: ["Dessert"] },
  { value: "meal-prep", label: "Meal prep", categories: ["Meal Prep"] },
];

export const COOKBOOK_GOALS: { value: CookbookGoal; label: string }[] = [
  { value: "cutting", label: "Cutting" },
  { value: "bulking", label: "Bulking" },
];

const METHOD_LABEL: Record<string, string> = {
  "no-cook": "No cooking",
  microwave: "Microwave",
  pan: "One pan",
  "one-pan": "One pan",
  "air-fryer": "Air fryer",
  oven: "Oven",
  stovetop: "Stovetop",
};

const GROUP_ORDER: Record<string, number> = { Breakfast: 0, Lunch: 1, Dinner: 1, Snack: 2, Custom: 2, Dessert: 3, "Meal Prep": 4 };

export type CookbookEntry = {
  id: string;
  title: string;
  category: string;
  method: string | null;
  prepMinutes: number | null;
  /** "18 min hands-off", "Overnight in the fridge". */
  cookNote: string | null;
  servings: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  ingredients: string[];
  steps: string[];
  cutting: string | null;
  bulking: string | null;
  tips: string[];
  /** Other notes the recipe carries (older recipes' free text). */
  notes: string[];
  cuttingFit: boolean;
  bulkingFit: boolean;
  vegetarian: boolean;
  videoUrl: string | null;
};

function listOf(sections: RecipeSection[], label: string): string[] {
  const s = sections.find((x) => x.kind === "list" && x.label === label) as Extract<RecipeSection, { kind: "list" }> | undefined;
  return s?.items ?? [];
}

function fieldOf(sections: RecipeSection[], label: string): string | null {
  const s = sections.find((x) => x.kind === "field" && x.label === label) as Extract<RecipeSection, { kind: "field" }> | undefined;
  return s?.value?.trim() || null;
}

const after = (line: string, key: string) => line.replace(new RegExp(`^\\s*${key}\\s*:\\s*`, "i"), "").trim();

export function cookbookEntry(recipe: Recipe): CookbookEntry {
  const parsed = parseRecipeBody(recipe.body ?? "");
  const meta = getRecipeCardMeta(recipe);
  const notes = listOf(parsed.sections, "Notes");
  const cutting = notes.find((n) => /^\s*cutting\s*:/i.test(n));
  const bulking = notes.find((n) => /^\s*bulking\s*:/i.test(n));
  const tips = notes.filter((n) => /^\s*tip\s*:/i.test(n)).map((n) => after(n, "tip"));
  const rest = notes.filter((n) => n !== cutting && n !== bulking && !/^\s*tip\s*:/i.test(n));
  const tags = new Set(recipe.tags ?? []);
  const method = Object.keys(METHOD_LABEL).find((m) => tags.has(m)) ?? null;
  const calories = meta.calories;
  const protein = meta.protein;
  const fit =
    calories != null && protein != null ? goalFit({ calories, protein }) : { cutting: tags.has("cutting"), bulking: tags.has("bulking") };
  return {
    id: recipe.id,
    title: recipe.title,
    category: recipe.category,
    method: method ? METHOD_LABEL[method] : null,
    prepMinutes: meta.prepMinutes,
    cookNote: fieldOf(parsed.sections, "Cook Time"),
    servings: Math.max(1, meta.servings ?? 1),
    calories,
    protein,
    carbs: meta.carbs,
    fat: meta.fats,
    ingredients: listOf(parsed.sections, "Ingredients"),
    steps: listOf(parsed.sections, "Instructions"),
    cutting: cutting ? after(cutting, "cutting") : null,
    bulking: bulking ? after(bulking, "bulking") : null,
    tips,
    notes: rest,
    cuttingFit: fit.cutting,
    bulkingFit: fit.bulking,
    vegetarian: tags.has("vegetarian") || tags.has("vegan"),
    videoUrl: recipe.video_url || parsed.videoUrl || null,
  };
}

/** Whether a recipe carries every number "Log this meal" needs. */
export function canLogEntry(e: Pick<CookbookEntry, "calories" | "protein" | "carbs" | "fat">): boolean {
  return [e.calories, e.protein, e.carbs, e.fat].every((v) => v != null && Number.isFinite(v));
}

export function filterCookbook(
  entries: CookbookEntry[],
  { group = "all", goal = "any", search = "" }: { group?: CookbookGroup; goal?: CookbookGoal; search?: string },
): CookbookEntry[] {
  const cats = COOKBOOK_GROUPS.find((g) => g.value === group)?.categories ?? [];
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = entries.filter((e) => {
    if (cats.length && !cats.includes(e.category)) return false;
    if (goal === "cutting" && !e.cuttingFit) return false;
    if (goal === "bulking" && !e.bulkingFit) return false;
    if (words.length) {
      const hay = `${e.title} ${e.ingredients.join(" ")} ${e.method ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const proteinShare = (e: CookbookEntry) => (e.calories && e.protein ? (e.protein * 4) / e.calories : 0);
  return out.sort((a, b) => {
    if (goal === "cutting") return proteinShare(b) - proteinShare(a) || a.title.localeCompare(b.title);
    if (goal === "bulking") return (b.calories ?? 0) - (a.calories ?? 0) || a.title.localeCompare(b.title);
    const g = (GROUP_ORDER[a.category] ?? 9) - (GROUP_ORDER[b.category] ?? 9);
    if (g) return g;
    return (a.prepMinutes ?? 99) - (b.prepMinutes ?? 99) || a.title.localeCompare(b.title);
  });
}
