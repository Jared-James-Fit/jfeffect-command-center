/**
 * Meal plans pasted from ChatGPT's copy button come back as plain text: no
 * slash after each food, no "1\." in the rules. The same cases are checked
 * against the database's nutrition_plain_text when its migration is applied.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { plainOrNull, plainPastedText } from "@/lib/nutrition-targets/plain-paste";
import { parseFoodWeighingRules, parseMealPlan } from "@/components/nutrition/MealPlanBulkPaste";
import { parseMealPlanText } from "@/components/meal-plan-display";

export const PLAIN_TEXT_CASES: Array<[string, string]> = [
  [
    "2 Large whole eggs\\\n75 g Oats (dry weight)\\\n1 Medium banana",
    "2 Large whole eggs\n75 g Oats (dry weight)\n1 Medium banana",
  ],
  [
    "30 g protein\\\n81 g carbohydrates \\\n23 g fat\\",
    "30 g protein\n81 g carbohydrates\n23 g fat",
  ],
  [
    "1\\. Weigh chicken AFTER cooking\\.\n\n2\\. Weigh oats dry",
    "1. Weigh chicken AFTER cooking.\n\n2. Weigh oats dry",
  ],
  ["\\- 15 g Olive oil \\(any\\)", "- 15 g Olive oil (any)"],
  ["**Meal 1**\n## TRAINING-DAY MENU", "Meal 1\nTRAINING-DAY MENU"],
  ["Meal 3 (Pre-Workout)\n\n1 Plain bagel", "Meal 3 (Pre-Workout)\n\n1 Plain bagel"],
  ["4 L water / day, 50/50 split", "4 L water / day, 50/50 split"],
  ["", ""],
];

const JARRETT = `TRAINING-DAY MENU

Meal 1

2 Large whole eggs\\
75 g Oats (dry weight)\\
1 Medium banana\\
15 g Peanut butter

Approximate macros:\\
30 g protein\\
81 g carbohydrates\\
23 g fat\\
12 g fibre

FOOD-WEIGHING RULES

1\\. Weigh chicken, turkey, rice and broccoli AFTER cooking.`;

describe("plainPastedText", () => {
  it.each(PLAIN_TEXT_CASES)("%j", (input, out) => {
    expect(plainPastedText(input)).toBe(out);
  });

  it("leaves null and undefined alone", () => {
    expect(plainOrNull(null)).toBeNull();
    expect(plainOrNull(undefined)).toBeUndefined();
  });

  it("a pasted ChatGPT plan parses into foods with no slashes and real macros", () => {
    const [day] = parseMealPlan(JARRETT);
    expect(day.notes).not.toContain("\\");
    expect(day.protein).toBe(30);
    expect(parseFoodWeighingRules(JARRETT)).toBe(
      "1. Weigh chicken, turkey, rice and broccoli AFTER cooking.",
    );
    const meal = parseMealPlanText(day.notes!).find((s) => s.kind === "meal");
    expect(meal).toMatchObject({
      items: [
        "2 Large whole eggs",
        "75 g Oats (dry weight)",
        "1 Medium banana",
        "15 g Peanut butter",
      ],
    });
    expect(meal && "approxMacros" in meal && meal.approxMacros?.items).toEqual([
      "30 g protein",
      "81 g carbohydrates",
      "23 g fat",
      "12 g fibre",
    ]);
  });

  it("the targets dialog saves plain text, and the database cleans every other save", () => {
    const dialog = readFileSync(
      new URL("../components/nutrition-target-dialog.tsx", import.meta.url),
      "utf8",
    );
    expect(dialog).toContain("notes: plainOrNull(rest.notes ?? null)");
    expect(dialog).toContain("food_weighing_rules: plainOrNull(form.food_weighing_rules || null)");
    const sql = readFileSync(
      new URL("../../supabase/migrations/20270104092000_nutrition_plain_text.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("before insert or update of notes on public.nutrition_target_days");
    expect(sql).toContain(
      "before insert or update of food_weighing_rules, client_notes, water on public.nutrition_targets",
    );
  });
});
