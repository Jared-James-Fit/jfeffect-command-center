import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  allergensIn,
  buildFoodHistory,
  foodHistoryForAi,
  knownRestrictions,
  planResultLine,
  planSpan,
  saidWhen,
} from "@/lib/nutrition-targets/food-history";
import { mealPlanUserPrompt } from "@/lib/nutrition-ai-prompts";

const read = (p: string) => readFileSync(p, "utf8");

const update = (at: string, a: { allergy?: string; foods?: string; missed?: string; swap?: string }) => ({
  at: `${at}T18:00:00Z`,
  answers: [
    { label: "Any allergies? list all and explain", value: a.allergy ?? "" },
    { label: "List all of your foods + preferences", value: a.foods ?? "" },
    { label: "Which foods or meals do you want changed, and what would you rather have?", value: a.swap ?? "" },
    { label: "Anything i missed or need to know?", value: a.missed ?? "" },
  ],
});

describe("food history: what's said once stays on file", () => {
  const h = buildFoodHistory({
    updates: [
      update("2026-07-12", { allergy: "Shellfish allergy (shrimp makes me swell up)", foods: "No pork. Love chicken and rice", missed: "Hashimoto's, on levothyroxine" }),
      update("2026-10-26", { allergy: "None", foods: "I eat anything", swap: "Less oats at breakfast" }),
      update("2026-11-08", { allergy: "Need to be on a AIP diet (Autoimmune Protocol Diet)", foods: "AIP diet (Autoimmune Protocol Diet)", missed: "That's everything" }),
    ],
    goals: { food_restrictions_has: true, food_restrictions_details: "shellfish", food_dislikes: ["Mushrooms"], updated_at: "2026-09-01T00:00:00Z" },
    notes: [{ at: "2026-11-10T12:00:00Z", text: "Hates fish. Eats out Friday nights." }],
    coachChanges: [{ at: "2026-11-03T15:00:00Z", text: "salmon instead of beef on rest days" }],
    today: "2026-11-12",
  });

  it("an allergy said in July stays after a later 'None', with every time it was said", () => {
    expect(h.allergies.map((f) => f.label)).toEqual(["Shellfish"]);
    const shellfish = h.allergies[0];
    expect([shellfish.first, shellfish.last]).toEqual(["2026-07-12", "2026-09-01"]);
    expect(shellfish.mentions.map((m) => m.source)).toEqual(["Goals & Setup", "Nutrition Update"]);
    expect(saidWhen(shellfish)).toBe("Jul 12 – Sep 1");
  });

  it("a diet named in the allergy box is a diet, not an allergy; 'hates fish' in a note is never an allergy", () => {
    expect(h.diets.map((f) => f.label)).toEqual(["AIP", "No pork"]);
    expect(h.allergies.some((f) => /fish/i.test(f.label) && f.label !== "Shellfish")).toBe(false);
  });

  it("a named condition keeps their words; a plain 'that's everything' is nothing", () => {
    expect(h.health.map((f) => f.label)).toEqual(["Thyroid condition"]);
    expect(h.health[0].mentions[0].text).toBe("Hashimoto's, on levothyroxine");
    const arthritis = buildFoodHistory({ updates: [update("2026-11-01", { missed: "Severe bilateral shoulder arthritis" })], today: "2026-11-12" });
    expect(arthritis.health.map((f) => f.label)).toEqual(["Severe bilateral shoulder arthritis"]);
    const nothing = buildFoodHistory({ updates: [update("2026-11-01", { missed: "I train at 6am" })], today: "2026-11-12" });
    expect(nothing.health).toEqual([]);
  });

  it("preferences change, so the latest wins and the earlier ones are history; changes asked for are dated", () => {
    expect(h.preferences.map((p) => p.at)).toEqual(["2026-11-08", "2026-10-26", "2026-07-12"]);
    expect(h.changes).toEqual([
      { at: "2026-11-03", by: "coach", text: "salmon instead of beef on rest days" },
      { at: "2026-10-26", by: "client", text: "Less oats at breakfast" },
    ]);
  });

  it("the AI reads all of it, and the meal plan's allergy line never says 'none' while one is on file", () => {
    const text = foodHistoryForAi(h, "lb")!;
    expect(text).toContain("FOOD HISTORY (their whole account: 3 Nutrition Updates");
    expect(text).toContain("keep every plan clear of these, even when the latest form doesn't repeat them): Shellfish (said Jul 12 – Sep 1");
    expect(text).toContain("- Diets on file: AIP");
    expect(text).toContain("Thyroid condition");
    expect(text).toContain('Earlier food preferences (the latest answers win when they disagree): Oct 26 "I eat anything"; Jul 12 "No pork. Love chicken and rice"');
    expect(text).toContain('Nov 3 coach: "salmon instead of beef on rest days"');
    expect(knownRestrictions(h)).toBe("Shellfish, AIP, No pork");

    const latest = update("2026-11-08", { allergy: "None" }).answers;
    const prompt = mealPlanUserPrompt(latest, "", null, null, null, null, text, knownRestrictions(h));
    expect(prompt).toContain("- Allergies / dislikes: on file: Shellfish, AIP, No pork");
    expect(prompt).not.toContain("- Allergies / dislikes: None");
    expect(mealPlanUserPrompt(latest, "", null, null, null, null, null, null)).toContain("- Allergies / dislikes: none");
  });

  it("the coach can mark one as no longer applying; saying it again brings it back", () => {
    const base = {
      updates: [update("2026-07-12", { allergy: "Shellfish" })],
      today: "2026-11-12",
    };
    const off = buildFoodHistory({ ...base, dismissed: [{ kind: "allergy", key: "shellfish", at: "2026-08-01T00:00:00Z" }] });
    expect(off.allergies[0].dismissed).toEqual({ at: "2026-08-01" });
    expect(knownRestrictions(off)).toBeNull();
    expect(foodHistoryForAi(off)).toContain("- No longer applies (the coach checked): Shellfish");
    expect(foodHistoryForAi(off)).not.toContain("keep every plan clear");
    const back = buildFoodHistory({
      ...base,
      updates: [...base.updates, update("2026-10-01", { allergy: "shellfish!" })],
      dismissed: [{ kind: "allergy", key: "shellfish", at: "2026-08-01T00:00:00Z" }],
    });
    expect(back.allergies[0].dismissed).toBeNull();
  });

  it("allergens read the way people write them, never from a word that only looks like one", () => {
    expect(allergensIn("allergic to peanuts and shrimp")).toEqual(["Peanuts", "Shellfish"]);
    expect(allergensIn("lactose intolerant, celiac")).toEqual(["Dairy", "Gluten"]);
    expect(allergensIn("donuts and coconut")).toEqual([]);
    expect(allergensIn("shellfish")).toEqual(["Shellfish"]);
  });
});

