import { parseRecipeBody } from "./recipe-format";

/**
 * Lightweight extraction of card-friendly metadata from a recipe body.
 * Avoids ingredient/markdown previews — we want numbers, not prose.
 */
export type RecipeMeta = {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  prepMinutes: number | null;
  servings: number | null;
};

function num(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = String(value).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function macroValue(macros: { key: string; value: string }[], keys: string[]): number | null {
  for (const m of macros) {
    const k = m.key.toLowerCase();
    if (keys.some((want) => k.includes(want))) return num(m.value);
  }
  return null;
}

export function getRecipeMeta(body: string | null | undefined): RecipeMeta {
  const parsed = parseRecipeBody(body ?? "");
  const macros = parsed.sections.find((s) => s.kind === "macros") as
    | { kind: "macros"; macros: { key: string; value: string }[] }
    | undefined;
  const prepField = parsed.sections.find(
    (s) => s.kind === "field" && (s.label === "Prep Time" || s.label === "Total Time"),
  ) as { kind: "field"; value: string } | undefined;

  return {
    calories: macros ? macroValue(macros.macros, ["calorie", "kcal"]) : null,
    protein: macros ? macroValue(macros.macros, ["protein"]) : null,
    carbs: macros ? macroValue(macros.macros, ["carb"]) : null,
    fats: macros ? macroValue(macros.macros, ["fat"]) : null,
    prepMinutes: prepField ? num(prepField.value) : null,
    servings: num(parsed.servings ?? null),
  };
}
