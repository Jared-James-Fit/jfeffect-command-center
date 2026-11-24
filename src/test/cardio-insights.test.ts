import { describe, expect, it } from "vitest";
import { buildCardioRead, type CardioReadInput } from "@/lib/cardio/insights";
import { planFacts, scoreCardioPlan, type CardioScoreContext } from "@/lib/cardio/quality";
import { newSession, type CardioPlan } from "@/lib/cardio/plan";
import { scoreNutritionPlan, type NutritionScoreContext } from "@/lib/nutrition-targets/plan-quality";
import { consolidate } from "@/lib/coaching-recommendation/consolidate";

const base = (over: Partial<CardioReadInput> = {}): CardioReadInput => ({
  today: "2026-11-23",
  plan: { empty: false, minutes: 120, sessions: 5, hardMinutes: 0, avgRpe: 4, highImpactSessions: 0, beforeLifting: 0, dayBeforeHeavyLower: 0, trainingDayMinutesMax: 15, biggestDayShare: 0.25, days: 5 },
  goal: { direction: "lose", status: "on_track", pctPerWeek: -0.5, trendClear: true },
  adherence: { done: 18, planned: 20 },
  prescribedTrend: { recent: 120, prior: 120 },
  performance: { lower: "steady", detail: "Squat steady, Deadlift steady over the last 8 weeks (comparable sets)." },
  trainingRating: { recent: 4, prior: 4 },
  volume: { recent: 60, prior: 60 },
  checkins: { count: 4, poorSleep: 0, lowEnergy: 0, stress: 0, hungerHigh: false, cardioIssues: [] },
  wearables: { restingHr: null, hrv: null, sleepHours: null },
  feedback: { recovery: 4, sessions: 6 },
  steps: 8000,
  meetWeeksOut: null,
  walkingLimits: [],
  powerlifter: false,
  wm: { verdict: "maintain", limiting: "none", cardio: null, nutrition: false, headline: "Progressing: leave it alone" },
  ...over,
});