describe("food history: every plan and how it went", () => {
  const weights = Array.from({ length: 40 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 14 + i)).toISOString().slice(0, 10),
    kg: 72 - i * 0.04 + (i % 2 ? 0.15 : -0.15),
  }));
  const h = buildFoodHistory({
    updates: [],
    plans: [
      { id: "a", start_date: "2026-09-14", end_date: "2026-10-25", status: "Archived", phase: "Fat Loss", days: [{ label: "Training Day", calories: 1800 }, { label: "Non-Training Day", calories: 1450 }] },
      { id: "b", start_date: "2026-10-26", end_date: "2026-11-25", status: "Active", phase: "Maintenance", days: [{ label: "Training Day", calories: 2000 }] },
    ],
    weights,
    checkins: [
      { submitted_at: "2026-09-20T12:00:00Z", answers: { nutrition_rating: 4, recovery_flags: ["Hunger / appetite"] } },
      { submitted_at: "2026-09-27T12:00:00Z", answers: { nutrition_rating: 3, recovery_flags: ["Digestion / bloating", "Hunger / appetite"] } },
      { submitted_at: "2026-11-02T12:00:00Z", answers: { nutrition_rating: 5, recovery_flags: ["All good"] } },
    ],
    trainingDays: ["Monday", "Wednesday", "Friday"],
    today: "2026-11-12",
  });

  it("newest first, each with its calories a day across their week and what was logged on it", () => {
    expect(h.plans.map((p) => [p.id, planSpan(p), p.kcal])).toEqual([
      ["b", "Oct 26 – now", 2000],
      ["a", "Sep 14 – Oct 25", 1600],
    ]);
    const cut = h.plans[1];
    expect([cut.checkins, cut.rating, cut.hunger, cut.digestion]).toEqual([2, 3.5, 2, 1]);
    expect(cut.trendClear).toBe(true);
    expect(planResultLine(cut, "kg")).toBe("−0.3 kg a week · nutrition 3.5/5 over 2 check-ins · hunger flagged 2 of 2 · digestion flagged 1 of 2");
    expect(foodHistoryForAi(h)).toContain("Sep 14 – Oct 25 Fat Loss ~1,600 kcal a day → −0.3 kg a week");
  });
});

