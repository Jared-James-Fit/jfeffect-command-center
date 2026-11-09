import { describe, expect, it } from "vitest";
import {
  MEAL_PLAN_PROMPT,
  REVISE_TARGETS_PROMPT,
  TARGETS_PROMPT,
  mealPrepFixPrompt,
  manualRevisePrompt,
} from "@/lib/nutrition-ai-prompts";
import { freeMealRule } from "@/lib/nutrition-history";
import { planMenus, prepDrift, prepDriftLine } from "@/lib/nutrition-targets/plan-foods";
import { withPrepFix } from "@/lib/nutrition-ai-plans.server";

const macros = (p: number, c: number, f: number) =>
  `\nApproximate macros:\n${p} g protein\n${c} g carbohydrates\n${f} g fat\n4 g fibre\n`;
const box = (n: number, rice: number, tag = "") =>
  `Meal ${n}${tag}\n150 g cooked chicken breast\n${rice ? `${rice} g cooked white rice\n` : ""}100 g broccoli\n5 g olive oil\n${macros(46, rice ? 63 : 7, 10)}`;
const breakfast = `Meal 1\n3 whole eggs\n60 g oats\n1 medium banana\n${macros(25, 63, 17)}`;
const total =
  "\nDaily Total\nApproximately 200 g protein, 250 g carbohydrates, 60 g fat and 30 g fibre\n";

/** Training: 3 containers with rice. Non-training: the rice out of one. High: double rice pre-workout. */
const PREPPED = [
  "PHASE: Fat Loss",
  "",
  "TRAINING-DAY MENU",
  breakfast,
  box(2, 200),
  box(3, 200, " (Pre-Workout)"),
  box(4, 200, " (Post-Workout)"),
  total,
  "NON-TRAINING-DAY MENU",
  breakfast,
  box(2, 200),
  box(3, 200),
  box(4, 0),
  total,
  "HIGH-DAY MENU",
  breakfast,
  box(2, 200),
  box(3, 400, " (Pre-Workout)"),
  box(4, 200, " (Post-Workout)"),
  "1 plain bagel",
  total,
  "FOOD-WEIGHING RULES",
  "Swap: 100 g cooked chicken breast = 130 g cooked white fish",
  "Swap: 100 g cooked white rice = 140 g cooked potatoes",
].join("\n");

/** The old way: the Non-Training Day re-weighs the rice and one chicken portion. */
const [HEAD, REST] = PREPPED.split("NON-TRAINING-DAY MENU");
const [NON_TRAINING, HIGH] = REST.split("HIGH-DAY MENU");
const REWEIGHED = [
  HEAD,
  "NON-TRAINING-DAY MENU",
  NON_TRAINING.replace(/200 g cooked white rice/g, "150 g cooked white rice").replace(
    "Meal 4\n150 g cooked chicken breast",
    "Meal 4\n165 g cooked chicken breast",
  ),
  "HIGH-DAY MENU",
  HIGH,
].join("");

