import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COOKBOOK, goalFit, recipeBody, recipeMacros, recipeTags } from "@/lib/cookbook/library";
import { AUDITED_RECIPES } from "@/lib/cookbook/audit-2026-11";
import { archivedAudit, COOKBOOK_MIGRATION, cookbookSql, keptRecipes, newRecipes } from "@/lib/cookbook/sql";
import { canLogEntry, cookbookEntry, filterCookbook } from "@/lib/cookbook/view";
import { RECIPE_DISCLAIMER } from "@/lib/nutrition-disclaimer";
import type { Recipe } from "@/lib/recipes";

const read = (p: string) => readFileSync(p, "utf8");

function asRow(r: (typeof COOKBOOK)[number]): Recipe {
  const m = recipeMacros(r);
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    status: "Published",
    access_scope: "everyone",
    body: recipeBody(r),
    video_url: null,
    tags: recipeTags(r),
    author_id: null,
    published_at: null,
    created_at: "",
    updated_at: "",
    image_url: null,
    calories_per_serving: m.calories,
    protein_grams: m.protein,
    prep_time_minutes: r.prepMinutes,
    servings: r.servings,
  };
}

describe("the cookbook is short, simple and high-protein", () => {
  it("32 recipes, unique ids and titles", () => {
    expect(COOKBOOK).toHaveLength(32);
    expect(new Set(COOKBOOK.map((r) => r.id)).size).toBe(32);
    expect(new Set(COOKBOOK.map((r) => r.title.toLowerCase())).size).toBe(32);
  });

  it("10 minutes or less hands-on, except meal prep (made once for several days)", () => {
    for (const r of COOKBOOK) {
      if (r.category === "Meal Prep") {
        expect(r.prepMinutes, r.title).toBeLessThanOrEqual(15);
        expect(r.servings, r.title).toBeGreaterThanOrEqual(4);
      } else {
        expect(r.prepMinutes, r.title).toBeLessThanOrEqual(10);
      }
    }
  });

  it("a handful of ingredients, 3 to 4 steps at most", () => {
    for (const r of COOKBOOK) {
      expect(r.ingredients.filter((i) => i.food).length, r.title).toBeLessThanOrEqual(5);
      expect(r.ingredients.length, r.title).toBeLessThanOrEqual(6);
      expect(r.steps.length, r.title).toBeLessThanOrEqual(4);
    }
  });

  it("protein first: 25 g+ a meal or breakfast, 15 g+ a snack or sweet", () => {
    for (const r of COOKBOOK) {
      const m = recipeMacros(r);
      const min = r.category === "Snack" || r.category === "Dessert" ? 15 : 25;
      expect(m.protein, r.title).toBeGreaterThanOrEqual(min);
    }
  });

  it("the numbers add up: calories within 10% of 4 / 4 / 9 from the macros", () => {
    for (const r of COOKBOOK) {
      const m = recipeMacros(r);
      const atwater = m.protein * 4 + m.carbs * 4 + m.fat * 9;
      expect(Math.abs(atwater - m.calories) / m.calories, r.title).toBeLessThan(0.1);
    }
  });

  it("every recipe says how to cut and how to bulk; both goals have plenty of choice", () => {
    for (const r of COOKBOOK) {
      expect(r.cutting.length, r.title).toBeGreaterThan(5);
      expect(r.bulking.length, r.title).toBeGreaterThan(5);
    }
    const fits = COOKBOOK.map((r) => goalFit(recipeMacros(r)));
    expect(fits.filter((f) => f.cutting).length).toBeGreaterThanOrEqual(12);
    expect(fits.filter((f) => f.bulking).length).toBeGreaterThanOrEqual(10);
  });

  it("food safety in the steps matches the disclaimer (Health Canada temperatures)", () => {
    const all = COOKBOOK.flatMap((r) => r.steps).join(" ");
    expect(all).toContain("74°C (165°F)");
    expect(all).toContain("70°C (158°F)");
    expect(all).not.toMatch(/salmon[^.]*63°C/i);
    const text = RECIPE_DISCLAIMER.join(" ");
    for (const s of ["estimates", "allergens", "74°C (165°F)", "71°C (160°F)", "70°C (158°F)", "not medical advice"]) expect(text).toContain(s);
  });
});