describe("one read for the card and every AI path", () => {
  it("the loader reads the whole account and the card shows it with dates and Doesn't apply anymore", () => {
    const server = read("src/lib/nutrition-ai-plans.server.ts");
    expect(server).toContain("export async function loadFoodContext(");
    expect(server).toContain('.from("client_food_history_dismissals")');
    expect(server).toContain('.from("nutrition_plan_edits").select("instructions, applied_at")');
    expect(server).toContain("foodHistoryForAi(history, unit)");
    expect(server).toContain("mi.foodNotes, mi.foodRestrictions)");
    expect(read("src/lib/nutrition-plan-edits.server.ts")).toContain("foodRestrictions: food.restrictions");
    const card = read("src/components/nutrition/FoodNotesCard.tsx");
    expect(card).toContain("getFoodHistoryFn");
    expect(card).toContain("Doesn't apply anymore");
    expect(card).toContain('title="History"');
    expect(card).toContain("Put back");
  });

  it("the coach's marks are staff only, one per fact", () => {
    const sql = read("supabase/migrations/20270305090000_food_history_dismissals.sql");
    expect(sql).toContain("UNIQUE (client_id, kind, key)");
    expect(sql).toContain("client_id IN (SELECT public.coached_client_ids())");
    expect(sql).toContain("REVOKE ALL ON public.client_food_history_dismissals FROM anon");
    expect(sql).not.toMatch(/is_client_owner|clients\.user_id/);
  });
});

