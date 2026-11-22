/**
 * Nutrition accuracy across the pipeline (Nov 18 2026): what a plan's numbers
 * are, where they come from, and that no reading ever changes a saved plan.
 * Devin's stored days are the read-only regression case (fixtures, pinned by
 * md5 in meal-plan-coverage.test.ts); Dwayne's June plan is written the same
 * way his is (slash macros, a Daily Total one macro a line, round calories
 * typed over macros that add up to less).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEVIN_HIGH, DEVIN_REST, DEVIN_TRAINING } from "@/test/fixtures/devin-nov-2026";
import { parseMealPlan } from "@/lib/nutrition-targets/meal-plan-parse";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";
import { coachCoverageLine, dayCoverage, mealsTotal, planDayNumbers, targetMathLine } from "@/lib/nutrition-targets/plan-coverage";
import { foodLineValues, mealMath, mealsOffTheirFoods } from "@/lib/nutrition-targets/food-values";
import { planMealsFromNotes } from "@/lib/food-log-plan";
import { parseMealPlanText, type MealPlanSection } from "@/components/meal-plan-display";
import { mealMacroNumbers } from "@/lib/nutrition-targets/meal-plan-reader";
import { sumMacros } from "@/lib/food-log";
import { generateMealPlanPdf } from "@/lib/nutrition-targets/meal-plan-pdf";

const read = (p: string) => readFileSync(p, "utf8");
const kcal = (p: number, c: number, f: number) => p * 4 + c * 4 + f * 9;

/** Dwayne's training day, as his June plan writes it. */
const DWAYNE_TRAINING = [
  "Meal 1 — Protein Oatmeal and Eggs\n70 g oats\n18 g whey protein\n100 g blueberries\n15 g natural peanut butter\n2 whole eggs\nCinnamon and water as desired\n\nApproximate macros:\n41 g protein / 68 g carbohydrates / 24 g fat",
  "Meal 2 — Chicken and Rice\n100 g cooked chicken breast\n210 g cooked white rice\n100 g broccoli\n10 g olive oil\n\nApproximate macros:\n39 g protein / 66 g carbohydrates / 15 g fat",
  "Meal 3 — Greek Yogurt Training Bowl\n320 g 0% Greek yogurt\n150 g banana\n50 g rice cereal\n18 g honey\n\nApproximate macros:\n37 g protein / 103 g carbohydrates / 2 g fat",
  "Meal 4 — Chicken and Rice\n100 g cooked chicken breast\n210 g cooked white rice\n100 g broccoli\n10 g olive oil\n\nApproximate macros:\n39 g protein / 66 g carbohydrates / 15 g fat",
  "Meal 5 — Beef and Potatoes\n160 g cooked extra-lean ground beef\n300 g cooked potatoes\n100 g green beans\n11 g olive oil\n\nApproximate macros:\n49 g protein / 67 g carbohydrates / 24 g fat",
  "Approximate Daily Total\n205 g protein\n370 g carbohydrates\n80 g fat\nApproximately 3,020 calories from the listed macros",
].join("\n\n");

/** N meals of the same container, each `p / c / f`. */
const day = (n: number, p: number, c: number, f: number) =>
  Array.from({ length: n }, (_, i) => `Meal ${i + 1}\n150 g cooked chicken breast\n200 g cooked white rice\n\nApproximate macros:\n${p} g protein\n${c} g carbohydrates\n${f} g fat`).join("\n\n");

