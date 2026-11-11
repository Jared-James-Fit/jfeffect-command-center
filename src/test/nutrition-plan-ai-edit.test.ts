import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  editChangesNothing,
  planAsMealPlanText,
  planAsTargetsText,
  planEditChanges,
  readEditedPlan,
  type PlanEditPlan,
} from "@/lib/nutrition-targets/plan-edit";
import { parseMealPlan } from "@/lib/nutrition-targets/meal-plan-parse";
import { parseMealPlan as parseFromComponent } from "@/components/nutrition/MealPlanBulkPaste";
import { DayMeals, DayRows } from "@/components/nutrition/nutrition-ui";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

/** The model's answers by call key; each call is recorded. */
const model = vi.hoisted(() => ({
  answers: {} as Record<string, string>,
  calls: [] as Array<{ task: string; key: string; prompt: string }>,
}));
vi.mock("@/lib/nutrition-ai-plans.server", async (importOriginal) => {
  const real: any = await importOriginal();
  return {
    ...real,
    loadTrainingPattern: async () => null,
    loadQAs: async () => ({ sub: null, qas: [] }),
    nutritionCall: async (
      _sb: any,
      _state: any,
      _save: any,
      task: string,
      key: string,
      _system: string,
      prompt: string,
    ) => {
      model.calls.push({ task, key, prompt });
      return { text: model.answers[key] ?? "", model: "openai:test" };
    },
  };
});

const meals = (rice: number, protein = "cooked chicken breast") =>
  [
    "Meal 1",
    "3 whole eggs",
    "60 g oats",
    "",
    "Approximate macros:",
    "25 g protein",
    "45 g carbohydrates",
    "15 g fat",
    "",
    "Meal 2 (Post-Workout)",
    `150 g ${protein}`,
    `${rice} g cooked white rice`,
    "",
    "Approximate macros:",
    "46 g protein",
    "56 g carbohydrates",
    "5 g fat",
  ].join("\n");

const PLAN: PlanEditPlan = {
  phase: "Recomp",
  food_weighing_rules: "Weigh meat and rice cooked.\nSwap: 100 g rice = 140 g potatoes",
  nutrition_target_days: [
    // stored out of order: the plan reads them by sort_order
    {
      day_label: "Non-Training Day",
      calories: 2302,
      protein: 180,
      carbs: 238,
      fats: 70,
      notes: meals(150),
      sort_order: 1,
      use_on: "rest",
      weekdays: [],
      steps: 8000,
    },
    {
      day_label: "Training Day (Friday Only)",
      calories: 2579,
      protein: 180,
      carbs: 305,
      fats: 71,
      notes: meals(200),
      sort_order: 0,
      use_on: "training",
      weekdays: ["Fri"],
      steps: 10000,
    },
  ],
};

describe("the current plan as the AI reads it", () => {
  it("targets are the day numbers in the AI's own format, steps included", () => {
    const t = planAsTargetsText(PLAN);
    expect(t).toContain(
      "CALORIE TARGETS\nTraining Day (Friday Only): 2579\nNon-Training Day: 2302",
    );
    expect(t).toContain(
      "MACRO TARGETS\n\nTraining Day (Friday Only)\nProtein: 180\nCarbs: 305\nFats: 71",
    );
    expect(t).toContain(
      "DAILY STEPS TARGETS\nTraining Day (Friday Only): 10,000 steps\nNon-Training Day: 8,000 steps",
    );
  });

  it("meals are the paste format: PHASE, a menu per day with its Daily Total, the weighing rules", () => {
    const m = planAsMealPlanText(PLAN);
    expect(m.startsWith("PHASE: Recomp\n\nTRAINING DAY (FRIDAY ONLY) MENU\n\nMeal 1")).toBe(true);
    expect(m).toContain("Daily Total\nApproximately 180 g protein, 238 g carbohydrates, 70 g fat");
    expect(m).toContain("FOOD-WEIGHING RULES\nWeigh meat and rice cooked.");
    // the app's own reader reads it back, one day per menu
    expect(parseMealPlan(m)).toHaveLength(2);
    expect(parseFromComponent).toBe(parseMealPlan);
  });

  it("an answer that keeps everything reads back as the same plan", () => {
    const edited = readEditedPlan(PLAN, planAsMealPlanText(PLAN), planAsTargetsText(PLAN));
    expect(
      edited.days.map((d) => [d.day_label, d.calories, d.use_on, d.weekdays, d.steps]),
    ).toEqual([
      ["Training Day (Friday Only)", 2579, "training", ["Fri"], 10000],
      ["Non-Training Day", 2302, "rest", [], 8000],
    ]);
    const changes = planEditChanges(PLAN, edited);
    expect(editChangesNothing(PLAN, edited, changes)).toBe(true);
  });
});