describe("a written plan never holds an allergen on file", () => {
  const fh = () => import("@/lib/nutrition-targets/food-history");
  const menu = (protein: string, carb: string) =>
    `Meal 1\n150 g ${protein}\n200 g ${carb}\n\nApproximate macros:\n40 g protein\n50 g carbohydrates\n8 g fat\n\nMeal 2 – Free Meal\nYour choice: shrimp tacos or whatever still fits your diet\n`;
  const plan = (protein: string, carb: string) =>
    ["PHASE: Maintenance", "", "TRAINING-DAY MENU", menu(protein, carb), "Daily Total\nApproximately 40 g protein, 50 g carbohydrates, 8 g fat", "", "FOOD-WEIGHING RULES", "Weigh cooked."].join("\n");

  it("reads the foods that carry one, never the free meal, plant milks or cream of rice", async () => {
    const { allergenConflicts, foodAllergens } = await fh();
    const days = [{ label: "Training Day", notes: menu("cooked shrimp", "cooked whole wheat pasta") }];
    expect(allergenConflicts(days, ["Shellfish", "Gluten"]).map((h) => [h.food, h.allergen, h.where[0]])).toEqual([
      ["cooked shrimp", "Shellfish", "Training Day Meal 1"],
      ["cooked whole wheat pasta", "Gluten", "Training Day Meal 1"],
    ]);
    expect(allergenConflicts(days, [])).toEqual([]);
    expect(foodAllergens("almond milk")).toEqual(["Tree nuts"]);
    expect(foodAllergens("cream of rice")).toEqual([]);
    expect(foodAllergens("natural peanut butter")).toEqual(["Peanuts"]);
    expect(foodAllergens("Greek yogurt")).toEqual(["Dairy"]);
    expect(foodAllergens("gluten-free bread")).toEqual([]);
    expect(foodAllergens("rice noodles")).toEqual([]);
  });

  it("dairy-free and gluten-free diets count; a dismissed allergy doesn't", async () => {
    const { buildFoodHistory, liveAllergens } = await fh();
    const h = buildFoodHistory({
      updates: [update("2026-10-01", { allergy: "Shellfish, lactose intolerant", foods: "gluten free please" })],
      dismissed: [{ kind: "allergy", key: "shellfish", at: "2026-11-01T00:00:00Z" }],
      today: "2026-11-12",
    });
    expect(liveAllergens(h).sort()).toEqual(["Dairy", "Gluten"]);
  });

  it("a new plan with one goes back first, ahead of prep and totals, and the fix is kept only with fewer", async () => {
    const { withPrepFix } = await import("@/lib/nutrition-ai-plans.server");
    const prompts: string[] = [];
    const out = await withPrepFix(plan("cooked shrimp", "cooked white rice"), "CLIENT", async (p) => (prompts.push(p), plan("cooked chicken breast", "cooked white rice")), [], 2, [], ["Shellfish"]);
    expect(out).toBe(plan("cooked chicken breast", "cooked white rice"));
    expect(prompts[0]).toContain("FIX THE ALLERGIES: these foods carry an allergen on file for this client");
    expect(prompts[0]).toContain("- cooked shrimp (Training Day Meal 1): shellfish");
    // a "fix" that keeps it is thrown away
    const kept = await withPrepFix(plan("cooked shrimp", "cooked white rice"), "x", async () => plan("cooked shrimp", "cooked jasmine rice"), [], 1, [], ["Shellfish"]);
    expect(kept).toBe(plan("cooked shrimp", "cooked white rice"));
  });

  it("a coach's change: one the AI brought in goes back; one the coach asked for stays theirs", async () => {
    const { withShelfFix } = await import("@/lib/nutrition-ai-plans.server");
    const { introducedAllergens } = await fh();
    const before = plan("cooked chicken breast", "cooked white rice");
    const after = plan("cooked shrimp", "cooked white rice");
    expect(introducedAllergens([{ label: "T", notes: before }], [{ label: "T", notes: after }], ["Shellfish"]).map((h) => h.food)).toEqual(["cooked shrimp"]);
    expect(introducedAllergens([{ label: "T", notes: before }], [{ label: "T", notes: after }], ["Shellfish"], [{ value: "use shrimp on rest days" }])).toEqual([]);
    let asked = 0;
    expect(await withShelfFix(before, after, "COACH", async () => (asked++, before), [{ value: "something new" }], ["Shellfish"])).toBe(before);
    expect(asked).toBe(1);
    expect(await withShelfFix(before, after, "COACH", async () => before, [{ value: "shrimp please" }], ["Shellfish"])).toBe(after);
  });

  it("the coach sees it first in Check before publishing and in the AI change review", () => {
    const panel = read("src/components/nutrition/NutritionRequestPanel.tsx");
    expect(panel).toContain("On file as an allergy: ${allergenConflictLine(allergyHits)}");
    expect(panel).toContain("return [...allergy, ...out");
    expect(read("src/components/nutrition/PlanAiChange.tsx")).toContain("data-plan-ai-allergen");
    expect(read("src/lib/nutrition-ai-plans.server.ts")).toContain("mi.foodAllergens ?? []");
    expect(read("src/lib/nutrition-plan-edits.server.ts")).toContain("food.allergens,");
  });
});
