/**
 * A plan presented as a complete day has to be one: Devin Buth's Nov 11 plan
 * (targets 2,579 kcal, 180 / 305 / 71) had three meals that add up to 1,854
 * kcal (150 / 210 / 46) under a Daily Total line that copied the targets. These
 * are his stored days, word for word, and the other ways macros are written in
 * live plans (Marc's one line, Dwayne's slashes, Vicky's P / C / F).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { macroKcal, readMacroLine } from "@/lib/nutrition-targets/macro-line";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";
import { parseMealPlanText, type MealPlanSection } from "@/components/meal-plan-display";
import { mealMacroNumbers } from "@/lib/nutrition-targets/meal-plan-reader";
import { planMealsFromNotes } from "@/lib/food-log-plan";
import {
  BRING_MEALS_TO_TARGETS,
  coachCoverageLine,
  dayCoverage,
  flexibleKcal,
  mealsTotal,
  planDayNumbers,
  targetMathLine,
  withHonestTotals,
} from "@/lib/nutrition-targets/plan-coverage";
import { foodLineValues, mealFoodShort, mealsOffTheirFoods } from "@/lib/nutrition-targets/food-values";
import { aiTargetFor, parseAiTargets, planTotalsIssues } from "@/lib/nutrition-targets/nutrition-intel";
import { parseMealPlan } from "@/lib/nutrition-targets/meal-plan-parse";
import { planAsMealPlanText, readEditedPlan, type PlanEditPlan } from "@/lib/nutrition-targets/plan-edit";
import { withPrepFix } from "@/lib/nutrition-ai-plans.server";
import { REVISE_MAX_CHARS } from "@/lib/nutrition-ai-prompts";

import { createHash } from "node:crypto";
import {
  ALIGNED_PLAN_TEXT,
  DEVIN_AI_TARGETS,
  DEVIN_HIGH,
  DEVIN_PLAN_TEXT,
  DEVIN_REST,
  DEVIN_TRAINING,
  STORED_MD5,
} from "@/test/fixtures/devin-nov-2026";
import { prepDrift, planMenus } from "@/lib/nutrition-targets/plan-foods";

const read = (p: string) => readFileSync(p, "utf8");
const md5 = (t: string) => createHash("md5").update(t).digest("hex");
type MealSection = Extract<MealPlanSection, { kind: "meal" }>;
const mealsOf = (text: string) => parseMealPlanText(text).filter((s): s is MealSection => s.kind === "meal");

/** His published days. */
const T = { calories: 2579, protein: 180, carbs: 305, fats: 71 };
const R = { calories: 2302, protein: 180, carbs: 238, fats: 70 };
const H = { calories: 2751, protein: 185, carbs: 325, fats: 79 };

const MARC =
  "Meal 1\n60 g oats\n1 scoop whey protein (about 30 g)\n1 medium banana\n15 g peanut butter\n\nApproximate macros:\n36 g protein, 65 g carbohydrates, 12 g fat and 9 g fibre\n\nMeal 2 (Pre-Workout)\n140 g cooked chicken breast\n280 g cooked white rice\n10 g olive oil\n\nApproximate macros:\n45 g protein, 80 g carbohydrates, 14 g fat and 3 g fibre\n\nDaily Total\nApproximately 81 g protein, 145 g carbohydrates, 26 g fat and 12 g fibre";
const DWAYNE =
  "Meal 1 — Protein Oatmeal and Eggs\n70 g oats\n18 g whey protein\n2 whole eggs\nCinnamon and water as desired\n\nApproximate macros:\n41 g protein / 68 g carbohydrates / 24 g fat\n\nMeal 2 — Chicken and Rice\n100 g cooked chicken breast\n210 g cooked white rice\n\nApproximate macros:\n39 g protein / 66 g carbohydrates / 15 g fat";
const VICKY =
  "Meal 1\n120g oats\n300ml egg whites\n\nApprox:\n\n50P\n115C\n22F\nMeal 2\n220g cooked chicken breast\n400g cooked jasmine rice\n\nApprox:\n\n60P\n115C\n18F";