describe("the AI's answer as the plan's new days", () => {
  const answer = planAsMealPlanText(PLAN)
    .replace(
      "150 g cooked chicken breast\n200 g cooked white rice",
      "150 g cooked salmon\n200 g cooked white rice",
    )
    .replace(
      "Approximately 180 g protein, 305 g carbohydrates, 71 g fat",
      "Approximately 180 g protein, 285 g carbohydrates, 71 g fat",
    );
  const targets = planAsTargetsText(PLAN).replace(
    "Training Day (Friday Only): 10,000 steps",
    "Training Day (Friday Only): 11,000 steps",
  );

  it("keeps each day's label, rules and order; takes the numbers, meals and steps from the answer", () => {
    const edited = readEditedPlan(PLAN, answer, targets);
    const [training, rest] = edited.days;
    expect(training).toMatchObject({
      day_label: "Training Day (Friday Only)",
      carbs: 285,
      use_on: "training",
      weekdays: ["Fri"],
      steps: 11000,
      sort_order: 0,
    });
    expect(training.notes).toContain("150 g cooked salmon");
    expect(rest).toMatchObject({ day_label: "Non-Training Day", carbs: 238, steps: 8000 });
    expect(edited.foodWeighingRules).toContain("Swap: 100 g rice = 140 g potatoes");
  });

  it("says what changed, day by day: the numbers before and after and which meals", () => {
    const changes = planEditChanges(PLAN, readEditedPlan(PLAN, answer, targets));
    expect(changes[0]).toMatchObject({
      label: "Training Day (Friday Only)",
      before: { kcal: 2579, carbs: 305 },
      after: { carbs: 285 },
      meals: ["Meal 2"],
    });
    expect(changes[1].meals).toEqual([]);
    expect(changes[1].before).toEqual(changes[1].after);
  });

  it("names a meal added or taken away", () => {
    const fewer = planAsMealPlanText(PLAN).replace(
      /\n\nMeal 2 \(Post-Workout\)[\s\S]*?5 g fat/,
      "",
    );
    const changes = planEditChanges(PLAN, readEditedPlan(PLAN, fewer, null));
    expect(changes[0].meals).toEqual(["Meal 2 (removed)"]);
  });

  it("an answer with a different number of days isn't this plan", () => {
    const oneDay = planAsMealPlanText(PLAN).replace(
      /NON-TRAINING DAY MENU[\s\S]*?(?=FOOD-WEIGHING)/,
      "",
    );
    expect(() => readEditedPlan(PLAN, oneDay, null)).toThrow(/has 1 day where the plan has 2/);
    expect(() => readEditedPlan(PLAN, "Sorry, I can't help with that.", null)).toThrow(
      /didn't come back as a meal plan/,
    );
  });
});

describe("the coach sees a day's meals with a tap", () => {
  it("a day row with meals is a button; its meals read name left, amount right, with the meal's macros", () => {
    const html = renderToStaticMarkup(
      createElement(DayRows, {
        rows: [
          {
            label: "Training Day",
            kcal: 2579,
            protein: 180,
            carbs: 305,
            fat: 71,
            meals: meals(200),
          },
        ],
      }),
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("P 180 · C 305 · F 71");
    const list = renderToStaticMarkup(createElement(DayMeals, { text: meals(200) }));
    expect(list).toContain("Meal 2");
    expect(list).toContain("Post-Workout");
    expect(list).toContain("cooked white rice");
    expect(list).toContain("P 46 · C 56 · F 5");
  });
});

/* ------------------------------------------------------------------------ */
/* Apply and undo, against a small in-memory stand-in for the database.     */

type Row = Record<string, any>;
function fakeDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; value?: any }> = [];
  const from = (table: string) => {
    let rows = () => tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: "select" | "update" | "delete" | "insert"; value?: any } = { kind: "select" };
    const b: any = {
      select: () => b,
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), b),
      in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), b),
      or: () => b,
      not: () => b,
      order: () => b,
      limit: () => b,
      gte: () => b,
      update: (value: any) => ((op = { kind: "update", value }), b),
      delete: () => ((op = { kind: "delete" }), b),
      insert: (value: any) => ((op = { kind: "insert", value }), b),
      run: () => {
        const hit = rows().filter((r) => filters.every((f) => f(r)));
        if (op.kind === "update") hit.forEach((r) => Object.assign(r, op.value));
        if (op.kind === "delete") tables[table] = rows().filter((r) => !hit.includes(r));
        if (op.kind === "insert") tables[table] = [...rows(), ...[].concat(op.value)];
        if (op.kind !== "select") writes.push({ table, op: op.kind, value: op.value });
        return hit;
      },
      maybeSingle: async () => {
        const hit = b.run();
        if (table === "nutrition_targets" && hit[0])
          return {
            data: {
              ...hit[0],
              nutrition_target_days: (tables.nutrition_target_days ?? []).filter(
                (d) => d.target_id === hit[0].id,
              ),
            },
            error: null,
          };
        return { data: hit[0] ?? null, error: null };
      },
      single: async () => ({ data: b.run()[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: b.run(), error: null }).then(res, rej),
    };
    return b;
  };
  return { sb: { from }, tables, writes };
}

