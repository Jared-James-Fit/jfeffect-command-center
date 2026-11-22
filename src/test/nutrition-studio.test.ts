import { describe, expect, it } from "vitest";
import { BUILTIN_FOODS, BUILTIN_SOURCES, builtinFood, customFood } from "@/lib/nutrition-studio/foods";
import { STAPLE_FOODS, BEEF_PER100_BY_LEAN, mealsOffTheirFoods } from "@/lib/nutrition-targets/food-values";
import { FOODS as COOKBOOK } from "@/lib/cookbook/foods";
import {
  dayMacros,
  duplicateMeal,
  itemLine,
  itemMacros,
  matchFood,
  mealMacros,
  newMeal,
  readDay,
  readItemLine,
  removeMeal,
  updateMeal,
  writeDay,
  type StudioDay,
} from "@/lib/nutrition-studio/model";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";
import { parseMealPlan } from "@/lib/nutrition-targets/meal-plan-parse";

const lookup = (id: string) => builtinFood(id);

// A real day as the app stores it (an Active plan, Nov 22 2026; foods only, nothing personal).
const DAY = `Meal 1
100 g cooked chicken breast
250 g cooked sweet potatoes
150 g berries
25 g olive oil

Approximate macros:
37 g protein
70 g carbohydrates
28 g fat
15 g fibre

Meal 2 (Pre-Workout)
100 g cooked chicken breast
250 g cooked sweet potatoes
1 medium banana
1 apple

Approximate macros:
36 g protein
104 g carbohydrates
3 g fat
15 g fibre

Daily Total
Approximately 73 g protein, 174 g carbohydrates, 31 g fat and 30 g fibre`;

describe("the Studio's foods are the app's own tables", () => {
  it("every built-in food carries exactly its source's values", () => {
    for (const f of BUILTIN_FOODS) {
      const src = BUILTIN_SOURCES[f.id.slice(2)];
      expect(src, f.id).toBeTruthy();
      if (src.table === "staple") {
        const s = STAPLE_FOODS.find((x) => x.key === src.key)!;
        expect(f.per100).toEqual(src.form === "dry" ? s.dry : s.per100);
      } else if (src.table === "cookbook") {
        expect(f.per100).toEqual(COOKBOOK[src.key]);
      } else {
        expect(f.per100).toEqual(BEEF_PER100_BY_LEAN[src.lean]);
      }
    }
  });

  it("ids are unique", () => {
    expect(new Set(BUILTIN_FOODS.map((f) => f.id)).size).toBe(BUILTIN_FOODS.length);
  });

  it("a label's per-serving food works per serving, and per 100 g when it has a weight", () => {
    const bar = customFood({ id: "1", name: "Protein bar", basis: "per_serving", serving_label: "bar", serving_grams: 60, kcal: 210, protein: 20, carbs: 22, fat: 7 });
    expect(itemMacros(bar, 1, "each")).toEqual({ kcal: 210, protein: 20, carbs: 22, fat: 7 });
    const m = itemMacros(bar, 30, "g")!;
    expect(Math.round(m.protein)).toBe(10);
    const noWeight = customFood({ id: "2", name: "Granola cup", basis: "per_serving", kcal: 180, protein: 6, carbs: 30, fat: 4 });
    expect(itemMacros(noWeight, 2, "each")!.kcal).toBe(360);
    expect(itemMacros(noWeight, 50, "g")).toBeNull();
  });
});

describe("reading plan lines", () => {
  it("reads the foods the app writes", () => {
    const cases: Array<[string, string, number, string]> = [
      ["100 g cooked chicken breast", "b:chicken_breast_cooked", 100, "g"],
      ["120 g raw chicken breast", "b:chicken_breast_raw", 120, "g"],
      ["80 g dry oats", "b:oats", 80, "g"],
      ["60 g dry white rice", "b:white_rice_dry", 60, "g"],
      ["1 medium banana", "b:banana", 1, "each"],
      ["3 whole eggs", "b:eggs", 3, "each"],
      ["1 scoop whey protein", "b:whey", 1, "each"],
      ["2 slices bread", "b:bread", 2, "each"],
      ["½ bagel", "b:bagel", 0.5, "each"],
      ["150 g cooked 93% lean ground beef", "b:beef_93_cooked", 150, "g"],
      ["1 tbsp peanut butter", "b:peanut_butter", 1, "tbsp"],
      ["30 g part-skim mozzarella", "b:mozzarella", 30, "g"],
    ];
    for (const [line, id, qty, unit] of cases) {
      const it = readItemLine(line);
      expect(it.foodId, line).toBe(id);
      expect(it.qty, line).toBe(qty);
      expect(it.unit, line).toBe(unit);
    }
  });

  it("keeps a line it can't place exactly as written", () => {
    const it = readItemLine("1 cup grandma's stew");
    expect(it.foodId).toBeNull();
    expect(it.text).toBe("1 cup grandma's stew");
    expect(readItemLine("Season to taste").foodId).toBeNull();
  });

  it("finds a custom food by its name before the list", () => {
    const yogurt = customFood({ id: "y", name: "Oikos pro yogurt", basis: "per_100g", kcal: 70, protein: 12, carbs: 4, fat: 0 });
    expect(matchFood("oikos pro yogurt", [yogurt])?.id).toBe("c:y");
  });

  it("writes lines back the way they're read", () => {
    for (const line of ["100 g cooked chicken breast", "1 medium banana", "2 medium bananas", "3 whole eggs", "1 scoop whey protein", "2 slices bread", "½ bagel", "1 apple", "25 g olive oil"]) {
      const it = readItemLine(line);
      expect(itemLine(it, lookup)).toBe(line);
    }
  });
});

