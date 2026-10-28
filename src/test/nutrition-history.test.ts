import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FREE_MEAL,
  FREE_MEAL_LABEL,
  FREE_MEAL_PICKS,
  FREE_MEAL_PICK_LABEL,
  MEAL_CHOICE,
  MEAL_CHOICE_LABEL,
  MEAL_SWAP_LABEL,
  freeMealRule,
  lastPlanSummary,
  mealChoiceOf,
  mealChoiceRule,
  pickPreviousPlan,
  planResults,
  previousMealsText,
  previousPlanText,
  wantsFreeMeal,
  type PreviousPlan,
} from "@/lib/nutrition-history";
import { mealPlanUserPrompt, targetsUserPrompt } from "@/lib/nutrition-ai-prompts";
import { prefillAnswer } from "@/lib/form-prefill";

const LB = 2.2046226;
const days = (start: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

describe("choices", () => {
  it("reads the meal choice and free meal answers", () => {
    expect(mealChoiceOf(MEAL_CHOICE.swap)).toBe("swap");
    expect(mealChoiceOf(MEAL_CHOICE.first)).toBe("first");
    expect(mealChoiceOf("")).toBeNull();
    expect(wantsFreeMeal(FREE_MEAL.yes)).toBe(true);
    expect(wantsFreeMeal(FREE_MEAL.no)).toBe(false);
    expect(wantsFreeMeal("")).toBeNull();
  });

  it("meal rules: keep / swap / fresh, and nothing to keep without a plan", () => {
    expect(mealChoiceRule("keep", "", true)).toContain("Only change portion sizes");
    expect(mealChoiceRule("swap", "no fish at dinner", true)).toContain('EXCEPT what the client asked to change: "no fish at dinner"');
    expect(mealChoiceRule("fresh", "", true)).toContain("build fresh meals");
    // "first plan" from someone who has one, or no answer: current meals are the base
    expect(mealChoiceRule("first", "", true)).toContain("Use the CURRENT MEALS as the base");
    expect(mealChoiceRule("keep", "", false)).toBe("");
  });

  it("free meal: High Day only, budgeted, their pick first; planned High Day otherwise", () => {
    const yes = freeMealRule(true, "Pasta");
    expect(yes).toContain('"Meal X – Free Meal"');
    expect(yes).toContain("Your choice: Pasta, burger + fries");
    expect(yes).toContain("25–35% of the High Day calories");
    expect(freeMealRule(true, "Whatever I'm craving that week")).toContain("Your choice: burger + fries");
    expect(freeMealRule(false, "")).toContain("fully planned High Day");
    expect(freeMealRule(null, "")).toBe("");
  });
});

describe("previous plan", () => {
  it("picks the latest plan made before the update that has numbers", () => {
    const t = [
      { id: "old", created_at: "2026-08-01T00:00:00Z", days: [{ calories: 2200 }] },
      { id: "empty", created_at: "2026-09-01T00:00:00Z", days: [] },
      { id: "cur", created_at: "2026-09-15T00:00:00Z", days: [{ calories: 2100 }] },
      { id: "new", created_at: "2026-10-28T00:00:00Z", days: [{ calories: 2000 }] }, // made from this update
    ];
    expect(pickPreviousPlan(t, "2026-10-26T21:00:00Z")?.id).toBe("cur");
  });

  it("bodyweight trend from 7-day averages, adherence and flags from weekly check-ins", () => {
    // 200 lb dropping ~0.5 lb / week over 6 weeks
    const weights = days("2026-09-15", 42).map((d, i) => ({ date: d, kg: (200 - i * (0.5 / 7)) / LB }));
    const r = planResults({
      start: "2026-09-15",
      end: "2026-10-26",
      unit: "lb",
      weights,
      checkins: [
        { answers: { nutrition_rating: 5, recovery_flags: ["All good"] } },
        { answers: { nutrition_rating: 4, recovery_flags: ["Hunger / appetite", "Sleep"] } },
        { answers: { nutrition_rating: 4, recovery_flags: ["Hunger / appetite"] } },
      ],
    });
    expect(r.bw_source).toBe("logged");
    expect(r.change).toBe(-2.5); // 7-day averages 35 days apart
    expect(r.rate_pct_week).toBe(-0.25); // 2 decimals: the rules turn on 0.25%
    expect(r).toMatchObject({ checkins: 3, adherence_avg: 4.3, flags: { hunger: 2, sleep: 1, energy: 0, digestion: 0 } });
  });

  it("falls back to the last update's bodyweight answer when there aren't enough weigh-ins", () => {
    const r = planResults({ start: "2026-09-15", end: "2026-10-26", unit: "lb", weights: [], checkins: [], formFallback: { fromKg: 200 / LB, toKg: 196 / LB, days: 42 } });
    expect(r).toMatchObject({ bw_source: "form", bw_start: 200, bw_now: 196, change: -4, adherence_avg: null });
    expect(planResults({ start: "2026-09-15", end: "2026-09-20", unit: "lb", weights: [], checkins: [] }).bw_source).toBeNull();
  });

  const prev: PreviousPlan = {
    target_id: "t1",
    phase: "Fat Loss",
    goal: "Lose body fat",
    start_date: "2026-09-15",
    weeks_on: 5.9,
    days: [
      { label: "Training Day", calories: 2230, protein: 164, carbs: 254, fats: 62, fibre: 26, meals: "Meal 1\n50 g oats" },
      { label: "High Day", calories: 2416, protein: 164, carbs: 305, fats: 60, fibre: 31, meals: "Meal 1\n80 g oats" },
    ],
    results: { unit: "lb", bw_start: 200, bw_now: 198.5, change: -1.5, rate_pct_week: -0.13, bw_weeks: 5.3, bw_source: "logged", checkins: 5, adherence_avg: 4.6, flags: { hunger: 1, energy: 0, digestion: 0, sleep: 0 } },
  };

  it("writes the last plan and its results for the targets prompt, and its meals for the meal plan", () => {
    const t = previousPlanText(prev);
    expect(t).toContain("PREVIOUS PLAN (on it 5.9 weeks · since Sep 15, 2026 · phase: Fat Loss");
    expect(t).toContain("- Training Day: 2230 kcal · protein 164 g · carbs 254 g · fat 62 g · fibre 26 g");
    expect(t).toContain("200 → 198.5 lb (−1.5 lb, −0.13% of bodyweight per week over 5.3 weeks)");
    expect(t).toContain("stuck to the meal plan 4.6/5 on average · flagged hunger 1 (of 5)");
    expect(previousMealsText(prev)).toContain("TRAINING DAY (current)\nMeal 1\n50 g oats");
    expect(lastPlanSummary(prev)).toBe("Fat Loss for 5.9 weeks · −0.13% bodyweight/week (−1.5 lb) · stuck to it 4.6/5 over 5 check-ins · hunger flagged 1×");
    expect(previousPlanText(null)).toBe("");
  });

  it("the targets prompt adjusts from the last plan by rate of change, and doesn't chase early water weight", async () => {
    const { TARGETS_PROMPT } = await import("@/lib/nutrition-ai-prompts");
    for (const rule of ["start from the previous plan's numbers", "fat loss: aim for 0.5–1% per week", "muscle gain: aim for 0.25–0.5% per week", "adherence under 4/5 = keep calories the same", "water and glycogen", "CHANGES FROM LAST PLAN", "a free meal on the high day fits inside the high day calories"]) {
      expect(TARGETS_PROMPT).toContain(rule);
    }
  });

  it("feeds both prompts", () => {
    const qas = [
      { label: "How many meals can you have per day? (3 minimum)", value: "4" },
      { label: MEAL_CHOICE_LABEL, value: MEAL_CHOICE.swap },
      { label: MEAL_SWAP_LABEL, value: "rice cakes in meal 2 for a bagel" },
      { label: FREE_MEAL_LABEL, value: FREE_MEAL.yes },
      { label: FREE_MEAL_PICK_LABEL, value: "Steak + potatoes" },
    ];
    expect(targetsUserPrompt("Marc", qas, null, null, previousPlanText(prev))).toContain("PREVIOUS PLAN (on it 5.9 weeks");
    const m = mealPlanUserPrompt(qas, "CALORIE TARGETS", "Fat Loss", null, null, previousMealsText(prev));
    expect(m).toContain("- Meals per day: 4");
    expect(m).toContain('- MEALS: Keep the CURRENT MEALS (same meals, foods, order and workout-meal tags) EXCEPT what the client asked to change: "rice cakes in meal 2 for a bagel"');
    expect(m).toContain("- HIGH DAY: Client wants a FREE MEAL on the HIGH-DAY MENU only");
    expect(m).toContain("Your choice: Steak + potatoes, burger + fries");
    expect(m).toContain("CURRENT MEALS (the plan the client is on now):\nTRAINING DAY (current)");
    // A first plan: no current meals, no meal rule.
    const first = mealPlanUserPrompt([{ label: MEAL_CHOICE_LABEL, value: MEAL_CHOICE.first }], "T");
    expect(first).not.toContain("- MEALS:");
    expect(first).not.toContain("CURRENT MEALS");
  });
});

describe("form", () => {
  it("pre-answers 'first plan' only for clients with no meal plan", () => {
    const q = { validation: { prefill: "nutrition_plan" }, options: Object.values(MEAL_CHOICE) };
    expect(prefillAnswer(q, { has_nutrition_plan: false })).toBe(MEAL_CHOICE.first);
    expect(prefillAnswer(q, { has_nutrition_plan: true })).toBeNull();
    expect(prefillAnswer(q, { has_nutrition_plan: null })).toBeNull();
  });

  it("the migration's questions match the labels and options the AI reads", () => {
    const sql = readFileSync("supabase/migrations/20270103090000_nutrition_update_previous_plan_free_meal.sql", "utf8").replace(/''/g, "'");
    for (const s of [MEAL_CHOICE_LABEL, MEAL_SWAP_LABEL, FREE_MEAL_LABEL, FREE_MEAL_PICK_LABEL, ...Object.values(MEAL_CHOICE), ...Object.values(FREE_MEAL), ...FREE_MEAL_PICKS]) {
      expect(sql).toContain(s);
    }
    expect(sql).toContain("takes more discipline");
    expect(sql).toContain('"prefill":"nutrition_plan"');
  });
});