describe("applying the AI's change, and undoing it", () => {
  const setup = () => {
    const days = PLAN.nutrition_target_days!.map((d) => ({ ...d, target_id: "t1" }));
    const answer = planAsMealPlanText(PLAN).replace(
      "150 g cooked chicken breast\n200 g cooked white rice",
      "150 g cooked salmon\n200 g cooked white rice",
    );
    return fakeDb({
      nutrition_targets: [
        {
          id: "t1",
          client_id: "c1",
          status: "Active",
          phase: "Recomp",
          food_weighing_rules: PLAN.food_weighing_rules,
          last_updated_at: "2026-11-10T10:00:00.000Z",
        },
      ],
      nutrition_target_days: days,
      nutrition_plan_edits: [
        {
          id: "e1",
          client_id: "c1",
          target_id: "t1",
          status: "ready",
          instructions: "salmon instead of chicken on training days",
          before_targets_text: planAsTargetsText(PLAN),
          before_meal_plan_text: planAsMealPlanText(PLAN),
          targets_text: planAsTargetsText(PLAN),
          meal_plan_text: answer,
        },
      ],
    });
  };

  it("puts the change on the plan in place, keeps each day's rules, and keeps the days from before for Undo", async () => {
    const { applyPlanEdit, undoPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
    const db = setup();
    await applyPlanEdit(db.sb, "e1", "coach-1");
    const training = db.tables.nutrition_target_days.find((d) => d.sort_order === 0)!;
    expect(training).toMatchObject({
      target_id: "t1",
      day_label: "Training Day (Friday Only)",
      use_on: "training",
      weekdays: ["Fri"],
    });
    expect(training.notes).toContain("150 g cooked salmon");
    const edit = db.tables.nutrition_plan_edits[0];
    expect(edit).toMatchObject({ status: "applied", applied_by: "coach-1" });
    expect(edit.restore.days).toHaveLength(2);
    expect(db.tables.nutrition_targets[0].last_updated_at).toBe(edit.applied_at);

    await undoPlanEdit(db.sb, "e1");
    const back = db.tables.nutrition_target_days.find((d) => d.sort_order === 0)!;
    expect(back.notes).toContain("150 g cooked chicken breast");
    expect(db.tables.nutrition_plan_edits[0].status).toBe("undone");
  });

  it("refuses a change on a plan someone changed since the AI read it, and touches nothing", async () => {
    const { applyPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
    const db = setup();
    db.tables.nutrition_target_days[1].calories = 2400;
    await expect(applyPlanEdit(db.sb, "e1", "coach-1")).rejects.toThrow(/changed since you asked/);
    expect(db.writes).toEqual([]);
  });

  it("refuses a plan that isn't the client's current one any more", async () => {
    const { applyPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
    const db = setup();
    db.tables.nutrition_targets[0].status = "Archived";
    await expect(applyPlanEdit(db.sb, "e1", "coach-1")).rejects.toThrow(
      /isn't the client's current plan/,
    );
  });

  it("Undo refuses once the plan was changed again after the AI's change", async () => {
    const { applyPlanEdit, undoPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
    const db = setup();
    await applyPlanEdit(db.sb, "e1", "coach-1");
    db.tables.nutrition_targets[0].last_updated_at = "2027-01-01T00:00:00.000Z";
    await expect(undoPlanEdit(db.sb, "e1")).rejects.toThrow(/can't be undone here/);
  });
});

describe("wiring", () => {
  const panel = readFileSync("src/components/nutrition-targets-panel.tsx", "utf8");
  const change = readFileSync("src/components/nutrition/PlanAiChange.tsx", "utf8");
  const hook = readFileSync("src/routes/api/public/hooks/nutrition-plans-tick.ts", "utf8");
  const fns = readFileSync("src/lib/nutrition-ai-plans.functions.ts", "utf8");
  const sql = readFileSync(
    "supabase/migrations/20270301090000_nutrition_plan_ai_edits.sql",
    "utf8",
  );

  it("the Current plan card shows each day's meals and the AI change box", () => {
    expect(panel).toContain(
      "<PlanAiChange clientId={clientId} plan={plan} firstName={firstName} />",
    );
    expect(panel).toContain("meals: day.notes ?? null");
    // the one red button is the decision: putting a written change on the plan
    expect(change).toContain('variant="default"');
    expect(change.match(/variant="default"/g)).toHaveLength(1);
  });

  it("the writer runs in the background: the hook takes an edit id, and every call checks the caller can see the plan", () => {
    expect(hook).toContain("runQueuedPlanEdit(sb, editId)");
    expect(fns).toContain("canSeePlan(context.supabase, context.userId, data.targetId)");
    expect(fns.match(/canSeeEdit\(context\.supabase/g)).toHaveLength(3);
    expect(sql).toContain("client_id in (select public.coached_client_ids())");
    expect(sql).toContain("body := jsonb_build_object('editId', new.id)");
    expect(sql).toContain("from public.nutrition_plan_edits");
  });
});

describe("the background writer", () => {
  const editRow = () => ({
    id: "e2",
    client_id: "c1",
    target_id: "t1",
    status: "generating",
    instructions: "salmon instead of chicken",
    before_targets_text: planAsTargetsText(PLAN),
    before_meal_plan_text: planAsMealPlanText(PLAN),
    progress: null,
  });

  it("asks for the targets, then the meals with the coach's words last, and keeps the answer for review", async () => {
    const { runPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
    model.calls = [];
    model.answers = {
      edit_targets: planAsTargetsText(PLAN),
      edit_meals: planAsMealPlanText(PLAN).replace(
        "150 g cooked chicken breast",
        "150 g cooked salmon",
      ),
    };
    const db = fakeDb({ nutrition_plan_edits: [editRow()], nf_submissions: [] });
    expect(await runPlanEdit(db.sb, "e2")).toEqual({ status: "ready" });
    expect(model.calls.map((c) => [c.task, c.key])).toEqual([
      ["nutrition_write", "edit_targets"],
      ["nutrition_write", "edit_meals"],
    ]);
    expect(
      model.calls[1].prompt.trim().endsWith("COACH INSTRUCTIONS:\nsalmon instead of chicken"),
    ).toBe(true);
    const row = db.tables.nutrition_plan_edits[0];
    expect(row).toMatchObject({ status: "ready", progress: null, error: null });
    expect(row.meal_plan_text).toContain("150 g cooked salmon");
  });

  it("an answer that drops a day is an error the coach sees, never a change", async () => {
    const { runPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
    model.answers = {
      edit_targets: planAsTargetsText(PLAN),
      edit_meals: planAsMealPlanText(PLAN).replace(
        /NON-TRAINING DAY MENU[\s\S]*?(?=FOOD-WEIGHING)/,
        "",
      ),
    };
    const db = fakeDb({ nutrition_plan_edits: [editRow()], nf_submissions: [] });
    expect((await runPlanEdit(db.sb, "e2")).status).toBe("error");
    expect(db.tables.nutrition_plan_edits[0]).toMatchObject({ status: "error" });
    expect(db.tables.nutrition_plan_edits[0].error).toMatch(/has 1 day where the plan has 2/);
  });

  it("a change the coach cancelled while it was being written stays cancelled", async () => {
    const { runPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
    model.answers = { edit_targets: planAsTargetsText(PLAN), edit_meals: planAsMealPlanText(PLAN) };
    const db = fakeDb({
      nutrition_plan_edits: [{ ...editRow(), status: "discarded" }],
      nf_submissions: [],
    });
    await runPlanEdit(db.sb, "e2");
    expect(db.tables.nutrition_plan_edits[0].status).toBe("discarded");
  });
});
