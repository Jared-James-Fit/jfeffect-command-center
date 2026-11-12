import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MEAL_PLAN_PROMPT,
  mealPlanUserPrompt,
  mealPrepFixPrompt,
} from "@/lib/nutrition-ai-prompts";
import { freeMealRule } from "@/lib/nutrition-history";
import {
  SHELF_FIRST_ADVICE,
  hardToFindFoods,
  introducedHardToFind,
  planMenus,
} from "@/lib/nutrition-targets/plan-foods";
import { withPrepFix, withShelfFix } from "@/lib/nutrition-ai-plans.server";

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

describe("a coach's change keeps to shelf staples too, but the coach's words win", () => {
  const BEEF = plan("300 g cooked sweet potato");
  const BISON = BEEF.replace(/125 g 93% lean ground beef/g, "125 g ground bison");

  it("names only a hard-to-find food the change brought in, never one already on the plan or one the coach asked for", () => {
    expect(introducedHardToFind(planMenus(BEEF), planMenus(BISON)).map((h) => h.food)).toEqual([
      "ground bison",
    ]);
    // the coach kept cassava on the plan before: it's theirs
    expect(introducedHardToFind(planMenus(CASSAVA), planMenus(CASSAVA))).toEqual([]);
    expect(
      introducedHardToFind(planMenus(BEEF), planMenus(BISON), [
        { value: "use ground bison instead" },
      ]),
    ).toEqual([]);
  });

  it("sends a food the AI brought in back once for the staple, and keeps the fix", async () => {
    const prompts: string[] = [];
    const out = await withShelfFix(
      BEEF,
      BISON,
      "COACH UPDATE",
      async (p) => (prompts.push(p), BEEF),
      [{ value: "something other than chicken" }],
    );
    expect(out).toBe(BEEF);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(
      "- ground bison (Training Day Meal 1, Training Day Meal 2, Training Day Meal 3): use chicken breast, lean ground beef or ground turkey instead",
    );
  });

  it("never asks when the coach named the food, and keeps the change when the fix fails", async () => {
    let asked = 0;
    expect(
      await withShelfFix(BEEF, BISON, "x", async () => (asked++, BEEF), [
        { value: "bison please" },
      ]),
    ).toBe(BISON);
    expect(asked).toBe(0);
    expect(
      await withShelfFix(
        BEEF,
        BISON,
        "x",
        async () => {
          throw new Error("down");
        },
        [],
      ),
    ).toBe(BISON);
  });

  it("both AI change paths run it, with the coach's words and the client's answers", () => {
    const plans = readFileSync("src/lib/nutrition-ai-plans.server.ts", "utf8");
    const edits = readFileSync("src/lib/nutrition-plan-edits.server.ts", "utf8");
    expect(plans).toContain('"update_shelf"');
    expect(plans).toContain("[...qas, { value: instructions }, ...(foodNotes ? [{ value: foodNotes }] : [])]");
    expect(edits).toContain('"edit_shelf"');
    expect(edits).toContain("[...qas, { value: row.instructions }, ...(foodNotes ? [{ value: foodNotes }] : [])]");
  });
});

describe("everything else that writes or suggests food", () => {
  it("the coach sees a hard-to-find food in a pasted plan and in an AI change before it goes out", () => {
    expect(readFileSync("src/components/nutrition/MealPlanBulkPaste.tsx", "utf8")).toContain(
      "data-paste-hard-to-find",
    );
    expect(readFileSync("src/components/nutrition/PlanAiChange.tsx", "utf8")).toContain(
      "data-plan-ai-hard-to-find",
    );
  });

  it("Cleo and the check-in reply drafts suggest shelf staples", () => {
    expect(SHELF_FIRST_ADVICE).toContain("never a specialty food like cassava");
    expect(readFileSync("src/lib/summer-context.ts", "utf8")).toContain(
      "`- Foods: ${SHELF_FIRST_ADVICE}`",
    );
    expect(readFileSync("src/lib/submission-reviews.functions.ts", "utf8")).toContain(
      "`FOODS: ${SHELF_FIRST_ADVICE}`",
    );
  });

  it("Cleo's new numbers keep each day's meals and steps instead of wiping them, and say so", () => {
    const cleo = readFileSync("src/lib/cleo-program.server.ts", "utf8");
    expect(cleo).toContain("notes: was?.notes ?? null, steps: was?.steps ?? null, ...d");
    expect(cleo).toContain("Their meals stay as written on");
  });
});