describe("cardio's recovery and performance read", () => {
  it("holds a plan that's working (the usual answer)", () => {
    const r = buildCardioRead(base());
    expect(r.primary.kind).toBe("maintain");
    expect(r.others).toHaveLength(0);
  });

  it("calls strength dropping after cardio went up a pattern, never a cause, and names other explanations", () => {
    const r = buildCardioRead(
      base({
        performance: { lower: "down", detail: "Squat down 4% over the last 8 weeks (comparable sets)." },
        prescribedTrend: { recent: 180, prior: 120 },
        checkins: { count: 3, poorSleep: 2, lowEnergy: 0, stress: 0, hungerHigh: false, cardioIssues: ["Legs tired for lifting"] },
      }),
    );
    expect(r.primary.kind).toBe("reduce");
    expect(r.primary.relation).toBe("pattern");
    expect(r.primary.observation).toContain("lines up with");
    expect(r.primary.observation).not.toMatch(/\.,/);
    expect(r.primary.alternatives).toContain("poor sleep");
    expect(r.primary.ask).toContain("120");
  });

  it("moves cardio away from heavy lifting before cutting it", () => {
    const r = buildCardioRead(base({ performance: { lower: "down", detail: "Deadlift down 3%" }, plan: { ...base().plan, beforeLifting: 2 } }));
    expect(r.primary.kind).toBe("move_away");
  });

  it("doesn't blame cardio when nothing on the cardio side lines up", () => {
    const r = buildCardioRead(base({ performance: { lower: "down", detail: "Squat down 4%" } }));
    expect(r.primary.kind).toBe("collect_data");
    expect(r.primary.title).toMatch(/isn't the likely reason/);
  });

  it("asks why before changing numbers when sessions aren't happening", () => {
    const r = buildCardioRead(base({ adherence: { done: 6, planned: 20 } }));
    expect(r.primary.kind).toBe("collect_data");
    const noTime = buildCardioRead(base({ adherence: { done: 6, planned: 20 }, checkins: { ...base().checkins, cardioIssues: ["No time"] } }));
    expect(noTime.primary.kind).toBe("redistribute");
  });

  it("never recommends cardio to someone who doesn't need it", () => {
    const r = buildCardioRead(base({ plan: { ...base().plan, empty: true, minutes: 0, sessions: 0 }, goal: { direction: "gain", status: "on_track", pctPerWeek: 0.2, trendClear: true } }));
    expect(r.primary.kind).toBe("maintain");
    expect(r.primary.title).toBe("No cardio needed right now");
  });

  it("follows the weight-management engine on energy balance (one lever at a time)", () => {
    const up = buildCardioRead(base({ wm: { verdict: "adjust", limiting: "energy_balance", cardio: "up", nutrition: false, headline: "Behind: add a little output" } }));
    expect(up.primary.kind).toBe("increase");
    const food = buildCardioRead(base({ wm: { verdict: "adjust", limiting: "energy_balance", cardio: null, nutrition: true, headline: "Behind: 150 kcal less" } }));
    expect(food.primary.kind).toBe("adjust_nutrition");
  });

  it("keeps cardio easy close to a meet", () => {
    const r = buildCardioRead(base({ meetWeeksOut: 1.5, plan: { ...base().plan, hardMinutes: 40 } }));
    expect(r.primary.kind).toBe("lower_intensity");
    expect(r.primary.title).toMatch(/meet/);
  });

  it("labels each signal measured or reported", () => {
    const r = buildCardioRead(base({ wearables: { restingHr: { recent: 62, baseline: 55 }, hrv: { recent: 40, baseline: 55 }, sleepHours: 6 } }));
    expect(r.signals.find((s) => s.key === "rhr")!.source).toBe("measured");
    expect(r.signals.find((s) => s.key === "rhr")!.status).toBe("flag");
    expect(r.signals.find((s) => s.key === "training_feel")!.source).toBe("reported");
  });
});

const ctx: CardioScoreContext = {
  trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"],
  highDays: [],
  direction: "lose",
  context: "fat_loss",
  trendStatus: "on_track",
  heavyLowerDays: ["Monday", "Thursday"],
  powerlifter: false,
  walkingLimits: [],
  meetWeeksOut: null,
  adherence: { done: 18, planned: 20 },
  issues: [],
  recoveryFlags: 0,
  steps: 8000,
  bodyweightKg: 85,
  lastChanged: "2026-10-01",
  today: "2026-11-23",
  checkins: 4,
};

describe("cardio plan quality", () => {
  const good: CardioPlan = {
    sessions: [
      { ...newSession("treadmill_incline", "non_training", ctx), minutes: 30, progression: { kind: "incline", step: 1, everyWeeks: 2, cap: 10 } },
      { ...newSession("treadmill_flat", "training", ctx), minutes: 10, timing: "after_lifting", rpeMin: 3, rpeMax: 3 },
    ],
  };

  it("scores a sensible fat-loss plan as strong, with confidence", () => {
    const q = scoreCardioPlan(good, ctx);
    expect(q.score).toBeGreaterThanOrEqual(85);
    expect(q.confidence).toBe("high");
    expect(q.categories).toHaveLength(7);
  });

  it("marks down hard cardio before lifting and the day before heavy legs, and says so", () => {
    const bad: CardioPlan = {
      sessions: [{ ...newSession("run", "weekdays", ctx), weekdays: ["Wednesday", "Sunday", "Monday"], minutes: 40, rpeMin: 7, rpeMax: 8, timing: "before_lifting" }],
    };
    const q = scoreCardioPlan(bad, ctx);
    const training = q.categories.find((c) => c.key === "training")!;
    expect(training.score!).toBeLessThan(80);
    expect(training.notes.join(" ")).toMatch(/before lifting|day before a heavy/);
    expect(q.score!).toBeLessThan(scoreCardioPlan(good, ctx).score!);
    expect(q.optimize).toContain("Optimize the cardio plan");
  });

  it("doesn't reward an aggressive plan over a suitable one", () => {
    const lots: CardioPlan = { sessions: [{ ...newSession("stair_climber", "daily", ctx), minutes: 60, rpeMin: 7, rpeMax: 8 }] };
    expect(scoreCardioPlan(lots, ctx).score!).toBeLessThan(scoreCardioPlan(good, ctx).score!);
  });

  it("an empty plan for a building goal is fine; with no goal there's nothing to score", () => {
    expect(scoreCardioPlan({ sessions: [] }, { ...ctx, direction: "gain", context: "gain" }).score).toBe(100);
    const none = scoreCardioPlan({ sessions: [] }, { ...ctx, direction: null, context: null, trainingDays: [] });
    expect(none.categories.find((c) => c.key === "goal")!.score).toBeNull();
  });

  it("what they said about their legs counts against recovery, and says why", () => {
    const tired = scoreCardioPlan(good, { ...ctx, issues: ["Legs tired for lifting"] });
    const recovery = tired.categories.find((c) => c.key === "recovery")!;
    expect(recovery.notes.join(" ")).toMatch(/legs tired for lifting/);
    expect(tired.score!).toBeLessThan(scoreCardioPlan(good, ctx).score!);
  });

  it("reads the plan's shape for the recovery read", () => {
    const f = planFacts({ sessions: [{ ...newSession("run", "weekdays", ctx), weekdays: ["Wednesday"], minutes: 30, rpeMin: 6, rpeMax: 7 }] }, ctx);
    expect(f.dayBeforeHeavyLower).toBe(1);
    expect(f.highImpactSessions).toBe(1);
  });
});

describe("nutrition plan quality", () => {
  const nctx: NutritionScoreContext = {
    direction: "lose",
    sex: "M",
    bodyweightKg: 85,
    weeklyKcal: 2300,
    maintenance: 2700,
    trend: { pctPerWeek: -0.5, clear: true },
    trendStatus: "on_track",
    adherence: 4.3,
    hungerHigh: false,
    recoveryFlags: 0,
    trainingDays: 4,
    powerlifter: false,
    meetWeeksOut: null,
    conflicts: [],
    restrictions: 1,
    hasMeals: true,
    safety: [],
    checkins: 4,
  };
  const days = [
    { label: "Training Day", kcal: 2450, protein: 180, carbs: 260, fats: 75, kind: "training" as const },
    { label: "Rest Day", kcal: 2100, protein: 180, carbs: 190, fats: 70, kind: "rest" as const },
  ];

  it("scores a well-built cut as strong", () => {
    const q = scoreNutritionPlan(days, nctx);
    expect(q.score!).toBeGreaterThanOrEqual(85);
  });

  it("catches calories that don't add up from their macros, a too-low floor, and low protein", () => {
    const q = scoreNutritionPlan(
      [
        { label: "Training Day", kcal: 2600, protein: 100, carbs: 260, fats: 70, kind: "training" },
        { label: "Rest Day", kcal: 1300, protein: 90, carbs: 120, fats: 40, kind: "rest" },
      ],
      nctx,
    );
    const cal = q.categories.find((c) => c.key === "calories")!;
    expect(cal.notes.join(" ")).toMatch(/under 1,500/);
    expect(cal.notes.join(" ")).toMatch(/from its macros/);
    expect(q.categories.find((c) => c.key === "macros")!.notes[0]).toMatch(/Protein/);
  });

  it("an allergen on the plan sinks food compatibility", () => {
    const q = scoreNutritionPlan(days, { ...nctx, conflicts: ["cooked shrimp (shellfish allergy)"] });
    expect(q.categories.find((c) => c.key === "food")!.score!).toBeLessThanOrEqual(60);
  });

  it("says when it can't judge", () => {
    const q = scoreNutritionPlan(days, { ...nctx, direction: null, maintenance: null, bodyweightKg: null, adherence: null, trendStatus: null, checkins: 0 });
    expect(q.confidence === "low" || q.confidence === "insufficient").toBe(true);
    expect(q.missing).toContain("A recent bodyweight");
  });
});

describe("one coordinated recommendation", () => {
  const cardioHold = buildCardioRead(base());
  it("holds when nothing calls for a change", () => {
    const r = consolidate({ verdict: "maintain", limiting: "none", headline: "Progressing: leave it alone", reasons: ["On track"], evidence: "moderate", actions: [], expected: null, reviewInDays: 14, material: false }, cardioHold);
    expect(r.hold).toBe(true);
    expect(r.items[0].recommendation).toMatch(/Hold/);
  });

  it("never sends a food change and a cardio increase together", () => {
    const tooEasy = buildCardioRead(base({ checkins: { ...base().checkins, cardioIssues: ["Too easy"] } }));
    expect(tooEasy.primary.kind).toBe("increase");
    const r = consolidate(
      {
        verdict: "adjust",
        limiting: "energy_balance",
        headline: "Behind: about 150 kcal less a day",
        reasons: ["Losing 0.1% a week against 0.5% needed"],
        evidence: "strong",
        actions: [{ kind: "nutrition", kcalPerDay: -150, from: "carbs", instruction: "Take 150 kcal off from carbs" }],
        expected: "About 0.3% a week",
        reviewInDays: 14,
        material: true,
      },
      tooEasy,
    );
    expect(r.items.map((i) => i.domain)).toEqual(["nutrition"]);
    expect(r.items[0].action).toEqual({ kind: "nutrition_change", instruction: "Take 150 kcal off from carbs" });
  });

  it("puts a cardio interference read beside a hold on food", () => {
    const interference = buildCardioRead(base({ performance: { lower: "down", detail: "Squat down 4%" }, plan: { ...base().plan, beforeLifting: 2 } }));
    const r = consolidate(null, interference);
    expect(r.items[0].domain).toBe("cardio");
    expect(r.items[0].reason).toMatch(/not a confirmed cause/);
    expect(r.items[0].action.kind).toBe("cardio_draft");
  });
});
