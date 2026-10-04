import { describe, expect, it } from "vitest";
import { buildGroceryList } from "@/lib/grocery-list";
import { groupByAisle, groceryListText, shopInfo } from "@/lib/grocery-shop";

const mass = (name: string, grams: number) => shopInfo({ name, measure: { kind: "mass", grams } });

describe("Canadian grocery shop info", () => {
  it("converts cooked meat to raw and rounds up to real packs", () => {
    const c = mass("chicken breast", 1400);
    expect(c.aisle).toBe("Meat & Seafood");
    expect(c.buy).toBe("2 family packs (~1 kg each)");
    expect(c.detail).toBe("≈ 1.9 kg (4.1 lb) raw · 1.4 kg cooked in your plan");
    expect(mass("extra lean ground beef", 1050).buy).toBe("3 × 454 g (1 lb) packs");
    expect(mass("ground chicken", 700).aisle).toBe("Meat & Seafood");
  });

  it("converts cooked rice to dry and uses Canadian bag sizes", () => {
    const r = mass("white rice", 1400);
    expect(r.aisle).toBe("Rice, Pasta & Grains");
    expect(r.buy).toBe("1 × 2 kg bag");
    expect(r.detail).toContain("dry");
    expect(mass("rice cakes", 54).aisle).toBe("Snacks");
  });

  it("buys produce by the piece", () => {
    expect(mass("banana", 480).buy).toBe("4 bananas");
    expect(mass("sweet potato", 1000).buy).toBe("5 medium sweet potatoes");
    expect(mass("salt and pepper", 2).aisle).toBe("Spices, Sauces & Condiments");
    expect(mass("red pepper", 300).aisle).toBe("Produce");
  });

  it("handles eggs, scoops and slices", () => {
    expect(shopInfo({ name: "eggs", measure: { kind: "count", qty: 21, unit: null } }).buy).toBe("2 dozen eggs");
    expect(shopInfo({ name: "whey protein", measure: { kind: "count", qty: 14, unit: "scoop" } }).buy).toBe("1 × 2 lb tub");
    expect(shopInfo({ name: "whole wheat bread", measure: { kind: "count", qty: 14, unit: "slice" } }).buy).toBe("1 × 675 g loaf");
  });

  it("does not file peanut butter as dairy", () => {
    expect(mass("natural peanut butter", 224).aisle).toBe("Nut Butters, Oils & Nuts");
    expect(mass("butter", 50).aisle).toBe("Dairy & Eggs");
  });

  it("groups a real plan in store walk order and exports text", () => {
    const list = buildGroceryList({
      planDays: [{ day_label: "Training Day", notes: "Meal 1\n80 g oats\n30 g whey protein\n\nMeal 2\n200 g chicken breast\n250 g white rice\n150 g broccoli\n120 g banana" }],
      dayCounts: { training: 7, non_training: 0, high: 0 },
    });
    const groups = groupByAisle(list.items);
    expect(groups.map((g) => g.aisle)).toEqual(["Produce", "Meat & Seafood", "Rice, Pasta & Grains", "Breakfast & Cereal", "Supplements"]);
    const text = groceryListText(groups, "Week of Oct 5");
    expect(text).toContain("🥩 MEAT & SEAFOOD");
    expect(text).toContain("☐ chicken breast — 2 family packs (~1 kg each)");
  });
});