describe("meal prep: one weighed amount per food", () => {
  it("reads the menus of a whole AI plan, before the weighing rules", () => {
    const menus = planMenus(PREPPED);
    expect(menus.map((m) => m.label)).toEqual(["Training Day", "Non Training Day", "High Day"]);
    expect(menus.at(-1)!.notes).not.toContain("Swap:");
  });

  it("a prepped plan has no drift: the same container everywhere, a portion taken out or exactly doubled", () => {
    expect(prepDrift(planMenus(PREPPED))).toEqual([]);
  });

  it("names every food re-weighed between meals or days, and where", () => {
    const drift = prepDrift(planMenus(REWEIGHED));
    expect(drift.map((d) => d.food)).toEqual(["cooked chicken breast", "cooked white rice"]);
    const rice = drift.find((d) => d.food === "cooked white rice")!;
    expect(rice).toMatchObject({ base: 200, unit: "g", amounts: [150, 200, 400] });
    expect(rice.odd).toEqual(["Non Training Day Meal 2: 150 g", "Non Training Day Meal 3: 150 g"]);
    expect(prepDriftLine(rice)).toBe("cooked white rice 150 / 200 / 400 g");
    expect(drift[0].odd).toEqual(["Non Training Day Meal 4: 165 g"]);
  });

  it("one food however it's written, counted foods and the free meal never count", () => {
    const days = [
      {
        label: "Training Day",
        notes:
          "Meal 1\n150 g cooked chicken breast\n2 slices bread\nMeal 2\n150 g chicken breast (cooked)\n1 bagel",
      },
      {
        label: "High Day",
        notes:
          "Meal 1\n150 g Chicken breast\n4 slices bread\nMeal 4 – Free Meal\nYour choice: pasta\nAim for about 900 kcal with 40+ g protein.",
      },
    ];
    expect(prepDrift(days)).toEqual([]);
    expect(
      prepDrift([{ notes: "Meal 1\n150 g chicken breast\nMeal 2\n175 g chicken breast" }]).map(
        (d) => d.base,
      ),
    ).toEqual([150]);
  });

  it("the prompt plans the prepped meal first and moves whole portions between day types", () => {
    for (const rule of [
      "2c. MEAL PREP",
      "THE PREPPED MEAL: every main meal is the same container",
      "PROTEIN never changes between menus",
      "SIZE THE CARB PORTION FROM THE TARGETS",
      "OTHER DAY TYPES MOVE WHOLE THINGS ONLY",
      "FINE-TUNE WITH COUNTED UNITS",
      "A portion only changes size when the number of meals changes",
      "keep the client's prepped amounts",
      "CHECK BEFORE WRITING",
    ]) {
      expect(MEAL_PLAN_PROMPT).toContain(rule);
    }
    expect(MEAL_PLAN_PROMPT).not.toContain("carbs spread evenly");
    expect(MEAL_PLAN_PROMPT).not.toMatch(/fine-tune each day's numbers with the weighed foods/);
  });

  it("targets step carbs in whole portions with protein and fats flat, so the plan can move whole portions", () => {
    expect(TARGETS_PROMPT).toContain("in whole meal-prep steps");
    expect(TARGETS_PROMPT).toContain(
      "one step being a round 40–80 g of carbs, the same size both ways",
    );
    expect(TARGETS_PROMPT).toContain("so are fats (within about 5 g)");
    expect(REVISE_TARGETS_PROMPT).toContain("day types differ by whole carb steps");
    expect(
      manualRevisePrompt({ qas: [], targetsText: "", mealPlanText: "x", instructions: "y" }),
    ).toContain("the meal-prep way (rule 2c)");
  });

  it("the High Day keeps the prepped meals, with or without a free meal", () => {
    expect(freeMealRule(true, "")).toContain(
      "The other High-Day meals stay the prepped meals of the other menus",
    );
    expect(freeMealRule(true, "")).not.toContain("Build the other High-Day meals lean");
    expect(freeMealRule(false, "")).toContain("The prepped meals stay as they are");
  });
});

describe("a drifting plan gets one fix, kept only when it's better", () => {
  it("leaves a prepped plan alone without asking again", async () => {
    let asked = 0;
    const out = await withPrepFix(PREPPED, "CLIENT DETAILS", async () => {
      asked++;
      return "";
    });
    expect(out).toBe(PREPPED);
    expect(asked).toBe(0);
  });

  it("asks once with exactly what drifts, and keeps the fixed plan", async () => {
    const prompts: string[] = [];
    const out = await withPrepFix(REWEIGHED, "CLIENT DETAILS:\n- Bodyweight: 200", async (p) => {
      prompts.push(p);
      return "```\n" + PREPPED + "\n```";
    });
    expect(out).toBe(PREPPED);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].startsWith("CLIENT DETAILS:\n- Bodyweight: 200")).toBe(true);
    expect(prompts[0]).toContain("YOUR DRAFT:\nPHASE: Fat Loss");
    expect(prompts[0]).toContain(
      "- cooked white rice 150 / 200 / 400 g (prepped amount 200 g; off at Non Training Day Meal 2: 150 g, Non Training Day Meal 3: 150 g)",
    );
  });

  it("keeps the draft when the fix fails, isn't a plan, drops a menu or drifts as much", async () => {
    expect(
      await withPrepFix(REWEIGHED, "x", async () => {
        throw new Error("gateway down");
      }),
    ).toBe(REWEIGHED);
    expect(await withPrepFix(REWEIGHED, "x", async () => "Sorry, I can't help with that.")).toBe(
      REWEIGHED,
    );
    const twoMenus =
      PREPPED.slice(0, PREPPED.indexOf("HIGH-DAY MENU")) + "FOOD-WEIGHING RULES\nWeigh cooked.";
    expect(await withPrepFix(REWEIGHED, "x", async () => twoMenus)).toBe(REWEIGHED);
    expect(
      await withPrepFix(REWEIGHED, "x", async () => `${REWEIGHED}\nSwap: 1 bagel = 2 slices bread`),
    ).toBe(REWEIGHED);
  });

  it("the fix prompt keeps the rest of the plan and the format", () => {
    const p = mealPrepFixPrompt("CLIENT", "DRAFT", prepDrift(planMenus(REWEIGHED)));
    expect(p).toContain("Keep everything else as it is");
    expect(p).toContain("within ±3%");
    expect(p).toContain("then FOOD-WEIGHING RULES");
  });
});
