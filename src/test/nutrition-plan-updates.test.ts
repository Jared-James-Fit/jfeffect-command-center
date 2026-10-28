import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MEAL_PLAN_PROMPT,
  REVISE_TARGETS_PROMPT,
  manualRevisePrompt,
  reviseMealPlanUserPrompt,
  revisionLooksRight,
  type QA,
} from "@/lib/nutrition-ai-prompts";
import {
  queueNutritionPlan,
  queueNutritionRevision,
  undoNutritionRevision,
} from "@/lib/nutrition-ai-plans.server";

/** Just enough of the Supabase query builder for the queue functions. */
function fakeDb(rows: Record<string, any[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      const match = () => (rows[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const api: any = {
        select: () => api,
        eq: (c: string, v: unknown) => (filters.push([c, v]), api),
        update: (p: Record<string, unknown>) => ((patch = p), api),
        upsert: (row: any, o: { onConflict: string }) => {
          const list = (rows[table] ??= []);
          const i = list.findIndex((r) => r[o.onConflict] === row[o.onConflict]);
          if (i >= 0) list[i] = { ...list[i], ...row };
          else list.push({ ...row });
          return Promise.resolve({ error: null });
        },
        maybeSingle: () => Promise.resolve({ data: match()[0] ?? null }),
        then: (res: any, rej: any) => {
          if (patch) for (const r of match()) Object.assign(r, patch);
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
}

const SUB = "11111111-1111-4111-8111-111111111111";
const OLD = new Date(Date.now() - 60 * 60_000).toISOString();

function db(plan: Record<string, unknown>) {
  const rows = {
    nf_submissions: [{ id: SUB, client_id: "c1" }],
    nutrition_ai_plans: [{ submission_id: SUB, client_id: "c1", updated_at: OLD, revisions: [], ...plan }],
  };
  return { sb: fakeDb(rows), plan: () => rows.nutrition_ai_plans[0] as any };
}

describe("coach updates to a written nutrition plan", () => {
  it("queues an update on a ready plan, and refuses one with no plan", async () => {
    const { sb, plan } = db({ status: "ready", meal_plan_text: "TRAINING-DAY MENU" });
    await queueNutritionRevision(sb, SUB, "  swap the beef for salmon  ");
    expect(plan().status).toBe("pending");
    expect(plan().revise_instructions).toBe("swap the beef for salmon");
    expect(plan().meal_plan_text).toBe("TRAINING-DAY MENU");

    const empty = db({ status: "error", meal_plan_text: null });
    let threw = false;
    await queueNutritionRevision(empty.sb, SUB, "anything").catch(() => (threw = true));
    expect(threw).toBe(true);
  });

  it("a stuck update is re-queued as the same update; only Regenerate replaces it", async () => {
    const { sb, plan } = db({ status: "pending", meal_plan_text: "x", revise_instructions: "4 meals", revisions: [{ at: OLD, instructions: "a" }] });
    await queueNutritionPlan(sb, SUB);
    expect(plan().revise_instructions).toBe("4 meals");
    expect(plan().revisions).toHaveLength(1);
    await queueNutritionPlan(sb, SUB, { fresh: true });
    expect(plan().status).toBe("pending");
    expect(plan().revise_instructions).toBeNull();
    expect(plan().revisions).toEqual([]);
  });

  it("Undo puts back the plan from before the last update", async () => {
    const { sb, plan } = db({
      status: "ready",
      targets_text: "T2",
      meal_plan_text: "M2",
      revisions: [
        { at: OLD, instructions: "first", before: { targets_text: "T0", meal_plan_text: "M0" } },
        { at: OLD, instructions: "second", before: { targets_text: "T1", meal_plan_text: "M1" } },
      ],
    });
    const res = await undoNutritionRevision(sb, SUB);
    expect(res.instructions).toBe("second");
    expect(plan().targets_text).toBe("T1");
    expect(plan().meal_plan_text).toBe("M1");
    expect(plan().revisions).toHaveLength(1);
  });

  it("only output that still reads as a plan replaces it", () => {
    const targets = "CALORIE TARGETS\nTraining Day: 2400\n\nMACRO TARGETS\nTraining Day\nProtein: 190";
    expect(revisionLooksRight("targets", targets, targets.replace("2400", "2300"))).toBe(true);
    expect(revisionLooksRight("targets", targets, "Sure! What would you like me to change about the targets?")).toBe(false);
    const meals = "PHASE: Fat Loss\n\nTRAINING-DAY MENU\nMeal 1\n200 g chicken breast\n\nDaily Total\nApproximately 190 g protein";
    expect(revisionLooksRight("meals", meals, meals.replace("chicken breast", "salmon"))).toBe(true);
    expect(revisionLooksRight("meals", meals, "Meal 1\n200 g salmon")).toBe(false);
  });

  it("the update prompt keeps the plan and puts the coach's words last", () => {
    const qas: QA[] = [
      { label: "Any allergies? list all and explain", value: "shellfish" },
      { label: "How many meals can you have per day? (3 minimum)", value: "5" },
    ];
    const p = reviseMealPlanUserPrompt({
      qas,
      targetsText: "CALORIE TARGETS\nTraining Day: 2400",
      mealPlanText: "TRAINING-DAY MENU\nMeal 1\n200 g chicken breast",
      instructions: "swap the beef for salmon on rest days",
    });
    expect(p).toContain("Do not build a new plan");
    expect(p).toContain("- Allergies / dislikes: shellfish");
    expect(p).toContain("TARGETS (match each menu's Daily Total");
    expect(p).toContain("CURRENT MEAL PLAN:\nTRAINING-DAY MENU");
    expect(p.trim().endsWith("COACH INSTRUCTIONS:\nswap the beef for salmon on rest days")).toBe(true);
    expect(p).not.toContain("CURRENT MEALS (the plan the client is on now)");
    expect(REVISE_TARGETS_PROMPT).toContain("change no number");
    expect(manualRevisePrompt({ qas, targetsText: "", mealPlanText: "x", instructions: "y" }).startsWith(MEAL_PLAN_PROMPT)).toBe(true);
  });

  it("is coach-only, written in the background, and Regenerate starts fresh", () => {
    const fns = readFileSync("src/lib/nutrition-ai-plans.functions.ts", "utf8");
    const revise = fns.slice(fns.indexOf("export const reviseNutritionPlanFn"), fns.indexOf("export const undoNutritionRevisionFn"));
    expect(revise).toContain("Coach access required");
    expect(revise).toContain("queueNutritionRevision(");
    expect(revise).not.toContain("runRevision(");
    expect(fns).toContain("fresh: staff && !!data.force");
    const server = readFileSync("src/lib/nutrition-ai-plans.server.ts", "utf8");
    expect(server).toContain("claimed.revise_instructions\n    ? await runRevision(");
  });
});

describe("counted foods in AI meal plans", () => {
  it("asks for bread, bagels, eggs, scoops and fruit by the unit, not the gram", () => {
    expect(MEAL_PLAN_PROMPT).toContain("Foods that come in a unit are counted, never in grams");
    expect(MEAL_PLAN_PROMPT).toContain('"½ bagel"');
    expect(MEAL_PLAN_PROMPT).toContain('"1 scoop whey protein"');
    expect(MEAL_PLAN_PROMPT).toContain("whole or half units only");
  });
});
