import { describe, expect, it } from "vitest";
import { applyWorkoutMealPick, autoLabelPlan, isTrainingDayLabel, suggestWorkoutMeals } from "@/lib/nutrition-targets/workout-meal-suggest";
import { listMealHeaders } from "@/lib/nutrition-targets/meal-timing";

const meal = (n: number, foods: string[], p: number, c: number, f: number) =>
  [`Meal ${n}`, ...foods, "Approximate macros:", `${p} g protein`, `${c} g carbohydrates`, `${f} g fat`, "5 g fibre"].join("\n");

// Shape of a real 5-meal plan: breakfast, lunch, bagel snack, dinner, evening cereal.
const FIVE = [
  meal(1, ["80 g oatmeal", "210 g Greek yogurt"], 38, 94, 16),
  meal(2, ["120 g chicken breast", "250 g white rice"], 46, 78, 20),
  meal(3, ["120 g plain bagel", "30 g jam", "120 g banana"], 18, 111, 13),
  meal(4, ["100 g extra lean beef", "250 g white rice"], 35, 78, 24),
  meal(5, ["55 g cereal", "250 g 2% milk"], 13, 72, 6),
  "Daily Total",
  "Approximately 150 g protein, 433 g carbohydrates, 79 g fat and 32 g fibre",
].join("\n");
// Shape of a real 4-meal plan.
const FOUR = [
  meal(1, ["30 g oatmeal", "20 g whey protein isolate"], 31, 49, 8),
  meal(2, ["90 g chicken breast", "150 g white rice"], 32, 48, 13),
  meal(3, ["300 g chicken noodle soup", "60 g bread"], 18, 60, 8),
  meal(4, ["80 g extra lean beef", "200 g potato"], 28, 42, 17),
].join("\n");

const tags = (t: string) => listMealHeaders(t).map((h) => h.timing);

describe("suggestWorkoutMeals", () => {
  it("evening lifter: snack-before-dinner is Pre, dinner is Post, evening snack stays plain", () => {
    expect(suggestWorkoutMeals(FIVE, "evening")).toEqual({ pre: 2, post: 3 });
    expect(suggestWorkoutMeals(FOUR, "evening")).toEqual({ pre: 2, post: 3 });
  });

  it("places by training time", () => {
    expect(suggestWorkoutMeals(FIVE, "morning")).toEqual({ pre: 0, post: 1 });
    expect(suggestWorkoutMeals(FIVE, "midday")).toEqual({ pre: 1, post: 2 });
    expect(suggestWorkoutMeals(FIVE, "afternoon")).toEqual({ pre: 2, post: 3 });
    expect(suggestWorkoutMeals(FIVE, "night")).toEqual({ pre: 3, post: 4 });
    expect(suggestWorkoutMeals(FIVE, "early")).toEqual({ pre: null, post: 0 }); // full breakfast → post only
  });

  it("early riser with a small carb snack first: snack Pre, breakfast Post", () => {
    const plan = [meal(1, ["1 banana", "20 g whey"], 18, 30, 1), meal(2, ["3 eggs", "80 g oats"], 35, 60, 15), meal(3, ["chicken"], 40, 50, 10)].join("\n");
    expect(suggestWorkoutMeals(plan, "early")).toEqual({ pre: 0, post: 1 });
  });

  it("needs at least two meals", () => {
    expect(suggestWorkoutMeals("Meal 1\n100 g oats", "evening")).toEqual({ pre: null, post: null });
  });
});

describe("autoLabelPlan", () => {
  it("only renames meal header lines and skips rest days", () => {
    const { days, labelled } = autoLabelPlan(
      [
        { day_label: "Training Day", notes: FIVE },
        { day_label: "Non-Training Day", notes: FIVE },
        { day_label: "High Day", notes: FIVE },
      ],
      "evening",
    );
    expect(labelled.map((l) => l.day)).toEqual(["Training Day", "High Day"]);
    expect(tags(days[0].notes!)).toEqual([null, null, "pre", "post", null]);
    expect(days[1].notes).toBe(FIVE);
    const before = FIVE.split("\n");
    const after = days[0].notes!.split("\n");
    expect(after).toHaveLength(before.length);
    expect(before.filter((l, i) => l !== after[i])).toEqual(["Meal 3", "Meal 4"]);
  });

  it("re-labelling moves the tags instead of stacking them", () => {
    const evening = applyWorkoutMealPick(FIVE, suggestWorkoutMeals(FIVE, "evening"));
    const morning = applyWorkoutMealPick(evening, suggestWorkoutMeals(evening, "morning"));
    expect(tags(morning)).toEqual(["pre", "post", null, null, null]);
  });

  it("knows rest days", () => {
    expect(isTrainingDayLabel("Training Day")).toBe(true);
    expect(isTrainingDayLabel("High Day")).toBe(true);
    expect(isTrainingDayLabel("Every Day")).toBe(true);
    expect(isTrainingDayLabel("Non-Training Day")).toBe(false);
    expect(isTrainingDayLabel("Rest Day")).toBe(false);
  });
});
