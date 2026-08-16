import { describe, it, expect, beforeEach } from "vitest";

// Minimal localStorage stub (test env is "node"); proves the shopping state
// touches nothing but its own browser-local key.
const store = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  },
};
import {
  buildGroceryList,
  parseIngredientLines,
  formatMeasure,
  planDayType,
  weekSummaryText,
} from "@/lib/grocery-list";
import { resolveClientWeekDays } from "@/lib/resolved-client-days";
import {
  groceryStateKey,
  readCheckedIdentities,
  writeCheckedIdentities,
  clearCheckedIdentities,
} from "@/lib/grocery-shopping-state";

const TRAINING_NOTES = `TRAINING-DAY MENU
Meal 1
200 g chicken breast (raw)
150 g white rice (cooked)
1 scoop whey protein
Daily Total: 2400 kcal
Protein: 200g Carbs: 250g Fats: 60g
All foods weighed raw unless stated`;

const NON_TRAINING_NOTES = `NON-TRAINING-DAY MENU
Meal 1
150 g chicken breast (raw)
100 g white rice (cooked)
30 g almonds`;

const HIGH_NOTES = `HIGH-DAY MENU
Meal 1
250 g chicken breast (raw)
2 slices sourdough bread`;

const PLAN_DAYS = [
  { id: "t", day_label: "Training Day", notes: TRAINING_NOTES },
  { id: "n", day_label: "Non-Training Day", notes: NON_TRAINING_NOTES },
  { id: "h", day_label: "High Day", notes: HIGH_NOTES },
];

describe("ingredient parsing", () => {
  it("ignores headers, meal labels, macro blocks, totals and prose", () => {
    const parsed = parseIngredientLines(TRAINING_NOTES);
    expect(parsed.map((p) => p.name)).toEqual([
      "chicken breast (raw)",
      "white rice (cooked)",
      "whey protein",
    ]);
  });

  it("keeps raw and cooked forms distinct", () => {
    const parsed = parseIngredientLines("100 g chicken breast (raw)\n100 g chicken breast (cooked)");
    expect(parsed[0].identity).not.toEqual(parsed[1].identity);
    const out = buildGroceryList({
      planDays: [{ day_label: "Training Day", notes: "100 g chicken breast (raw)\n100 g chicken breast (cooked)" }],
      dayCounts: { training: 1, non_training: 0, high: 0 },
    });
    expect(out.items).toHaveLength(2);
  });

  it("never derives counts from grams", () => {
    const [g] = parseIngredientLines("200 g chicken breast");
    expect(g.measure).toEqual({ kind: "mass", grams: 200 });
    const [c] = parseIngredientLines("2 eggs");
    expect(c.measure).toEqual({ kind: "count", qty: 2, unit: null });
    expect(c.name).toBe("eggs");
  });
});

