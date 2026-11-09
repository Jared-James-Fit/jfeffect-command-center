import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const replies: Array<string | Error> = [];
const asked: string[] = [];
const sent: Array<{ model: string; prompt: string }> = [];
/** Background calls answered from the test: each id holds its answer until polled. */
const background = new Map<string, string | Error>();
const bg = { stillThinking: 0, submitted: 0 };
vi.mock("@/lib/ai/model-client.server", () => {
  class ModelHttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ModelHttpError,
    parseModelRef: (ref: string) => ({
      via: ref.startsWith("openai:") ? "openai" : "gateway",
      family: "openai",
      id: ref,
    }),
    callModel: vi.fn(async (model: string) => {
      asked.push(model);
      const x = replies.shift() ?? "";
      if (x instanceof Error) throw x;
      return { text: x, model, usage: { input: 1, output: 1, reasoning: null }, ms: 1 };
    }),
    submitBackground: vi.fn(async (model: string, r: any) => {
      asked.push(model);
      sent.push({ model, prompt: r.prompt });
      const id = `resp-${++bg.submitted}`;
      background.set(id, replies.shift() ?? "");
      return { id };
    }),
    pollBackground: vi.fn(async (id: string) => {
      if (bg.stillThinking > 0) {
        bg.stillThinking--;
        return { status: "running" };
      }
      const x = background.get(id);
      if (x instanceof Error) return { status: "failed", error: x.message };
      return {
        status: "done",
        reply: { text: x ?? "", usage: { input: 1, output: 1, reasoning: null } },
      };
    }),
  };
});

import {
  coachChecks,
  coachNotesFlags,
  foodLogSummary,
  observedMaintenance,
  parseAiTargets,
  planTotalsIssues,
  safetyNotes,
  targetsMathIssues,
  weeklyAverageKcal,
  weightTrend,
  withoutCoachNotes,
  type WeighIn,
} from "@/lib/nutrition-targets/nutrition-intel";
import { planResults, previousPlanText } from "@/lib/nutrition-history";
import { TARGETS_PROMPT, targetsUserPrompt } from "@/lib/nutrition-ai-prompts";
import { DEFAULT_ROUTES, STRONG_MODELS, resolveRoute } from "@/lib/ai/routing";
import { developmentText } from "@/lib/program-intel/athlete-development";
import { nutritionAthleteText } from "@/lib/nutrition-targets/nutrition-athlete";
import {
  nutritionCall,
  nutritionPollConfig,
  runPlan,
  withPrepFix,
} from "@/lib/nutrition-ai-plans.server";
import { WaitingForModel, type CallState } from "@/lib/ai/staged-call.server";

const day = (start: string, n: number) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Every 2 days from `start`, `kgAt(weeks)` plus an alternating ± scatter. */
const series = (
  start: string,
  count: number,
  kgAt: (weeks: number) => number,
  scatter: number,
): WeighIn[] =>
  Array.from({ length: count }, (_, i) => ({
    date: day(start, i * 2),
    kg: kgAt((i * 2) / 7) + (i % 2 === 0 ? scatter : -scatter),
  }));

