import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dietTags, foodNotes, foodNotesForAi, isNoneAnswer } from "@/lib/nutrition-targets/food-notes";
import { mealPlanUserPrompt, reviseMealPlanUserPrompt, targetsUserPrompt } from "@/lib/nutrition-ai-prompts";
import {
  bodyweightSummary,
  nutritionConsistency,
  perWeekText,
  planMarkers,
  rangeStart,
  waterDays,
  withSevenDayAverage,
} from "@/lib/nutrition-targets/nutrition-progress";
import { PlanDaysView } from "@/components/nutrition/nutrition-ui";

const read = (p: string) => readFileSync(p, "utf8");

/** Fionna's Nov 2026 Nutrition Update, as the form stores it. */
const FIONNA = [
  { label: "Goal", value: "Maintain weight" },
  { label: "Explain your goal with more details: is there a target bodyweight? timeframe? any events or reason we are doing this?", value: "Feel better on AIP and keep my strength" },
  { label: "Any allergies? list all and explain", value: "Need to be on a AIP diet (Autoimmune Protocol Diet) " },
  { label: "How many meals can you have per day? (3 minimum)", value: "4" },
  { label: "Are you involved in any physical activities outside of the gym? ex. labour job, sports, yoga, dog walking etc...", value: "None" },
  { label: "List all of your foods + preferences", value: "AIP diet (Autoimmune Protocol Diet) " },
  { label: "Average daily steps", value: "8000" },
  { label: "What time do you usually train?", value: "Evening (after 5 pm)" },
  { label: "Anything i missed or need to know?", value: "That's everything" },
];

describe("Food & diet: what to keep in mind, read from what's on file", () => {
  it("an AIP client: allergies flagged, the diet tagged, the day to day in order", () => {
    const f = foodNotes({ answers: FIONNA, goals: null, coachNotes: [] });
    expect(f.allergyState).toBe("some");
    expect(f.allergies).toEqual(["Need to be on a AIP diet (Autoimmune Protocol Diet)"]);
    expect(f.diet).toEqual(["AIP"]);
    expect(f.eats).toBe("AIP diet (Autoimmune Protocol Diet)");
    expect(f.health).toEqual([]);
    expect(f.goal).toBe("Maintain weight · Feel better on AIP and keep my strength");
    expect(f.routine).toEqual([
      { label: "Meals a day", value: "4" },
      { label: "Trains", value: "Evening (after 5 pm)" },
      { label: "Daily steps", value: "8,000" },
    ]);
  });

  it("'None' is none, 'I eat anything' reads plainly, and a note in 'anything I missed' is a health line", () => {
    const f = foodNotes({
      answers: [
        { label: "Any allergies? list all and explain", value: "None" },
        { label: "List all of your foods + preferences", value: "I eat anything" },
        { label: "Anything i missed or need to know?", value: "Severe bilateral shoulder arthritis affecting mobility" },
      ],
    });
    expect(f.allergyState).toBe("none");
    expect(f.allergies).toEqual([]);
    expect(f.eats).toBe("Eats anything");
    expect(f.health).toEqual(["Severe bilateral shoulder arthritis affecting mobility"]);
    for (const v of ["None", "no", "N/A", "That's everything", "that's everything for now", "Nothing.", ""]) expect(isNoneAnswer(v), v).toBe(true);
    for (const v of ["No pork", "Nuts", "None of the above except dairy"]) expect(isNoneAnswer(v), v).toBe(false);
  });

  it("Goals & Setup adds restrictions and dislikes; health mentions come from safetyNotes", () => {
    const f = foodNotes({
      answers: [
        { label: "Any allergies? list all and explain", value: "Shellfish" },
        { label: "Anything i missed or need to know?", value: "I have type 2 diabetes, on metformin" },
      ],
      goals: { food_restrictions_has: true, food_restrictions_details: "Celiac, no gluten at all", food_dislikes: ["Mushrooms", "Olives"], nutrition_preference: "Meal plan", cooking_skill: "beginner" },
    });
    expect(f.allergies).toEqual(["Shellfish", "Celiac, no gluten at all"]);
    expect(f.diet).toEqual(["Gluten-free"]);
    expect(f.avoids).toEqual(["Mushrooms", "Olives"]);
    expect(f.health[0]).toBe("Diabetes or blood sugar medication");
    expect(f.style).toEqual([
      { label: "Likes to follow", value: "Meal plan" },
      { label: "Cooking", value: "Beginner" },
    ]);
    expect(foodNotes({}).allergyState).toBe("unknown");
    expect(foodNotes({}).empty).toBe(true);
  });

  it("diet tags: vegan says vegetarian already, 'non-vegetarian' isn't one, a coach's note counts", () => {
    expect(dietTags(["vegan, no soy"])).toEqual(["Vegan"]);
    expect(dietTags(["I'm non-vegetarian"])).toEqual([]);
    expect(dietTags(["No pork", "lactose intolerant"])).toEqual(["Dairy-free", "No pork"]);
    expect(foodNotes({ coachNotes: ["Halal only"] }).diet).toEqual(["Halal"]);
  });

  it("the AI reads Goals & Setup's restrictions and the coach's notes, and follows them unless they break an allergy", () => {
    const text = foodNotesForAi(
      { food_restrictions_has: true, food_restrictions_details: "Shellfish", food_dislikes: ["Fish"] },
      ["Eats out Friday nights\nkeep dinner flexible"],
    )!;
    expect(text).toContain("COACH'S FOOD NOTES (follow these unless one would break an allergy or a medical need");
    expect(text).toContain("- Goals & Setup, allergies / intolerances: Shellfish");
    expect(text).toContain("- Goals & Setup, won't eat: Fish");
    expect(text).toContain("- Coach's note: Eats out Friday nights / keep dinner flexible");
    expect(foodNotesForAi({ food_restrictions_has: false, food_restrictions_details: "old", food_dislikes: [] }, [])).toBeNull();

    expect(mealPlanUserPrompt(FIONNA, "", null, null, null, null, text)).toContain("- Coach's note: Eats out Friday nights");
    expect(targetsUserPrompt("Fionna", FIONNA, null, null, null, null, { foodNotes: text })).toContain("Goals & Setup, won't eat: Fish");
    expect(
      reviseMealPlanUserPrompt({ qas: FIONNA, targetsText: "T", mealPlanText: "M", instructions: "x", foodNotes: text }),
    ).toContain("COACH'S FOOD NOTES");
  });

  it("every AI path loads them: a new plan, Change something, Change it with AI and the copy prompts", () => {
    const plans = read("src/lib/nutrition-ai-plans.server.ts");
    expect(plans).toContain("loadFoodContext(sb, sub.client_id)");
    expect(plans).toContain("loadFoodContext(sb, row.client_id)");
    expect(plans).toContain('.eq("topic", "nutrition")');
    expect(read("src/lib/nutrition-plan-edits.server.ts")).toContain("loadFoodContext(sb, row.client_id)");
    expect(read("src/lib/nutrition-ai-plans.functions.ts")).toContain("loadFoodContext(sb, data.clientId)");
    expect(read("src/components/nutrition/NutritionRequestPanel.tsx").match(/foodNotes: data\?\.foodNotes|data\?\.foodNotes \?\? null/g)?.length).toBe(3);
  });

  it("the coach's nutrition notes are notes in the one list, tagged 'nutrition', staff only", () => {
    const sql = read("supabase/migrations/20270304090000_nutrition_notes_topic.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS topic text");
    expect(sql).toContain("CHECK (topic IS NULL OR topic IN ('nutrition'))");
    const card = read("src/components/nutrition/FoodNotesCard.tsx");
    expect(card).toContain('addClientFileNote(clientId, "", draft, "nutrition")');
    expect(card).toContain('n.topic === "nutrition" && !n.archived_at');
    expect(read("src/components/clients/client-file-notes.tsx")).toContain('n.topic === "nutrition"');
  });
});