describe("day-type multiplication", () => {
  it("multiplies Training x4, Non-Training x2, High x1", () => {
    const out = buildGroceryList({
      planDays: PLAN_DAYS,
      dayCounts: { training: 4, non_training: 2, high: 1 },
    });
    const chicken = out.items.find((i) => i.name === "chicken breast (raw)")!;
    // 200*4 + 150*2 + 250*1 = 1350 g
    expect((chicken.measure as any).grams).toBe(1350);
    expect(chicken.quantityLabel).toBe("1.35 kg");
    const rice = out.items.find((i) => i.name === "white rice (cooked)")!;
    expect((rice.measure as any).grams).toBe(150 * 4 + 100 * 2);
    const whey = out.items.find((i) => i.name === "whey protein")!;
    expect(whey.quantityLabel).toBe("4 scoops");
    expect(out.totalDaysCovered).toBe(7);
  });

  it("merges duplicate ingredient lines within one day", () => {
    const out = buildGroceryList({
      planDays: [{ day_label: "Training Day", notes: "100 g oats\n50 g oats" }],
      dayCounts: { training: 2, non_training: 0, high: 0 },
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].quantityLabel).toBe("300 g");
  });

  it("does not invent substitutes for missing plan day labels", () => {
    const out = buildGroceryList({
      planDays: [{ day_label: "Training Day", notes: "100 g oats" }, { day_label: "High Day", notes: "50 g honey" }],
      dayCounts: { training: 3, non_training: 3, high: 1 },
    });
    expect(out.unmatchedDayTypes).toEqual(["non_training"]);
    expect(out.items.find((i) => i.name === "oats")!.quantityLabel).toBe("300 g");
  });

  it("calculates a single plan day across the whole week", () => {
    const out = buildGroceryList({
      planDays: [{ day_label: "Daily", notes: "100 g oats" }],
      dayCounts: { training: 4, non_training: 2, high: 1 },
    });
    expect(out.items[0].quantityLabel).toBe("700 g");
  });

  it("formats g→kg and ml→L with max 2 decimals", () => {
    expect(formatMeasure({ kind: "mass", grams: 999 })).toBe("999 g");
    expect(formatMeasure({ kind: "mass", grams: 1250 })).toBe("1.25 kg");
    expect(formatMeasure({ kind: "volume", ml: 1500 })).toBe("1.5 L");
    expect(formatMeasure({ kind: "volume", ml: 250 })).toBe("250 ml");
  });

  it("shows the exact empty state inputs when no plan exists", () => {
    const out = buildGroceryList({ planDays: [], dayCounts: { training: 4, non_training: 2, high: 1 } });
    expect(out.items).toHaveLength(0);
    expect(out.sections).toHaveLength(0);
  });

  it("summarises the week", () => {
    expect(weekSummaryText({ training: 4, non_training: 2, high: 1 })).toBe(
      "4 Training Days · 2 Non-Training Days · 1 High Day",
    );
  });

  it("maps plan day labels deterministically", () => {
    expect(planDayType("HIGH-DAY MENU")).toBe("high");
    expect(planDayType("Non-Training Day")).toBe("non_training");
    expect(planDayType("Training Day")).toBe("training");
    expect(planDayType("Rest Day")).toBe("non_training");
  });
});

describe("high day resolution", () => {
  const weekDates = [
    "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
    "2026-08-21", "2026-08-22", "2026-08-23",
  ];

  it("lets an exact-date override beat the recurring high day", () => {
    const days = resolveClientWeekDays({
      clientId: "c1",
      weekDates,
      workouts: [],
      recurringHighDays: ["Sunday"],
      highDayOverrides: [{ override_date: "2026-08-19", day_label: "High Day" }],
      defaultFullRestDay: false,
    });
    expect(days.find((d) => d.date === "2026-08-19")!.nutritionDayType).toBe("high");
    expect(days.find((d) => d.date === "2026-08-23")!.nutritionDayType).toBe("non_training");
  });
});

describe("shopping state", () => {
  beforeEach(() => window.localStorage.clear());

  it("is keyed by target + week and writes no nutrition data", () => {
    expect(groceryStateKey("t1", "2026-08-17")).toBe("jfeffect.grocery.checked.v1:t1:2026-08-17");
    writeCheckedIdentities("t1", "2026-08-17", ["mass|oats"]);
    expect(readCheckedIdentities("t1", "2026-08-17")).toEqual(["mass|oats"]);
    expect(readCheckedIdentities("t1", "2026-08-24")).toEqual([]);
    const keys = Array.from(store.keys());
    expect(keys).toEqual(["jfeffect.grocery.checked.v1:t1:2026-08-17"]);
    expect(keys.some((k) => /nutrition|target|log|recipe|macro/i.test(k.replace("jfeffect.grocery", "")))).toBe(false);
    clearCheckedIdentities("t1", "2026-08-17");
    expect(readCheckedIdentities("t1", "2026-08-17")).toEqual([]);
  });
});