describe("bodyweight trend: a line through every weigh-in, with its scatter", () => {
  it("a steady loss reads as a clear trend at its real rate", () => {
    const t = weightTrend(
      series("2026-10-01", 15, (w) => 90 - 0.5 * w, 0.3),
      "2026-10-01",
      "2026-10-29",
    )!;
    expect(t.kgPerWeek).toBeCloseTo(-0.5, 1);
    expect(t.pctPerWeek).toBeCloseTo(-0.56, 1);
    expect(t.weighIns).toBe(15);
    expect(t.clear).toBe(true);
    expect(t.settledFrom).toBeNull();
  });

  it("weight bouncing around a flat line is normal fluctuation, never a trend", () => {
    const t = weightTrend(
      series("2026-10-01", 15, () => 90, 0.6),
      "2026-10-01",
      "2026-10-29",
    )!;
    expect(t.kgPerWeek).toBeCloseTo(0, 5);
    expect(t.noiseKg).toBeGreaterThan(0.5);
    expect(t.clear).toBe(false);
  });

  it("leaves out the plan's first two weeks (water and glycogen) when 3+ weeks remain", () => {
    const early: WeighIn[] = [
      { date: "2026-09-01", kg: 93 },
      { date: "2026-09-04", kg: 91.5 },
      { date: "2026-09-08", kg: 91 },
      { date: "2026-09-12", kg: 90.6 },
    ];
    const settled = series("2026-09-15", 18, (w) => 90 - 0.3 * w, 0.1);
    const t = weightTrend([...early, ...settled], "2026-09-01", "2026-10-20")!;
    expect(t.settledFrom).toBe("2026-09-15");
    expect(t.from).toBe("2026-09-15");
    expect(t.kgPerWeek).toBeCloseTo(-0.3, 1);
  });

  it("never calls a trend from too few weigh-ins or too short a span", () => {
    expect(
      weightTrend(
        series("2026-10-01", 3, (w) => 90 - w, 0),
        "2026-10-01",
        "2026-10-29",
      ),
    ).toBeNull();
    expect(
      weightTrend(
        series("2026-10-01", 6, (w) => 90 - w, 0).map((p, i) => ({
          ...p,
          date: day("2026-10-01", i),
        })),
        "2026-10-01",
        "2026-10-29",
      ),
    ).toBeNull();
  });
});

describe("what they actually ate, and the maintenance it implies", () => {
  it("averages logged days only, in the client's own day", () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({
        at: `${day("2026-10-03", i)}T18:00:00Z`,
        kcal: 2000,
        protein: 180,
        carbs: 200,
        fat: 60,
      })),
      { at: "2026-10-08T14:00:00Z", kcal: 1200, protein: 100, carbs: 120, fat: 40 },
      { at: "2026-10-08T23:00:00Z", kcal: 1000, protein: 80, carbs: 100, fat: 30 },
    ];
    const f = foodLogSummary(entries, "2026-10-01", "2026-10-28", "UTC")!;
    expect(f).toMatchObject({ daysLogged: 6, daysInWindow: 28, kcal: 2033, protein: 180 });
    // 03:00 UTC on Oct 2 is still Oct 1 in Winnipeg
    const late = foodLogSummary(
      [...entries, { at: "2026-10-02T03:00:00Z", kcal: 500, protein: 0, carbs: 0, fat: 0 }],
      "2026-10-01",
      "2026-10-28",
      "America/Winnipeg",
    )!;
    expect(late.daysLogged).toBe(7);
    expect(foodLogSummary(entries.slice(0, 4), "2026-10-01", "2026-10-28")).toBeNull();
  });

  it("the plan's average day follows their week: training days, rest days, one High Day", () => {
    const days = [
      { label: "Training Day", calories: 2300 },
      { label: "Non-Training Day", calories: 2000 },
      { label: "High Day", calories: 2600 },
    ];
    expect(weeklyAverageKcal(days, ["Monday", "Tuesday", "Thursday", "Friday"], "Saturday")).toBe(
      2257,
    );
    expect(weeklyAverageKcal(days, ["Monday", "Tuesday", "Thursday", "Friday"], "Friday")).toBe(
      2214,
    );
    expect(weeklyAverageKcal([{ label: "Training Day", calories: null }], [], null)).toBeNull();
  });

  it("maintenance = what they ate minus the energy in their weight change", () => {
    const trend = weightTrend(
      series("2026-10-01", 15, (w) => 90 - 0.5 * w, 0.3),
      "2026-10-01",
      "2026-10-29",
    );
    const fromPlan = observedMaintenance({ trend, food: null, planKcal: 2257, adherence: 4.5 })!;
    expect(fromPlan.kcal).toBe(2800);
    expect(fromPlan.from).toBe("the plan's calories");
    expect(fromPlan.confidence).toBe("moderate");
    const fromLog = observedMaintenance({
      trend,
      food: { daysLogged: 20, daysInWindow: 29, kcal: 2100, protein: 180, carbs: 200, fat: 60 },
      planKcal: 2257,
      adherence: 3,
    })!;
    expect(fromLog).toMatchObject({ kcal: 2650, from: "logged food", confidence: "high" });
    // didn't stick to it and didn't log: what they ate is unknown, so nothing is claimed
    expect(observedMaintenance({ trend, food: null, planKcal: 2257, adherence: 3 })).toBeNull();
  });

  it("the previous plan's results carry the trend, the food log and the maintenance estimate", () => {
    const weights = series("2026-09-15", 24, (w) => 90 - 0.4 * w, 0.2).map((w) => ({
      date: w.date,
      kg: w.kg,
    }));
    const r = planResults({
      start: "2026-09-15",
      end: "2026-11-01",
      unit: "kg",
      weights,
      checkins: [{ answers: { nutrition_rating: 5 } }, { answers: { nutrition_rating: 4 } }],
      planKcal: 2300,
    });
    expect(r.trend?.clear).toBe(true);
    expect(r.maintenance?.kcal).toBeGreaterThan(2700);
    const text = previousPlanText({
      target_id: "t",
      phase: "Fat Loss",
      goal: null,
      start_date: "2026-09-15",
      weeks_on: 5,
      days: [
        {
          label: "Training Day",
          calories: 2300,
          protein: 200,
          carbs: 230,
          fats: 65,
          fibre: null,
          meals: null,
        },
      ],
      results: r,
    });
    expect(text).toMatch(
      /bodyweight trend \(a line through all 17 weigh-ins from Sep 29, 2026, the plan's first 2 weeks left out for water and glycogen\): −0\.4\d% of bodyweight a week/,
    );
    expect(text).toContain("so this is a clear trend");
    expect(text).toContain("- maintenance their results imply: about");
  });
});