describe("a day read and written back", () => {
  it("comes back byte for byte when nothing was edited", () => {
    const day = readDay(DAY);
    expect(day.meals).toHaveLength(2);
    expect(day.meals[1].timing).toBe("pre");
    expect(writeDay(day, lookup)).toBe(DAY);
  });

  it("an edited meal gets macros from its foods, the others keep theirs, and the Daily Total follows", () => {
    const day = readDay(DAY);
    const id = day.meals[0].id;
    const edited = updateMeal(day, id, (m) => ({ ...m, items: m.items.map((it) => (it.foodId === "b:chicken_breast_cooked" ? { ...it, qty: 200 } : it)) }));
    const text = writeDay(edited, lookup);
    // Meal 2 untouched
    expect(text).toContain(day.meals[1].raw!);
    const meals = structureMealPlanDay(text).meals;
    // Meal 1: 200 g chicken (62 g protein) + sweet potato 5 + berries 1.2 + oil 0 ≈ 68
    expect(meals[0].macros?.protein).toBe(68);
    const [parsed] = parseMealPlan(`TRAINING DAY MENU\n${text}`);
    expect(parsed.protein).toBe(68 + 36);
    // the meal's macros now say what its foods give
    expect(mealsOffTheirFoods(text).map((m) => m.title)).not.toContain("Meal 1");
  });

  it("a meal with a food it couldn't read keeps that food's share when another food changes", () => {
    const text = `Meal 1\n150 g cooked chicken breast\n1 cup grandma's stew\n\nApproximate macros:\n60 g protein\n40 g carbohydrates\n15 g fat`;
    const day = readDay(text);
    const m = day.meals[0];
    expect(m.unreadBase).not.toBeNull();
    const before = mealMacros({ ...m, dirty: true }, lookup)!;
    expect(Math.round(before.protein)).toBe(60);
    const after = mealMacros({ ...m, items: m.items.map((it) => (it.foodId ? { ...it, qty: 100 } : it)), dirty: true }, lookup)!;
    expect(Math.round(after.protein)).toBe(Math.round(60 - 31 * 0.5));
  });

  it("new, duplicated and removed meals keep the day's total honest", () => {
    let day: StudioDay = readDay(DAY);
    day = duplicateMeal(day, day.meals[0].id);
    expect(day.meals.map((m) => m.title)).toEqual(["Meal 1", "Meal 3", "Meal 2"]);
    const add = newMeal(day);
    day = { ...day, meals: [...day.meals, { ...add, items: [readItemLine("200 g plain 0% greek yogurt")] }] };
    const total = dayMacros(day, lookup)!;
    const text = writeDay(day, lookup);
    const [parsed] = parseMealPlan(`DAY MENU\n${text}`);
    expect(parsed.protein).toBe(Math.round(37 + 37 + 36 + 20.6));
    expect(Math.round(total.protein)).toBe(Math.round(37 + 37 + 36 + 20.6));
    const fresh = readDay(DAY);
    const fewer = removeMeal(fresh, fresh.meals[0].id);
    const [p2] = parseMealPlan(`DAY MENU\n${writeDay(fewer, lookup)}`);
    expect(p2.protein).toBe(36);
  });
});

import { searchFoods } from "@/lib/nutrition-studio/search";
import { swapOptions } from "@/lib/nutrition-studio/swaps";

describe("finding a food", () => {
  const top = (q: string) => searchFoods(q, BUILTIN_FOODS).slice(0, 3).map((f) => f.id);
  it("reads plurals, word order and a half-typed word", () => {
    expect(top("chicken breast cooked")[0]).toBe("b:chicken_breast_cooked");
    expect(top("rice cooked")).toContain("b:white_rice_cooked");
    expect(top("bananas")[0]).toBe("b:banana");
    expect(top("chick bre")).toContain("b:chicken_breast_cooked");
    expect(top("greek")[0]).toBe("b:greek_yogurt");
  });
  it("drops a food a word doesn't match", () => {
    expect(searchFoods("chicken pizza", BUILTIN_FOODS)).toEqual([]);
  });
  it("puts the person's own food first", () => {
    const mine = customFood({ id: "m", name: "Chicken sausage", basis: "per_100g", kcal: 170, protein: 16, carbs: 3, fat: 10 });
    expect(searchFoods("chicken", [...BUILTIN_FOODS, mine])[0].id).toBe("c:m");
  });
});

describe("swapping a food", () => {
  it("swaps a protein for a protein at the same protein", () => {
    const chicken = builtinFood("b:chicken_breast_cooked")!;
    const opts = swapOptions({ id: "i", foodId: chicken.id, qty: 150, unit: "g" }, chicken, BUILTIN_FOODS);
    expect(opts.length).toBeGreaterThan(3);
    for (const o of opts) {
      expect(["protein", "dairy"]).toContain(o.food.category);
      expect(Math.abs(o.macros.protein - 46.5)).toBeLessThan(7);
    }
  });
  it("swaps rice for a carb at the same carbs, counted foods in whole or half units", () => {
    const rice = builtinFood("b:white_rice_cooked")!;
    const opts = swapOptions({ id: "i", foodId: rice.id, qty: 200, unit: "g" }, rice, BUILTIN_FOODS, 40);
    const potato = opts.find((o) => o.food.id === "b:potatoes_cooked")!;
    expect(potato.unit).toBe("g");
    expect(Math.abs(potato.macros.carbs - 56.4)).toBeLessThan(2);
    const bagel = opts.find((o) => o.food.id === "b:bagel")!;
    expect(bagel.unit).toBe("each");
    expect(bagel.qty * 2).toBe(Math.round(bagel.qty * 2));
  });
});