describe("the plan reads a day at a time: targets, then meals", () => {
  const meals = `Meal 1\n150 g chicken breast\n200 g cooked white rice\n\nApproximate macros:\n45 g protein\n56 g carbohydrates\n5 g fat\n\nMeal 2 (Post-Workout)\n150 g lean ground beef\n200 g cooked white rice\n\nApproximate macros:\n38 g protein\n56 g carbohydrates\n15 g fat\n`;
  const html = renderToStaticMarkup(
    createElement(PlanDaysView, {
      days: [
        { label: "Training Day", kcal: 2450, protein: 180, carbs: 280, fat: 70, steps: 10000, cardio: "15 min", meals, was: { kcal: 2300, protein: 180, carbs: 245, fat: 70 } },
        { label: "Non-Training Day", kcal: 2150, protein: 180, carbs: 205, fat: 70, meals: null },
      ],
      water: "3.5 L",
      compareLabel: "Their plan now",
    }),
  );

  it("day chips carry each day's calories, the first day is picked", () => {
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("2,450 kcal");
    expect(html).toContain("2,150 kcal");
  });

  it("Targets is the client's ring with steps, cardio and water; Meal plan is its meal cards, each with its calories", () => {
    expect(html).toContain("data-plan-targets");
    expect(html).toContain('aria-label="Calories: Protein 29%, Carbs 45%, Fat 26%"');
    expect(html).toContain("10,000");
    expect(html).toContain("15 min");
    expect(html).toContain("3.5 L");
    expect(html).toContain("data-plan-meals");
    expect(html).toContain("Meal plan");
    expect(html).toContain("· 2 meals");
    expect(html).toContain("449 kcal"); // 45*4 + 56*4 + 5*9
    expect(html).toContain("P 45 · C 56 · F 5");
  });

  it("a new plan says what each day was on the plan they're on now", () => {
    expect(html).toContain("Their plan now: 2,300 kcal · P 180 · C 245 · F 70");
    expect(html).toContain("(+150 kcal)");
  });

  it("the Current plan and the AI review both use it; the review compares to the plan now", () => {
    expect(read("src/components/nutrition-targets-panel.tsx")).toContain("<PlanDaysView");
    const review = read("src/components/nutrition/NutritionRequestPanel.tsx");
    expect(review).toContain('<PlanDaysView days={reviewDays} compareLabel="Their plan now" />');
    expect(review).toContain("const was = published ? null : now.get(dayKey(r.label)) ?? null;");
  });

  it("the tab: the update, Food & diet beside the plan, how it's going, cardio", () => {
    const tab = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
    const order = ["<NutritionRequestPanel", "<FoodNotesCard", "<NutritionTargetsPanel", "<NutritionProgressCard", "<CardioTargetsPanel"].map((t) => tab.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(tab).toContain('<FoodNotesCard clientId={id} className="md:col-span-1 md:self-start" />');
    expect(tab).toContain('<NutritionTargetsPanel clientId={id} className="md:col-span-2" />');
  });
});

describe("how it's going: the charts' math", () => {
  it("each weigh-in carries the average of the 7 days ending on it", () => {
    const pts = withSevenDayAverage([
      { date: "2026-11-01", value: 160 },
      { date: "2026-11-03", value: 158 },
      { date: "2026-11-07", value: 157 },
      { date: "2026-11-08", value: 159 },
    ]);
    expect(pts.map((p) => p.avg)).toEqual([160, 159, 158.3, 158]);
  });

  it("the trend on this plan is the AI's own reading (weightTrend), in their unit", () => {
    const all = Array.from({ length: 36 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10),
      value: Math.round((170 - i * 0.1 + (i % 2 ? 0.3 : -0.3)) * 10) / 10,
    }));
    const shown = withSevenDayAverage(all);
    const s = bodyweightSummary(shown, all, "lb", "2026-10-01", "2026-11-05");
    expect(s.latest?.date).toBe("2026-11-05");
    expect(s.onPlan?.clear).toBe(true);
    expect(s.onPlan!.perWeek).toBeCloseTo(-0.7, 1);
    expect(perWeekText(s.onPlan!.perWeek, "lb")).toBe("−0.7 lb a week");
    expect(bodyweightSummary(shown, all, "lb", null, "2026-11-05").onPlan).toBeNull();
  });

  it("plan markers: plans that started in the range, with their calories a day across the week", () => {
    const m = planMarkers(
      [
        { id: "old", start_date: "2026-06-01", days: [{ label: "Training Day", calories: 2600 }] },
        { id: "new", start_date: "2026-10-20", phase: "Fat Loss", days: [{ label: "Training Day", calories: 2400 }, { label: "Non-Training Day", calories: 2050 }] },
      ],
      "2026-08-20",
      "2026-11-11",
      ["Monday", "Wednesday", "Friday"],
      null,
    );
    // 3 training days at 2,400 and 4 rest days at 2,050 → 2,200 a day
    expect(m).toEqual([{ id: "new", date: "2026-10-20", kcal: 2200, phase: "Fat Loss" }]);
    expect(rangeStart("2026-11-12", "4w")).toBe("2026-10-16");
  });

  it("nutrition consistency: the weekly check-in's 1–5, in range, with its average", () => {
    const c = nutritionConsistency(
      [
        { submitted_at: "2026-09-01T12:00:00Z", answers: { nutrition_rating: 2 } },
        { submitted_at: "2026-10-26T12:00:00Z", answers: { nutrition_rating: 4 } },
        { submitted_at: "2026-11-02T12:00:00Z", answers: { nutrition_rating: "5" } },
        { submitted_at: "2026-11-09T12:00:00Z", answers: { win: "PR" } },
      ],
      "2026-10-01",
      "2026-11-12",
    );
    expect(c.points).toEqual([
      { date: "2026-10-26", rating: 4 },
      { date: "2026-11-02", rating: 5 },
    ]);
    expect(c.avg).toBe(4.5);
  });

  it("water: every day of the last 14, a missed day at 0, nothing when nothing was logged", () => {
    const w = waterDays(
      [
        { entry_date: "2026-11-12", amount_ml: 1500 },
        { entry_date: "2026-11-12", amount_ml: 1000 },
        { entry_date: "2026-11-10", amount_ml: 3000 },
        { entry_date: "2026-10-01", amount_ml: 9000 },
      ],
      "2026-11-12",
    )!;
    expect(w.days).toHaveLength(14);
    expect(w.days[13]).toEqual({ date: "2026-11-12", liters: 2.5 });
    expect(w.days[12]).toEqual({ date: "2026-11-11", liters: 0 });
    expect(w.logged).toBe(2);
    expect(w.avgLiters).toBe(2.8);
    expect(waterDays([], "2026-11-12")).toBeNull();
  });

  it("the charts follow the chart rules: one axis each, theme colours as they are, a hover on every chart", () => {
    const src = read("src/components/nutrition/NutritionProgressCard.tsx");
    expect(src).not.toContain("hsl(var(");
    expect(src).not.toContain('yAxisId="right"');
    expect(src.match(/<Tooltip/g)?.length).toBe(3);
    expect(src).toContain('title="Nutrition consistency"');
  });
});