describe("safety: health things in their answers reach the AI and the coach", () => {
  it("finds what needs a professional, and nothing from ordinary words", () => {
    expect(
      safetyNotes([
        { label: "Anything else?", value: "I have a history of an eating disorder" },
        { label: "Medications", value: "Ozempic" },
        { label: "Allergies", value: "none" },
        { label: "When do you eat?", value: "Usually before bed" },
        { label: "Job", value: "Nursing student" },
        { label: "Goal", value: "improve insulin sensitivity" },
      ]),
    ).toEqual(["eating disorder history or signs", "GLP-1 medication"]);
  });

  it("the coach sees floors, macros that don't add up, the weight class rate and health mentions", () => {
    const checks = coachChecks({
      days: [{ label: "Training Day", kcal: 1400, protein: 90, carbs: 120, fat: 30 }],
      bodyweightKg: 90,
      female: false,
      safety: ["GLP-1 medication"],
      weightClassPctPerWeek: 1.4,
    });
    expect(checks).toEqual([
      "Training Day: 1400 kcal listed, but its macros add to 1110 kcal",
      "Training Day: 1400 kcal is under 1500",
      "Training Day: fat 30 g is under 0.5 g per kg of bodyweight",
      "Training Day: protein 90 g is under 1.2 g per kg of bodyweight",
      expect.stringContaining("Making the weight class takes 1.4% of bodyweight a week"),
      "They mentioned GLP-1 medication: plan it with their doctor or a registered dietitian",
    ]);
    expect(
      coachChecks({
        days: [{ label: "Training Day", kcal: 2305, protein: 200, carbs: 230, fat: 65 }],
        bodyweightKg: 90,
        female: false,
        safety: [],
      }),
    ).toEqual([]);
  });
});

const TARGETS = `CLIENT OVERVIEW
Name: Marc
Goal: Fat Loss

CALORIE TARGETS
Training Day: 2,300
Non Training Day: 2060
High Day: 2900

MACRO TARGETS

Training Day
Protein: 200 g
Carbs: 230 g
Fats: 65 g

Non Training Day
Protein: 200
Carbs: 170
Fats: 65

High Day
Protein: 200
Carbs: 290
Fats: 65

DAILY STEPS TARGETS:
Training Day: 10,000

COACH NOTES
Why: trend −0.1% a week at 4.6/5, so −150 kcal from carbs
Watch: squat e1RM
Missing: nothing
Flags: history of an eating disorder, plan with a dietitian`;