describe("the migration is generated and safe", () => {
  it("the file is exactly what library.ts generates", () => {
    expect(read(COOKBOOK_MIGRATION)).toBe(cookbookSql());
  });

  it("31 recipes rewritten in place, 1 new, the other 128 archived: nothing deleted", () => {
    expect(AUDITED_RECIPES).toHaveLength(159);
    expect(keptRecipes()).toHaveLength(31);
    expect(newRecipes()).toHaveLength(1);
    expect(archivedAudit()).toHaveLength(128);
    const sql = cookbookSql();
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
    // every row backed up before anything changes
    expect(sql.indexOf("recipes_cookbook_backup_20261115")).toBeLessThan(sql.indexOf("UPDATE public.recipes SET"));
    // only a recipe still exactly as audited is touched
    expect(sql.match(/AND md5\(body\) = '[0-9a-f]{32}';/g)).toHaveLength(31);
    expect(sql).toContain("AND md5(r.body) = a.body_md5;");
  });

  it("the recipes people looked at most are the ones kept (their views stay with them)", () => {
    const kept = new Set(keptRecipes().map((r) => r.id));
    // Hot Honey Chicken (6 viewers), the sushi bowl (3), air fryer chicken and salmon
    for (const id of ["4271bcae-6e5e-40ad-8a0c-cbe1a4f37e96", "4f795426-5275-4fb4-9ade-9d557a6d45e7", "c16a96ba-d156-4880-9b2f-b9375774b189", "e1f45443-3ce7-4306-824a-4f8e2f16aac9"]) {
      expect(kept.has(id)).toBe(true);
    }
  });
});

describe("the cookbook reads its own recipes back", () => {
  const entries = COOKBOOK.map((r) => cookbookEntry(asRow(r)));

  it("body → numbers, ingredients, steps, cut / bulk lines and prep time", () => {
    COOKBOOK.forEach((r, i) => {
      const e = entries[i];
      const m = recipeMacros(r);
      expect([e.calories, e.protein, e.carbs, e.fat], r.title).toEqual([m.calories, m.protein, m.carbs, m.fat]);
      expect(e.ingredients).toEqual(r.ingredients.map((x) => x.text));
      expect(e.steps).toEqual(r.steps);
      expect(e.cutting).toBe(r.cutting);
      expect(e.bulking).toBe(r.bulking);
      expect(e.prepMinutes).toBe(r.prepMinutes);
      expect(e.servings).toBe(r.servings);
      expect(canLogEntry(e)).toBe(true);
    });
  });

  it("meal types, goals and search filter on the phone", () => {
    const meals = filterCookbook(entries, { group: "meals" });
    expect(meals.every((e) => e.category === "Lunch" || e.category === "Dinner")).toBe(true);
    const cut = filterCookbook(entries, { goal: "cutting" });
    const share = (e: (typeof cut)[number]) => (e.protein! * 4) / e.calories!;
    expect(cut.every((e) => e.cuttingFit)).toBe(true);
    expect(share(cut[0])).toBeGreaterThanOrEqual(share(cut[cut.length - 1]));
    const bulk = filterCookbook(entries, { goal: "bulking" });
    expect(bulk[0].calories!).toBeGreaterThanOrEqual(bulk[bulk.length - 1].calories!);
    expect(filterCookbook(entries, { search: "sweet potato" }).map((e) => e.title)).toEqual(["Hot Honey Chicken & Sweet Potato"]);
    expect(filterCookbook(entries, { search: "air fryer" }).length).toBeGreaterThanOrEqual(4);
  });

  it("an older recipe without the cut / bulk lines still reads", () => {
    const e = cookbookEntry({
      ...asRow(COOKBOOK[0]),
      body: "## Ingredients\n\n- 2 eggs\n\n## Instructions\n\n1. Cook.\n\n## Nutrition\n\n- **Calories:** 140\n- **Protein:** 12 g\n",
      calories_per_serving: null,
      protein_grams: null,
    });
    expect(e.calories).toBe(140);
    expect(e.cutting).toBeNull();
    expect(canLogEntry(e)).toBe(false);
  });
});

describe("the Cookbook screens", () => {
  it("opens a recipe inside the sheet, never by leaving Nutrition", () => {
    const content = read("src/components/nutrition/CookbookContent.tsx");
    expect(content).not.toContain("<Link");
    expect(content).toContain("onClick={() => onOpen(e.id)}");
    expect(read("src/components/nutrition/CookbookSheet.tsx")).toContain('{recipeId ? "Recipes" : "Back"}');
  });
  it("the old recipe list redirects to the Cookbook; the disclaimer is on the list and every recipe", () => {
    expect(read("src/routes/_authenticated/portal/recipes.index.tsx")).toContain('search: { cookbook: "1" }');
    expect(read("src/components/nutrition/CookbookContent.tsx")).toContain("<RecipeDisclaimer");
    expect(read("src/components/nutrition/CookbookRecipe.tsx")).toContain("<RecipeDisclaimer />");
  });
});