describe("Dwayne: calories typed over macros that add up to less", () => {
  it("his macros add up to 3,020 kcal; the 3,200 saved beside them is named for the coach, never published as its own number", () => {
    const target = { calories: 3200, protein: 205, carbs: 370, fats: 80 };
    expect(kcal(205, 370, 80)).toBe(3020);
    expect(targetMathLine(target)).toBe("Calories say 3,200, but the protein, carbs and fat add up to 3,020");
    // his meals match his macros exactly: the gap is the calorie number, not the food
    expect(mealsTotal(DWAYNE_TRAINING)).toMatchObject({ meals: 5, protein: 205, carbs: 370, fat: 80, kcal: 3020 });
    // against the 3,200 typed beside them, his meals read as short; against what his macros add up to, they cover
    expect(dayCoverage(DWAYNE_TRAINING, target).state).toBe("short");
    expect(dayCoverage(DWAYNE_TRAINING, { ...target, calories: 3020 }).state).toBe("covers");
    // the total's own lines are never read as Meal 5's macros: not in the coach's view, the client's cards or the food log
    expect(structureMealPlanDay(DWAYNE_TRAINING).meals[4].macros).toEqual({ protein: 49, carbs: 67, fat: 24 });
    const cards = parseMealPlanText(DWAYNE_TRAINING).filter((x): x is Extract<MealPlanSection, { kind: "meal" }> => x.kind === "meal");
    expect(cards.map((m) => mealMacroNumbers(m))).toEqual([
      { protein: 41, carbs: 68, fats: 24 },
      { protein: 39, carbs: 66, fats: 15 },
      { protein: 37, carbs: 103, fats: 2 },
      { protein: 39, carbs: 66, fats: 15 },
      { protein: 49, carbs: 67, fats: 24 },
    ]);
    expect(cards[4].items.join(" ")).not.toMatch(/Daily Total|calories/);
    expect(planMealsFromNotes(DWAYNE_TRAINING).map((m) => m.calories)).toEqual([652, 555, 578, 555, 680]);
    // an AI or edited day is never published with calories its macros don't add up to
    expect(planDayNumbers({ calories: null, protein: null, carbs: null, fats: null, fibre: null, notes: "Meal 1\nx" }, target).calories).toBe(3020);
  });

  it("the paste reader reads a Daily Total written one macro a line (it used to read only the protein, so calories were left to be typed)", () => {
    const [d] = parseMealPlan(`TRAINING-DAY MENU\n${DWAYNE_TRAINING}`);
    expect(d).toMatchObject({ protein: 205, carbs: 370, fats: 80, calories: 3020 });
    // "fiber" spelled the American way is a number, never NaN
    const [f] = parseMealPlan("TRAINING DAY MENU\nMeal 1\nx\n\nDaily Total\nApproximately 100 g protein, 200 g carbs, 50 g fat and 30 g fiber");
    expect(f.fibre).toBe(30);
  });

  it("the plan editor shows the gap as the coach types and fixes it only on a tap", () => {
    const editor = read("src/components/nutrition-target-dialog.tsx");
    expect(editor).toContain("<DayNumbersCheck day={d} onUseCalories={(kcal) => updateDay(i, \"calories\", String(kcal))} />");
    expect(editor).toContain("onClick={() => onUseCalories(fromMacros)}");
    expect(editor.match(/onUseCalories\(/g)).toHaveLength(1);
  });
});

describe("meal counts, day types and goals", () => {
  it("3, 4, 5 and 6 meals cover the same day; one meal missing is named", () => {
    for (const n of [3, 4, 5, 6]) {
      const per = { p: Math.round(180 / n), c: Math.round(300 / n), f: Math.round(70 / n) };
      const target = { calories: 2550, protein: 180, carbs: 300, fats: 70 };
      expect(dayCoverage(day(n, per.p, per.c, per.f), target).state, `${n} meals`).toBe("covers");
      expect(dayCoverage(day(n - 1, per.p, per.c, per.f), target).state, `${n - 1} of ${n}`).toBe("short");
    }
  });

  it("the same meals read against a training and a rest day's targets", () => {
    const meals = day(4, 45, 75, 18);
    expect(dayCoverage(meals, { calories: 2562, protein: 180 }).state).toBe("covers");
    expect(dayCoverage(meals, { calories: 2200, protein: 180 }).state).toBe("over");
  });

  it("fat loss, muscle gain, maintenance and performance: the tolerance is the day's own 5%, whatever the goal", () => {
    const goals = { fatLoss: [1800, 170, 160, 50], muscleGain: [3400, 190, 450, 95], maintenance: [2600, 160, 320, 75], performance: [3100, 170, 430, 75] } as const;
    for (const [goal, [k, p, c, f]] of Object.entries(goals)) {
      const target = { calories: k, protein: p, carbs: c, fats: f };
      const onTarget = day(4, p / 4, c / 4, f / 4);
      expect(dayCoverage(onTarget, target).state, goal).toBe("covers");
      // 10% under on carbs and fat, protein kept: short by more than 5%
      const under = day(4, p / 4, (c * 0.85) / 4, (f * 0.85) / 4);
      expect(dayCoverage(under, target).state, goal).toBe("short");
    }
  });

  it("a target change with the meals unchanged reads straight away (an outdated plan is named)", () => {
    const meals = day(3, 60, 100, 23);
    expect(dayCoverage(meals, { calories: 2547, protein: 180 }).state).toBe("covers");
    expect(coachCoverageLine(dayCoverage(meals, { calories: 2900, protein: 200 }))).toBe(
      "The meals add up to 2,541 of 2,900 kcal (180 of 200 g protein): 359 kcal short",
    );
  });
});

describe("food values: raw and cooked, units, substitutions, rounding", () => {
  const v = (l: string) => foodLineValues(l) as { kcal: number; protein: number; carbs: number; fat: number };

  it("raw and cooked weights are different foods", () => {
    expect(Math.round(v("180 g cooked chicken breast").kcal)).toBe(297);
    expect(Math.round(v("180 g raw chicken breast").kcal)).toBe(216);
    expect(Math.round(v("100 g cooked white rice").kcal)).toBe(130);
    expect(Math.round(v("100 g dry white rice").kcal)).toBe(365);
    expect(Math.round(v("100 g uncooked basmati rice").kcal)).toBe(365);
    expect(Math.round(v("100 g pasta (dry)").kcal)).toBe(371);
    // oats are written dry; a cooked oatmeal weight isn't judged
    expect(Math.round(v("80 g oats").kcal)).toBe(303);
    expect(foodLineValues("250 g cooked oatmeal")).toBeNull();
  });

  it("counted units and household measures resolve to grams; what can't be pinned down isn't guessed", () => {
    expect(Math.round(v("2 whole eggs").kcal)).toBe(143);
    expect(Math.round(v("1 medium banana").kcal)).toBe(105);
    expect(Math.round(v("½ bagel").kcal)).toBe(129);
    expect(Math.round(v("1 scoop whey protein (about 30 g)").protein)).toBe(24);
    expect(Math.round(v("1 tbsp olive oil").kcal)).toBe(119);
    expect(Math.round(v("10 g olive oil").fat)).toBe(10);
    expect(foodLineValues("1 cup rice")).toBeNull();
    expect(foodLineValues("vegetables")).toBeNull();
    expect(foodLineValues("salt and pepper to taste")).toBe("free");
  });

  it("lean ground beef by its lean %, a swap keeps a meal on its numbers", () => {
    expect(Math.round(v("100 g cooked 95% lean ground beef").fat)).toBe(7);
    expect(Math.round(v("100 g cooked 85/15 ground beef").fat)).toBe(15);
    expect(Math.round(v("100 g cooked extra-lean ground beef").kcal)).toBe(185);
    // the plan's own Swap line: 100 g cooked chicken breast = 130 g cooked white fish (protein within a few grams)
    expect(Math.abs(v("100 g cooked chicken breast").protein - v("130 g cooked cod").protein)).toBeLessThan(2);
  });

  it("food-table rounding never reads as a mislabelled meal (USDA kcal vs 4 / 4 / 9 of rounded label macros)", () => {
    const meal = "Meal 1\n250 g cooked white rice\n180 g cooked chicken breast\n\nApproximate macros:\n63 g protein\n71 g carbohydrates\n7 g fat";
    expect(mealsOffTheirFoods(meal)).toEqual([]);
    const off = "Meal 1\n250 g cooked white rice\n180 g cooked chicken breast\n\nApproximate macros:\n45 g protein\n50 g carbohydrates\n5 g fat";
    expect(mealsOffTheirFoods(off).map((c) => c.title)).toEqual(["Meal 1"]);
  });

  it("an amount that can't be right is named; the coach's math lists every meal written and by its foods", () => {
    const typo = "Meal 1\n3500 g cooked white rice\n180 g cooked chicken breast\n\nApproximate macros:\n60 g protein\n100 g carbohydrates\n8 g fat";
    expect(mealMath(typo)[0].odd).toEqual(["3500 g cooked white rice"]);
    const math = mealMath(DEVIN_HIGH);
    expect(math.map((m) => [m.title, Math.round(m.stated!.kcal), m.worked ? Math.round(m.worked.kcal) : null])).toEqual([
      ["Meal 1", 602, 662],
      ["Meal 2", 635, 740],
      ["Meal 3", 859, null],
    ]);
    expect(math[2].unread[0]).toMatch(/^Your choice/);
  });
});

describe("Devin's stored plan, read (never written)", () => {
  it("his days as written and by their foods (the numbers in the coach's report)", () => {
    const totals = [DEVIN_TRAINING, DEVIN_REST, DEVIN_HIGH].map((n) => mealsTotal(n)!);
    expect(totals.map((t) => [t.kcal, t.protein, t.carbs, t.fat, t.fibre])).toEqual([
      [1854, 150, 210, 46, 19],
      [1872, 150, 183, 60, 16],
      [2096, 155, 270, 44, 18],
    ]);
    const byFoods = (n: string) =>
      mealMath(n).reduce((a, m) => a + (m.worked?.kcal ?? m.stated!.kcal), 0);
    expect(Math.round(byFoods(DEVIN_TRAINING))).toBe(2054);
    expect(Math.round(byFoods(DEVIN_REST))).toBe(2056);
    expect(Math.round(byFoods(DEVIN_HIGH))).toBe(2261);
  });

  it("targets set to his meals' own totals would read as covering, with nothing for the coach to flag on coverage", () => {
    for (const [notes, t] of [
      [DEVIN_TRAINING, { calories: 1854, protein: 150, carbs: 210, fats: 46 }],
      [DEVIN_REST, { calories: 1872, protein: 150, carbs: 183, fats: 60 }],
      [DEVIN_HIGH, { calories: 2096, protein: 155, carbs: 270, fats: 44 }],
    ] as const) {
      expect(dayCoverage(notes, t).state).toBe("covers");
      expect(targetMathLine(t)).toBeNull();
    }
  });
});

describe("food logging: what was eaten, never what was prescribed", () => {
  it("a plan meal logs exactly what its card says, and only when tapped (the log sums what was logged)", () => {
    const meals = planMealsFromNotes(DEVIN_TRAINING);
    expect(meals.map((m) => m.calories)).toEqual([480, 672, 702]);
    // his six logged entries (Nov 16-17) as stored: the day's total is what was logged
    const logged = [
      { calories: 480, protein_g: "45", carbs_g: "30", fat_g: "20" },
      { calories: 672, protein_g: "55", carbs_g: "95", fat_g: "8" },
      { calories: 702, protein_g: "50", carbs_g: "85", fat_g: "18" },
    ];
    expect(sumMacros(logged)).toEqual({ calories: 1854, protein: 150, carbs: 210, fat: 46 });
    expect(sumMacros([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    // the food log never reads a plan as eaten
    const panel = read("src/components/nutrition/DailyNutritionPanel.tsx");
    expect(panel).not.toMatch(/planMealsFromNotes\([^)]*\)\.reduce/);
  });
});

describe("the PDF reads meals the same way as every screen", () => {
  it("one-line macros print as the meal's macros, never as a food; the day's targets print as saved", () => {
    const doc = generateMealPlanPdf({
      client_name: "Test",
      days: [
        { day_label: "Training Day", calories: 2041, protein: 156, carbs: 235, fats: 53, notes: "Meal 1\n60 g oats\n1 medium banana\n\nApproximate macros:\n36 g protein, 65 g carbohydrates, 12 g fat and 9 g fibre" },
        { day_label: "Devin Training Day", calories: 2579, protein: 180, carbs: 305, fats: 71, notes: DEVIN_TRAINING },
      ],
    });
    const pdf = doc.output();
    // the meal's title line carries its macros and the calories they make (36·4 + 65·4 + 12·9)
    expect(pdf).toContain("P 36 g");
    expect(pdf).toContain("512 kcal");
    expect(pdf).not.toContain("protein, 65 g carbohydrates");
    expect(pdf).toContain("2,579");
    // a Daily Total line in the meal text is never printed as a meal or a food
    expect(pdf).not.toContain("Approximately 180 g protein");
    expect(structureMealPlanDay(DEVIN_TRAINING).meals).toHaveLength(3);
  });
});