describe("the AI's targets, read back and checked", () => {
  it("reads each day type's calories and macros", () => {
    expect(parseAiTargets(TARGETS)).toEqual([
      { label: "Training Day", kcal: 2300, protein: 200, carbs: 230, fat: 65 },
      { label: "Non Training Day", kcal: 2060, protein: 200, carbs: 170, fat: 65 },
      { label: "High Day", kcal: 2900, protein: 200, carbs: 290, fat: 65 },
    ]);
    expect(targetsMathIssues(parseAiTargets(TARGETS))).toEqual([
      "High Day: 2900 kcal listed, but its macros add to 2545 kcal",
    ]);
  });

  it("COACH NOTES stays the coach's: stripped before it reaches the client's plan, its flags read for the coach", () => {
    expect(withoutCoachNotes(TARGETS)).not.toContain("COACH NOTES");
    expect(withoutCoachNotes(TARGETS)).toContain("DAILY STEPS TARGETS:\nTraining Day: 10,000");
    expect(withoutCoachNotes("CALORIE TARGETS\nTraining Day: 2000")).toBe(
      "CALORIE TARGETS\nTraining Day: 2000",
    );
    expect(coachNotesFlags(TARGETS)).toBe("history of an eating disorder, plan with a dietitian");
    expect(coachNotesFlags(TARGETS.replace(/Flags: .*/, "Flags: none"))).toBeNull();
    const publish = readFileSync("src/lib/nutrition-targets/plan-publish.ts", "utf8");
    expect(publish).toContain("admin_notes: withoutCoachNotes(input.targetsText)");
    const panel = readFileSync("src/components/nutrition/NutritionRequestPanel.tsx", "utf8");
    expect(panel).toContain("admin_notes: withoutCoachNotes(plan.targets_text ?? null)");
  });
});

const meal = (n: number) =>
  `Meal ${n}\n150 g cooked chicken breast\n200 g cooked white rice\n\nApproximate macros:\n50 g protein\n60 g carbohydrates\n10 g fat\n2 g fibre\n`;
const plan = (carbsTotal: number) =>
  [
    "PHASE: Fat Loss",
    "",
    "TRAINING-DAY MENU",
    meal(1),
    meal(2),
    "Daily Total",
    `Approximately 100 g protein, ${carbsTotal} g carbohydrates, 20 g fat and 4 g fibre`,
    "",
    "FOOD-WEIGHING RULES",
    "Weigh cooked.",
  ].join("\n");
const SMALL_TARGETS = parseAiTargets(
  "CALORIE TARGETS\nTraining Day: 1060\n\nMACRO TARGETS\n\nTraining Day\nProtein: 100\nCarbs: 120\nFats: 20",
);

describe("a written meal plan is checked against its targets", () => {
  it("names meals that don't add up to the Daily Total and a Daily Total off its target", () => {
    expect(planTotalsIssues(plan(150), SMALL_TARGETS)).toEqual([
      "Training Day: the meals add to 100 g protein, 120 g carbs, 20 g fat, but its Daily Total says 100 / 150 / 20",
      "Training Day: Daily Total is 1180 kcal against a target of 1060 kcal",
    ]);
    expect(planTotalsIssues(plan(120), SMALL_TARGETS)).toEqual([]);
  });

  it("totals that don't hold get the same one fix as meal prep, kept only when it's better", async () => {
    const prompts: string[] = [];
    const out = await withPrepFix(
      plan(150),
      "CLIENT DETAILS",
      async (p) => {
        prompts.push(p);
        return plan(120);
      },
      SMALL_TARGETS,
    );
    expect(out).toBe(plan(120));
    expect(prompts[0]).toContain("FIX THE TOTALS");
    expect(prompts[0]).toContain(
      "- Training Day: Daily Total is 1180 kcal against a target of 1060 kcal",
    );
    expect(prompts[0]).not.toContain("FIX THE MEAL PREP");
    expect(await withPrepFix(plan(150), "x", async () => plan(160), SMALL_TARGETS)).toBe(plan(150));
  });
});

