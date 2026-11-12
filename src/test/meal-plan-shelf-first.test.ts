import { describe, expect, it } from "vitest";
import {
  MEAL_PLAN_PROMPT,
  mealPlanUserPrompt,
  mealPrepFixPrompt,
} from "@/lib/nutrition-ai-prompts";
import { freeMealRule } from "@/lib/nutrition-history";
import { hardToFindFoods, planMenus } from "@/lib/nutrition-targets/plan-foods";
import { withPrepFix } from "@/lib/nutrition-ai-plans.server";

/** Fionna's AIP plan as the AI first wrote it (Nov 12 2026): cassava in every container. */
const meal = (n: number, carb: string, tag = "") =>
  `Meal ${n}${tag}\n125 g 93% lean ground beef\n${carb}\n100 g cooked broccoli\n15 g olive oil\n\nApproximate macros:\n37 g protein\n74 g carbohydrates\n25 g fat\n7 g fibre\n`;
const plan = (carb: string) =>
  [
    "PHASE: Maintenance",
    "",
    "TRAINING-DAY MENU",
    meal(1, carb),
    meal(2, carb, " (Pre-Workout)"),
    meal(3, carb, " (Post-Workout)"),
    "Daily Total\nApproximately 111 g protein, 222 g carbohydrates, 75 g fat and 21 g fibre",
    "",
    "HIGH-DAY MENU",
    meal(1, carb),
    meal(2, carb, " (Pre-Workout)"),
    "Meal 3 – Free Meal\nYour choice: plantain chips or whatever you're craving that still fits your diet\nAim for about 870 kcal with 40+ g protein.",
    "",
    "Daily Total\nApproximately 120 g protein, 260 g carbohydrates, 75 g fat and 20 g fibre",
    "",
    "FOOD-WEIGHING RULES",
    "Weigh meat and cooked carbs as cooked weight.",
    "Swap: 100 g cooked cassava = 140 g cooked sweet potato",
  ].join("\n");
const CASSAVA = plan("175 g cooked cassava");
const SWEET_POTATO = plan("300 g cooked sweet potato");
const AIP = [
  {
    label: "Any allergies? list all and explain",
    value: "Need to be on a AIP diet (Autoimmune Protocol Diet)",
  },
  { label: "List all of your foods + preferences", value: "AIP diet (Autoimmune Protocol Diet)" },
];

describe("shelf first: foods every grocery store has", () => {
  it("finds cassava in every container and where it sits, never in the free meal or the swap lines", () => {
    const found = hardToFindFoods(planMenus(CASSAVA), AIP);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ food: "cooked cassava", name: "cassava", kind: "carb" });
    expect(found[0].where).toEqual([
      "Training Day Meal 1",
      "Training Day Meal 2",
      "Training Day Meal 3",
      "High Day Meal 1",
      "High Day Meal 2",
    ]);
    expect(hardToFindFoods(planMenus(SWEET_POTATO), AIP)).toEqual([]);
  });

  it("a diet's name never brings a specialty food in; a client who named the food gets it", () => {
    expect(hardToFindFoods(planMenus(CASSAVA), [{ value: "paleo, AIP" }])).toHaveLength(1);
    expect(
      hardToFindFoods(planMenus(CASSAVA), [{ value: "I grew up on cassava and love it" }]),
    ).toEqual([]);
  });

  it("common foods that share a word stay common: kidney beans, goat cheese, artichoke hearts", () => {
    const days = [
      {
        label: "Training Day",
        notes:
          "Meal 1\n150 g canned kidney beans\n30 g goat cheese\n80 g artichoke hearts\n150 g cooked white rice\nMeal 2\n150 g bison\n200 g cooked white rice",
      },
    ];
    expect(hardToFindFoods(days).map((h) => [h.food, h.kind])).toEqual([["bison", "protein"]]);
  });

  it("the prompt picks the most common food that fits a diet, and names AIP's staple", () => {
    expect(MEAL_PLAN_PROMPT).toContain(
      "SHELF FIRST: every food is one a normal grocery store always has on its shelves",
    );
    expect(MEAL_PLAN_PROMPT).toContain(
      "AIP, paleo, grain-free, Whole30 or no-nightshades → sweet potatoes",
    );
    expect(MEAL_PLAN_PROMPT).toContain("never cassava, yuca, taro, plantain or specialty flours");
    expect(MEAL_PLAN_PROMPT).toContain("a diet's name alone never brings one in");
    expect(MEAL_PLAN_PROMPT).toContain("naming only the kinds of food this plan uses");
  });

  it("a free meal keeps to a medical or elimination diet: no burger + fries examples for an AIP client", () => {
    const aip = freeMealRule(
      true,
      "Whatever I'm craving that week",
      "Need to be on a AIP diet (Autoimmune Protocol Diet)",
    );
    expect(aip).toContain("Your choice: whatever you're craving that still fits your diet");
    expect(aip).not.toContain("burger + fries");
    expect(aip).toContain("never name a food that breaks it");
    for (const none of ["None", "no", "N/A", ""])
      expect(freeMealRule(true, "", none)).toContain("burger + fries");
    expect(
      mealPlanUserPrompt(
        [
          ...AIP,
          {
            label: "Do you want a free meal on your High Day?",
            value: "Yes, give me a free meal on my High Day",
          },
        ],
        "",
      ),
    ).toContain("still fits your diet");
  });
});

describe("a plan with a hard-to-find food goes back once for the staple", () => {
  it("asks with exactly what to change and where, and keeps the plan with sweet potatoes", async () => {
    const prompts: string[] = [];
    const out = await withPrepFix(
      CASSAVA,
      "CLIENT DETAILS",
      async (p) => {
        prompts.push(p);
        return SWEET_POTATO;
      },
      [],
      2,
      AIP,
    );
    expect(out).toBe(SWEET_POTATO);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(
      "FIX THE FOODS: these are hard to find on a normal grocery store's shelves",
    );
    expect(prompts[0]).toContain(
      "- cooked cassava (Training Day Meal 1, Training Day Meal 2, Training Day Meal 3): use white rice, potatoes or sweet potatoes (whichever their diet allows, in that order) instead",
    );
  });

  it("keeps the draft when the fix still uses it, and never asks when the client named it", async () => {
    expect(
      await withPrepFix(
        CASSAVA,
        "x",
        async () => CASSAVA.replace("Weigh meat", "Weigh the meat"),
        [],
        2,
        AIP,
      ),
    ).toBe(CASSAVA);
    let asked = 0;
    await withPrepFix(CASSAVA, "x", async () => (asked++, SWEET_POTATO), [], 2, [
      { value: "cassava please" },
    ]);
    expect(asked).toBe(0);
  });

  it("the fix prompt keeps the meal prep and the format", () => {
    const p = mealPrepFixPrompt(
      "CLIENT",
      "DRAFT",
      [],
      [],
      hardToFindFoods(planMenus(CASSAVA), AIP),
    );
    expect(p).toContain("every container keeps one set of grams, rule 2c");
    expect(p).toContain("then FOOD-WEIGHING RULES");
  });
});