describe("Devin's saved plan is a read-only regression case", () => {
  it("the copies here are his stored days, byte for byte (md5 as read from production on Nov 18)", () => {
    expect(md5(DEVIN_TRAINING)).toBe(STORED_MD5.training);
    expect(md5(DEVIN_REST)).toBe(STORED_MD5.rest);
    expect(md5(DEVIN_HIGH)).toBe(STORED_MD5.high);
  });

  it("reading a plan never changes it: the coverage, macro and food readers are pure and hold no database client", () => {
    const before = DEVIN_TRAINING;
    dayCoverage(DEVIN_TRAINING, T);
    withHonestTotals(DEVIN_PLAN_TEXT);
    mealsOffTheirFoods(DEVIN_TRAINING);
    expect(DEVIN_TRAINING).toBe(before);
    for (const f of ["src/lib/nutrition-targets/plan-coverage.ts", "src/lib/nutrition-targets/food-values.ts", "src/lib/nutrition-targets/macro-line.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/supabase|\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
    }
    // the coach's fix is a prefill of Change it with AI: nothing is sent or applied without the coach
    expect(read("src/lib/weight-management/handoff.ts")).toContain("never applied on its own");
  });
});

describe("a regeneration for Devin's targets comes out aligned", () => {
  const targets = parseAiTargets(DEVIN_AI_TARGETS);

  it("his kind of short plan goes back with the gap; an aligned answer is kept with honest totals", async () => {
    const prompts: string[] = [];
    const out = await withPrepFix(DEVIN_PLAN_TEXT, "CLIENT DETAILS", async (p) => {
      prompts.push(p);
      return ALIGNED_PLAN_TEXT;
    }, targets);
    // one round: the answer's Daily Totals (the targets copied in again) are the code's to write
    expect(prompts).toHaveLength(1);
    expect(out).toBe(ALIGNED_PLAN_TEXT);
    const saved = withHonestTotals(out);
    expect(saved).toContain("TRAINING-DAY MENU");
    expect(saved).toContain("Daily Total\nApproximately 192 g protein, 292 g carbohydrates, 64 g fat and 14 g fibre");
    expect(saved).not.toContain("Approximately 180 g protein, 300 g carbohydrates");
    expect(planTotalsIssues(saved, targets)).toEqual([]);
    expect(prepDrift(planMenus(saved))).toEqual([]);
    for (const m of planMenus(saved)) expect(mealsOffTheirFoods(m.notes), m.label).toEqual([]);
    // every day covers its targets, and publishes what the meals give (within 5% of the AI's targets)
    const days = parseMealPlan(saved).map((d) => {
      const t = aiTargetFor(targets, d.day_label)!;
      const c = dayCoverage(d.notes, t);
      const n = planDayNumbers({ calories: d.calories ?? null, protein: d.protein ?? null, carbs: d.carbs ?? null, fats: d.fats ?? null, fibre: d.fibre ?? null, notes: d.notes }, t);
      return [d.day_label, c.state, n.calories, n.protein, t.calories];
    });
    expect(days).toEqual([
      ["Training Day", "covers", 2512, 192, 2550],
      ["Non-Training Day", "covers", 2308, 189, 2300],
      ["High Day", "covers", 2697, 183, 2750],
    ]);
    expect(coachCoverageLine(dayCoverage(parseMealPlan(saved)[0].notes, { calories: 2512, protein: 192 }))).toBeNull();
  });

  it("a model that never closes the gap: the plan is never presented as complete, and its targets aren't lowered", async () => {
    const out = await withPrepFix(DEVIN_PLAN_TEXT, "x", async () => DEVIN_PLAN_TEXT, targets);
    const saved = withHonestTotals(out);
    const training = parseMealPlan(saved)[0];
    // the code writes the real total; the published numbers stay the targets
    expect(training).toMatchObject({ calories: 1854, protein: 150 });
    const n = planDayNumbers({ calories: training.calories ?? null, protein: training.protein ?? null, carbs: training.carbs ?? null, fats: training.fats ?? null, fibre: null, notes: training.notes }, aiTargetFor(targets, "Training Day"));
    expect(n).toMatchObject({ calories: 2550, protein: 180, carbs: 300, fats: 70 });
    const c = dayCoverage(training.notes, { calories: n.calories, protein: n.protein });
    expect(coachCoverageLine(c)).toBe("The meals add up to 1,854 of 2,550 kcal (150 of 180 g protein): 696 kcal short");
  });
});

describe("one reading of a meal's macro line, however it's written", () => {
  it("one a line, several on one, slashes, P / C / F, and never a food", () => {
    expect(readMacroLine("45 g protein")).toEqual({ protein: 45 });
    expect(readMacroLine("36 g protein, 65 g carbohydrates, 12 g fat and 9 g fibre")).toEqual({ protein: 36, carbs: 65, fat: 12, fibre: 9 });
    expect(readMacroLine("41 g protein / 68 g carbohydrates / 24 g fat")).toEqual({ protein: 41, carbs: 68, fat: 24 });
    expect(readMacroLine("Approx: 40P / 60C / 8F")).toEqual({ protein: 40, carbs: 60, fat: 8 });
    expect(readMacroLine("Approximately 180 g protein, 305 g carbohydrates, 71 g fat and 24 g fibre")).toEqual({ protein: 180, carbs: 305, fat: 71, fibre: 24 });
    expect(readMacroLine("50P")).toEqual({ protein: 50 });
    for (const food of ["30 g protein powder", "250 g Protein milk (skim)", "1 scoop whey protein (about 30 g)", "1 C cooked rice", "2 PB&J", "150 g egg whites"])
      expect(readMacroLine(food), food).toBeNull();
  });

  it("the client's meal cards, the coach's plan view and the food log read every format the same", () => {
    for (const [name, text, want] of [
      ["marc", MARC, [[36, 65, 12], [45, 80, 14]]],
      ["dwayne", DWAYNE, [[41, 68, 24], [39, 66, 15]]],
      ["vicky", VICKY, [[50, 115, 22], [60, 115, 18]]],
      ["devin", DEVIN_TRAINING, [[45, 30, 20], [55, 95, 8], [50, 85, 18]]],
    ] as const) {
      const client = mealsOf(text).map((m) => mealMacroNumbers(m));
      expect(client.map((m) => [m?.protein, m?.carbs, m?.fats]), name).toEqual(want);
      const coach = structureMealPlanDay(text).meals.map((m) => m.macros);
      expect(coach.map((m) => [m?.protein, m?.carbs, m?.fat]), name).toEqual(want);
      expect(planMealsFromNotes(text).map((m) => [m.protein_g, m.carbs_g, m.fat_g]), name).toEqual(want);
    }
    // the macro line is never shown as a food on the client's card
    expect(mealsOf(MARC)[0].items).toEqual(["60 g oats", "1 scoop whey protein (about 30 g)", "1 medium banana", "15 g peanut butter"]);
    expect(structureMealPlanDay(MARC).meals[0].foods.map((f) => f.name)).not.toContain("protein, 65 g carbohydrates, 12 g fat and 9 g fibre");
  });
});

describe("Devin's plan: the meals are read, never the Daily Total line", () => {
  it("his meals add up to 1,854 / 1,872 / 2,096 kcal against 2,579 / 2,302 / 2,751", () => {
    expect(mealsTotal(DEVIN_TRAINING)).toMatchObject({ meals: 3, kcal: 1854, protein: 150, carbs: 210, fat: 46, fibre: 19 });
    const t = dayCoverage(DEVIN_TRAINING, T);
    expect(t).toMatchObject({ state: "short", target: 2579, gap: 725, proteinGap: 30 });
    expect(dayCoverage(DEVIN_REST, R)).toMatchObject({ state: "short", gap: 430 });
    expect(dayCoverage(DEVIN_HIGH, H)).toMatchObject({ state: "short", gap: 655 });
    expect(coachCoverageLine(t)).toBe("The meals add up to 1,854 of 2,579 kcal (150 of 180 g protein): 725 kcal short");
  });

  it("the generator's check names the gap even though the Daily Total copies the targets", () => {
    const issues = planTotalsIssues(DEVIN_PLAN_TEXT, parseAiTargets(DEVIN_AI_TARGETS));
    expect(issues).toContain("Training Day: the meals add to 150 g protein, 210 g carbs, 46 g fat, but its Daily Total says 180 / 305 / 71");
    expect(issues).toContain("Training Day: the meals add to 1854 kcal and 150 g protein against a target of 2550 kcal and 180 g protein");
    expect(issues).toContain("Non Training Day: the meals add to 1872 kcal and 150 g protein against a target of 2300 kcal and 180 g protein");
  });

  it("published numbers are the targets when the meals fall short (never the meals' 1,854)", () => {
    const targets = parseAiTargets(DEVIN_AI_TARGETS);
    const days = parseMealPlan(DEVIN_PLAN_TEXT).map((d) => ({
      label: d.day_label,
      ...planDayNumbers({ calories: d.calories ?? null, protein: d.protein ?? null, carbs: d.carbs ?? null, fats: d.fats ?? null, fibre: d.fibre ?? null, notes: d.notes }, aiTargetFor(targets, d.day_label)),
    }));
    expect(days.map((d) => [d.label, d.calories, d.protein, d.carbs, d.fats])).toEqual([
      // calories are the targets' macros at 4 / 4 / 9: the AI listed 2,300 and 2,750 over macros of 2,290 and 2,760
      ["Training Day", 2550, 180, 300, 70],
      ["Non-Training Day", 2290, 180, 235, 70],
      ["High Day", 2760, 180, 330, 80],
    ]);
    // meals that cover their targets publish their own numbers, so the client's ring is exactly what they eat
    const covering = "Meal 1\n150 g cooked chicken breast\n\nApproximate macros:\n50 g protein\n150 g carbohydrates\n30 g fat\n\nMeal 2\nx\n\nApproximate macros:\n50 g protein\n150 g carbohydrates\n30 g fat";
    // two meals of 50 / 150 / 30 = 2,140 kcal, within 5% of 2,200
    expect(planDayNumbers({ calories: 2600, protein: 100, carbs: 300, fats: 60, fibre: null, notes: covering }, { calories: 2200, protein: 100, carbs: 310, fats: 62 })).toMatchObject({ calories: 2140, protein: 100, carbs: 300, fats: 60 });
    // no targets to read: the day's own numbers, as before
    expect(planDayNumbers({ calories: 2000, protein: 150, carbs: 200, fats: 60, fibre: 20, notes: covering }, null)).toMatchObject({ calories: 2000 });
  });

  it("a Daily Total is always what its meals add up to (and only when they all say their macros)", () => {
    const honest = withHonestTotals(DEVIN_PLAN_TEXT);
    expect(honest).toContain("Daily Total\nApproximately 150 g protein, 210 g carbohydrates, 46 g fat and 19 g fibre");
    expect(honest).toContain("Daily Total\nApproximately 150 g protein, 183 g carbohydrates, 60 g fat and 16 g fibre");
    expect(honest).toContain("Daily Total\nApproximately 155 g protein, 270 g carbohydrates, 44 g fat and 18 g fibre");
    expect(withHonestTotals(honest)).toBe(honest);
    expect(honest).toContain("FOOD-WEIGHING RULES\n1. Weigh all meat");
    // a menu with no Daily Total gets one; a menu whose meals don't all say their macros keeps its own line
    const noTotal = "TRAINING-DAY MENU\nMeal 1\nx\n\nApproximate macros:\n40 g protein\n50 g carbs\n10 g fat\n";
    expect(withHonestTotals(noTotal)).toContain("Daily Total\nApproximately 40 g protein, 50 g carbohydrates, 10 g fat");
    const unread = "TRAINING-DAY MENU\nMeal 1\n150 g chicken\nMeal 2\nx\n\nApproximate macros:\n40 g protein\n50 g carbs\n10 g fat\n\nDaily Total\nApproximately 999 g protein";
    expect(withHonestTotals(unread)).toBe(unread);
  });

  it("the macros written on a meal are checked against its foods (Meal 3: 702 written, about 830 by its foods)", () => {
    const off = mealsOffTheirFoods(DEVIN_TRAINING);
    expect(off.map((c) => c.title)).toEqual(["Meal 3"]);
    expect(Math.round(off[0].worked.kcal)).toBeGreaterThan(800);
    expect(Math.round(off[0].worked.kcal)).toBeLessThan(860);
    expect(mealFoodShort(off[0])).toMatch(/^Meal 3's foods come to about 8\d\d kcal and 5\d g protein, not the 702 kcal and 50 g its macros say$/);
    // the free meal, and anything that isn't a plain staple, is never judged
    expect(mealsOffTheirFoods(DEVIN_HIGH).map((c) => c.title)).not.toContain("Meal 3");
    expect(foodLineValues("Your choice: burger + fries")).toBeNull();
    expect(foodLineValues("Cinnamon and water as desired")).toBe("free");
  });

  it("no false alarms on live plans whose macros are right (Ashley, Colten, Jared)", () => {
    const ashley = "Meal 2\n150 g chicken breast\n70 g jasmine rice\n180 g broccoli\n12 g olive oil\nApproximate macros:\n53 g protein\n33 g carbohydrates\n18 g fat\n6 g fibre\nMeal 3\n140 g salmon\n80 g potatoes\n190 g green beans\n80 g avocado\n8 g olive oil\nApproximate macros:\n38 g protein\n36 g carbohydrates\n37 g fat\n13 g fibre";
    const colten = "Meal 1\n70 g oats\n35 g whey protein\n100 g blueberries\n20 g peanut butter\nApproximate macros:\n45 g protein\n68 g carbohydrates\n17 g fat\nMeal 3\n300 g 0% Greek yogurt\n100 g banana\n35 g rice cereal\n15 g peanut butter\nApproximate macros:\n38 g protein\n67 g carbohydrates\n9 g fat\nMeal 4\n180 g lean ground beef\n250 g potatoes\n150 g green beans\n10 g olive oil\nApproximate macros:\n55 g protein\n62 g carbohydrates\n25 g fat";
    const jared = "Meal 1 (Pre-Workout)\n1 scoop whey protein (about 30 g)\n1 medium banana\n1 bagel (about 100 g)\nApproximate macros:\n31 g protein\n75 g carbohydrates\n2 g fat\nMeal 3\n160 g cooked 93% lean ground beef\n150 g cooked sweet potato\n100 g cooked broccoli\n10 g olive oil\nApproximate macros:\n43 g protein\n34 g carbohydrates\n22 g fat\nMeal 4\n150 g cooked chicken breast\n100 g cooked green beans\n15 g peanut butter\nApproximate macros:\n43 g protein\n6 g carbohydrates\n18 g fat";
    expect(mealsOffTheirFoods(ashley)).toEqual([]);
    expect(mealsOffTheirFoods(colten)).toEqual([]);
    expect(mealsOffTheirFoods(jared)).toEqual([]);
  });

  it("the generator's fix gets the gap and the mislabelled meal, and is kept only when it's better", async () => {
    const prompts: string[] = [];
    const out = await withPrepFix(DEVIN_PLAN_TEXT, "CLIENT DETAILS", async (p) => {
      prompts.push(p);
      return "Sorry";
    }, parseAiTargets(DEVIN_AI_TARGETS));
    expect(out).toBe(DEVIN_PLAN_TEXT);
    expect(prompts[0]).toContain("FIX THE TOTALS");
    expect(prompts[0]).toContain("- Training Day: the meals add to 1854 kcal and 150 g protein against a target of 2550 kcal and 180 g protein");
    expect(prompts[0]).toContain("FIX THE MACROS");
    expect(prompts[0]).toContain("- Training Day Meal 3: its foods (180 g cooked lean ground beef (90% lean), 450 g cooked potatoes, 150 g green beans) come to about");
  });
});

describe("flexible calories, other meal counts and the day types", () => {
  it("a coach's Flexible calories section counts toward the day and stands on its own", () => {
    const notes = `${DEVIN_TRAINING.replace(/\n\nDaily Total[\s\S]*$/, "")}\n\nFlexible calories\n725 kcal a day for anything you like. Keep it to one meal or snack and hit your protein first.`;
    expect(flexibleKcal(notes)).toBe(725);
    const c = dayCoverage(notes, T);
    expect(c).toMatchObject({ flexible: 725, gap: 0 });
    // the meals still owe 30 g of protein, so it's protein the client is told about
    expect(c.state).toBe("short");
    expect(coachCoverageLine(c)).toBe("The meals have 150 of 180 g protein");
    const leaner = dayCoverage(notes, { calories: 2579, protein: 155 });
    expect(leaner.state).toBe("covers");
    expect(coachCoverageLine(leaner)).toBeNull();
    // never a food in Meal 3, on either side
    expect(structureMealPlanDay(notes).meals[2].notes).toEqual([]);
    expect(structureMealPlanDay(notes).notes[0]).toBe("Flexible calories");
    const sections = parseMealPlanText(notes);
    expect(sections.at(-1)).toEqual({ kind: "other", items: ["Flexible calories", "725 kcal a day for anything you like. Keep it to one meal or snack and hit your protein first."] });
  });

  it("five meals that cover their day read as covering; a day over its target says so", () => {
    const meal = (n: number) => `Meal ${n}\n150 g cooked chicken breast\n200 g cooked white rice\n\nApproximate macros:\n40 g protein\n60 g carbohydrates\n12 g fat\n`;
    const five = [1, 2, 3, 4, 5].map(meal).join("\n");
    expect(dayCoverage(five, { calories: 2560, protein: 200 })).toMatchObject({ state: "covers", meals: { meals: 5, kcal: 2540 } });
    const over = dayCoverage(five, { calories: 2000, protein: 150 });
    expect(over.state).toBe("over");
    expect(coachCoverageLine(over)).toBe("The meals add up to 2,540 of 2,000 kcal: 540 over");
    // no target or meals without macros: nothing is claimed
    expect(dayCoverage(five, null).state).toBe("unknown");
    expect(dayCoverage("Meal 1\n150 g chicken", { calories: 2000 }).state).toBe("unknown");
  });

  it("calories that aren't what the day's own macros add up to are named (Dwayne's 3,200 vs 3,020)", () => {
    expect(targetMathLine({ calories: 3200, protein: 205, carbs: 370, fats: 80 })).toBe("Calories say 3,200, but the protein, carbs and fat add up to 3,020");
    expect(targetMathLine(T)).toBeNull();
    expect(macroKcal({ protein: 180, carbs: 305, fat: 71 })).toBe(2579);
  });
});

describe("Change it with AI reads the plan honestly and never lowers a day's targets", () => {
  const plan: PlanEditPlan = {
    phase: "Recomp",
    nutrition_target_days: [
      { day_label: "Training Day", calories: 2579, protein: 180, carbs: 305, fats: 71, fibre: 24, notes: DEVIN_TRAINING, sort_order: 0 },
      { day_label: "Non-Training Day", calories: 2302, protein: 180, carbs: 238, fats: 70, fibre: 21, notes: DEVIN_REST, sort_order: 1 },
      { day_label: "High Day", calories: 2751, protein: 185, carbs: 325, fats: 79, fibre: 23, notes: DEVIN_HIGH, sort_order: 2 },
    ],
  };
  const planTargets =
    "CALORIE TARGETS\nTraining Day: 2579\nNon-Training Day: 2302\nHigh Day: 2751\n\nMACRO TARGETS\n\nTraining Day\nProtein: 180\nCarbs: 305\nFats: 71\n\nNon-Training Day\nProtein: 180\nCarbs: 238\nFats: 70\n\nHigh Day\nProtein: 185\nCarbs: 325\nFats: 79";

  it("the AI sees the meals' real Daily Total, not the targets copied in", () => {
    const text = planAsMealPlanText(plan);
    expect(text).toContain("TRAINING DAY MENU\n\nMeal 1");
    expect(text).toContain("Daily Total\nApproximately 150 g protein, 210 g carbohydrates, 46 g fat and 19 g fibre");
    expect(text).not.toContain("Approximately 180 g protein, 305 g carbohydrates");
  });

  it("an answer whose meals still fall short keeps the targets; one that covers them uses its meals", () => {
    const stillShort = readEditedPlan(plan, planAsMealPlanText(plan), planTargets);
    expect(stillShort.days.map((d) => d.calories)).toEqual([2579, 2302, 2751]);
    const bigger = (n: string) =>
      n.replace("45 g protein\n30 g carbohydrates\n20 g fat", "65 g protein\n120 g carbohydrates\n25 g fat").replace("50 g protein\n85 g carbohydrates\n18 g fat", "60 g protein\n100 g carbohydrates\n41 g fat");
    const fixed = planAsMealPlanText({ ...plan, nutrition_target_days: plan.nutrition_target_days!.map((d, i) => (i === 0 ? { ...d, notes: bigger(d.notes!) } : d)) });
    const covers = readEditedPlan(plan, fixed, planTargets);
    // 65+55+60 = 180 g protein, 120+95+100 = 315 g carbs, 25+8+41 = 74 g fat: 2,646 kcal, within 5% of 2,579
    expect(covers.days[0]).toMatchObject({ calories: 2646, protein: 180, carbs: 315, fats: 74 });
    expect(covers.days[1].calories).toBe(2302);
  });

  it("the coach's fix button hands this to Change it with AI, for the coach to send and review", () => {
    expect(BRING_MEALS_TO_TARGETS.length).toBeLessThan(REVISE_MAX_CHARS);
    expect(read("src/components/nutrition-targets-panel.tsx")).toContain("onFixMeals={() => prefillPlanAiChange(clientId, BRING_MEALS_TO_TARGETS)}");
    expect(read("src/components/nutrition/PlanAiChange.tsx")).toContain("data-plan-ai-short");
  });
});

describe("what each side sees", () => {
  it("the client's meal plan shows the meals as written, with no discrepancy line (coaching and member pages)", () => {
    const reader = read("src/components/nutrition/MealPlanReader.tsx");
    for (const gone of ["coverage", "dayCoverage", "Ask your coach", "These meals", "data-meal-plan-coverage"])
      expect(reader, gone).not.toContain(gone);
    expect(read("src/routes/_authenticated/portal/nutrition-targets.tsx")).toContain("<MealPlanReader text={String(day.notes)} water={plan.water ?? null} />");
    expect(read("src/components/nutrition/MemberMealPlanPanel.tsx")).toContain("<MealPlanReader text={String(active.notes)} water={plan.water ?? null} />");
    // nothing a client opens reads the coverage check
    for (const f of ["src/components/nutrition/DailyNutritionPanel.tsx", "src/components/nutrition/TodaysIntakeCard.tsx", "src/routes/_authenticated/portal/nutrition-targets.tsx", "src/components/nutrition/food-log-context.tsx"])
      expect(read(f), f).not.toMatch(/plan-coverage|coverageLine/);
  });

  it("the coach sees the gap on the plan and before publishing; the AI plan publishes the targets when its meals fall short", () => {
    const ui = read("src/components/nutrition/nutrition-ui.tsx");
    expect(ui).toContain("data-plan-meals-short");
    expect(ui).toContain("data-plan-target-math");
    const panel = read("src/components/nutrition/NutritionRequestPanel.tsx");
    expect(panel).toContain("aiTargetFor(targets, d.day_label)");
    expect(panel).toContain("Change something to bring the meals to it.");
    const server = read("src/lib/nutrition-ai-plans.server.ts");
    expect(server).toContain("mealPlanText = withHonestTotals(mealPlanText);");
    expect(read("src/lib/nutrition-plan-edits.server.ts")).toContain("withHonestTotals(await withShelfFix(");
  });
});