describe("routing: the targets are a coaching decision, the meal plan is writing, all on the OpenAI key", () => {
  it("nutrition targets go only to the strong tier; meal plans on GPT-5.5; nothing through Lovable", () => {
    expect(DEFAULT_ROUTES.nutrition.strongOnly).toBe(true);
    expect(DEFAULT_ROUTES.nutrition.models).toEqual(["openai:gpt-6-astra", "openai:gpt-5.5"]);
    expect(DEFAULT_ROUTES.nutrition.models.every((m) => STRONG_MODELS.includes(m))).toBe(true);
    expect(DEFAULT_ROUTES.nutrition_write.models).toEqual(["openai:gpt-5.5", "openai:gpt-5-mini"]);
    // an override can't hand the targets to a weaker model
    expect(
      resolveRoute("nutrition", { nutrition: ["gateway:google/gemini-3-flash-preview"] }).models,
    ).toEqual(DEFAULT_ROUTES.nutrition.models);
  });

  const sb = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  };
  const before = { ...nutritionPollConfig };
  beforeEach(() => {
    replies.length = 0;
    asked.length = 0;
    background.clear();
    bg.stillThinking = 0;
    bg.submitted = 0;
    Object.assign(nutritionPollConfig, { ms: 0, every: 0 });
    return () => Object.assign(nutritionPollConfig, before);
  });
  const run = (
    state: CallState,
    saves: CallState[],
    task: "nutrition" | "nutrition_write" = "nutrition",
    key = "targets",
  ) =>
    nutritionCall(
      sb,
      state,
      async () => void saves.push(JSON.parse(JSON.stringify(state))),
      task,
      key,
      "s",
      "p",
    );

  it("falls back to the next strong model, never to a weaker one, and says so when none answers", async () => {
    replies.push(new Error("busy"), "CALORIE TARGETS");
    const state: CallState = {};
    const r = await run(state, []);
    expect(r).toEqual({ text: "CALORIE TARGETS", model: "openai:gpt-5.5" });
    expect(asked).toEqual(["openai:gpt-6-astra", "openai:gpt-5.5"]);
    // kept: asking again never calls a model
    expect(await run(state, [])).toEqual(r);
    expect(asked).toHaveLength(2);
    replies.push(new Error("busy"), new Error("busy"));
    await expect(run({}, [])).rejects.toThrow(/aren't handed to a weaker model/);
    expect(asked.every((m) => m.startsWith("openai:"))).toBe(true);
  });

  it("while the model thinks the request hands back, and the next one polls the same call", async () => {
    replies.push("MEAL PLAN");
    bg.stillThinking = 1;
    const state: CallState = {};
    const saves: CallState[] = [];
    await expect(run(state, saves, "nutrition_write", "meals")).rejects.toBeInstanceOf(
      WaitingForModel,
    );
    // the call it's waiting on is saved before the request hands back
    expect(saves.at(-1)?.pending?.meals).toMatchObject({ id: "resp-1", model: "openai:gpt-5.5" });
    const r = await run(state, saves, "nutrition_write", "meals");
    expect(r).toEqual({ text: "MEAL PLAN", model: "openai:gpt-5.5" });
    // submitted once, never twice
    expect(asked).toEqual(["openai:gpt-5.5"]);
    expect(state.pending?.meals).toBeUndefined();
  });

  it("a meal-plan fix still thinking carries on next request instead of dropping the fix", async () => {
    const waiting = withPrepFix(
      plan(150),
      "x",
      async () => {
        throw new WaitingForModel();
      },
      SMALL_TARGETS,
    );
    await expect(waiting).rejects.toBeInstanceOf(WaitingForModel);
  });

  it("the plan writer runs staged on the shared helper, with no Lovable calls left", () => {
    const server = readFileSync("src/lib/nutrition-ai-plans.server.ts", "utf8");
    expect(server).toContain(
      'nutritionCall(sb, progress, save, "nutrition", "targets", TARGETS_PROMPT, progress.targetsPrompt)',
    );
    expect(server).toContain(
      'nutritionCall(sb, progress, save, "nutrition_write", "meals", MEAL_PLAN_PROMPT, mealPrompt)',
    );
    expect(server).toContain("loadNutritionAthlete(sb, sub.client_id)");
    // still thinking: back in line, never an error
    expect(server).toMatch(
      /if \(e instanceof WaitingForModel\) \{\s*await sb\.from\("nutrition_ai_plans"\)\.update\(\{ status: "pending"/,
    );
    // a new run or update starts clean
    expect(server).toMatch(
      /revisions: \[\],\s*\/\/ and a run starts from the beginning\s*progress: null,/,
    );
    // the meal plan is the client's: COACH NOTES never reaches its writer
    expect(server).toContain("mealPlanUserPrompt(mi.qas, withoutCoachNotes(targetsText)");
    expect(server).toContain("targetsText: withoutCoachNotes(targetsText)");
    expect(server).not.toContain("createLovableAiGateway");
    expect(server).not.toContain("global_ai_config");
    const pipeline = readFileSync("src/lib/program-intel/pipeline.server.ts", "utf8");
    expect(pipeline).toContain("stagedCall({");
    const sql = readFileSync(
      "supabase/migrations/20270223090000_nutrition_plans_openai_background.sql",
      "utf8",
    );
    expect(sql).toContain("add column if not exists progress jsonb");
  });
});

describe("the targets AI reasons from the athlete, not a template", () => {
  it("rates and sizes come from their data; the fixed deficits and ratios are gone", () => {
    for (const rule of [
      "their own results beat any formula",
      "when the maintenance their results imply is given, start from it",
      "about 7,700 kcal per kg",
      "strength in a cut: holding the competition lifts' e1RM is success",
      "never plan dehydration, water loading, diuretics",
      "plan this with their doctor or a registered dietitian",
      "COACH NOTES\nWhy:",
    ]) {
      expect(TARGETS_PROMPT).toContain(rule);
    }
    for (const fixed of [
      "fat loss = calorie deficit of 15–25%",
      "muscle gain = calorie surplus of 5–15%",
      "fats = 20–30% of calories",
      "drop 5–10% of calories (about 100–200 kcal)",
    ]) {
      expect(TARGETS_PROMPT).not.toContain(fixed);
    }
  });

  it("the athlete read and the safety notes go in with the client data", () => {
    const p = targetsUserPrompt(
      "Marc",
      [{ label: "Goal", value: "Fat loss" }],
      null,
      null,
      null,
      null,
      { athlete: "ATHLETE (computed…)\nBodyweight now: cutting", safety: ["GLP-1 medication"] },
    );
    expect(p).toContain("ATHLETE (computed…)\nBodyweight now: cutting");
    expect(p).toContain("SAFETY NOTES: their answers mention GLP-1 medication");
    expect(p.trim().endsWith("Goal: Fat loss")).toBe(true);
  });

  const dev: any = {
    age: 30,
    ageCategory: "Open",
    sex: "M",
    heightCm: 180,
    bodyweightKg: 90,
    bodyweightDate: "2026-11-01",
    trainingYears: 4,
    level: "intermediate",
    levelSource: 'from "4 years"',
    monthsWithCoach: 10,
    weightClass: {
      current: { label: "93kg", limitKg: 93 },
      target: "83kg",
      targetLimitKg: 83,
      marginKg: -7,
      weeksOut: 8,
      neededPctPerWeek: 0.97,
    },
    bodyweightGoal: null,
    phase: { phase: "cutting", pctPerWeek: -0.6, kgPerWeek: -0.54, entries: 14 },
    phases: [],
    lifts: [
      {
        lift: "squat",
        reading: "e1RM 200 → 195 kg (−2.5%) through the cut",
        points: 8,
        confidence: "moderate",
        byPhase: [],
        variations: [],
      },
    ],
    gymTotal: null,
    meets: [],
    progression: [
      {
        exercise: "Back Squat",
        decision: "maintain",
        confidence: "moderate",
        why: "on plan",
        method: "same load",
        evidence: [],
      },
    ],
    adherence: { recentPct: 90, earlierPct: 85, trend: "steady", missed: [] },
    fatigue: { signs: [], possible: false },
    missing: [],
  };
  const ctx: any = {
    unit: "kg",
    goals: {
      main: "Compete",
      other: null,
      target: "500 kg total",
      clientGoals: null,
      longTerm: { text: "Qualify for nationals", date: "2027-03-01" },
    },
    competition: {
      next: { name: "Provincials", date: "2027-01-10", weeksOut: 8, weightClass: "83kg" },
    },
  };

  it("nutrition gets the training AI's athlete read without the exercise-by-exercise lines", () => {
    const text = nutritionAthleteText(ctx, dev);
    expect(text).toContain(
      "Goals: main goal: Compete · target: 500 kg total · long-term goal (coach-set): Qualify for nationals by Mar 1, 2027",
    );
    expect(text).toContain(
      "Next meet: Provincials on Jan 10, 2027 (8 weeks out) · weight class 83kg",
    );
    expect(text).toContain(
      "Bodyweight now: cutting (-0.6%/week over the last 5 weeks, 14 weigh-ins)",
    );
    expect(text).toContain("squat: e1RM 200 → 195 kg");
    expect(text).toContain("OVER the limit with 8 weeks to the meet (0.97%/week");
    expect(text).not.toContain("Exercise by exercise");
    // the training AIs keep their exercise-by-exercise read
    expect(developmentText(dev, "kg")).toContain("Exercise by exercise");
  });
});

describe("the athlete read, end to end on a real scenario", () => {
  it("a powerlifter's records go through the training engine into the nutrition text", async () => {
    const { powerlifter } = await import("./program-intel-scenarios");
    const { buildGeneratorIntel } = await import("@/lib/program-intel/intelligence");
    const intel = buildGeneratorIntel(powerlifter());
    const text = nutritionAthleteText(intel.ctx, intel.development);
    expect(
      text.startsWith(
        "ATHLETE (computed from their records in the app; never fill in what isn't here)",
      ),
    ).toBe(true);
    expect(text).toContain("Who: ");
    expect(text).toMatch(/Bodyweight now: /);
    expect(text).toContain("Lifts (competition lift e1RMs");
    expect(text).toMatch(/Adherence: /);
    expect(text).not.toContain("Exercise by exercise");
  });
});

describe("a Nutrition Update plan runs across requests while OpenAI thinks", () => {
  /** Just the tables a run in flight touches once its prompts are built. */
  function fakeDb(progress: any) {
    const row: any = { submission_id: "s1", status: "generating", progress };
    const db = {
      from(table: string) {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () =>
            table === "nf_submissions"
              ? { data: { client_id: "c1" } }
              : table === "nutrition_ai_plans"
                ? { data: { progress: row.progress } }
                : { data: null },
          upsert: async (v: any) => {
            Object.assign(row, v);
            return { error: null };
          },
          update: (v: any) => {
            Object.assign(row, JSON.parse(JSON.stringify(v)));
            return { eq: async () => ({ error: null }) };
          },
        };
        return q;
      },
    };
    return { db, row };
  }
  const TARGETS_REPLY =
    "CALORIE TARGETS\nTraining Day: 1060\n\nMACRO TARGETS\n\nTraining Day\nProtein: 100\nCarbs: 120\nFats: 20\n\nCOACH NOTES\nWhy: secret reasoning\nFlags: none";

  it("hands back while the targets think, then finishes without asking twice", async () => {
    replies.length = 0;
    asked.length = 0;
    sent.length = 0;
    background.clear();
    bg.submitted = 0;
    Object.assign(nutritionPollConfig, { ms: 0, every: 0 });
    replies.push(TARGETS_REPLY, plan(120));
    bg.stillThinking = 1;
    const { db, row } = fakeDb({
      kind: "plan",
      calls: {},
      pending: {},
      targetsPrompt: "CLIENT DATA",
      meals: { qas: [], phase: "Fat Loss", workoutMeals: "auto", history: null, previousMeals: "" },
    });

    expect(await runPlan(db, "s1")).toEqual({ status: "pending" });
    expect(row.status).toBe("pending");
    expect(row.progress.pending.targets).toMatchObject({
      id: "resp-1",
      model: "openai:gpt-6-astra",
    });

    expect(await runPlan(db, "s1")).toEqual({ status: "ready" });
    expect(row).toMatchObject({
      status: "ready",
      progress: null,
      targets_text: TARGETS_REPLY,
      meal_plan_text: plan(120),
      model: "targets openai:gpt-6-astra · meals openai:gpt-5.5",
    });
    // the targets were submitted once; the meal plan never saw COACH NOTES
    expect(asked).toEqual(["openai:gpt-6-astra", "openai:gpt-5.5"]);
    expect(sent[1].prompt).not.toContain("secret reasoning");
  });
});
