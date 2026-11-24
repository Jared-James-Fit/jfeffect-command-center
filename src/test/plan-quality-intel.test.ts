import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CRITICAL_LOW, FOLLOW_CONCERN, finishQuality, isReviewAsk, MIN_JUDGED, OPPORTUNITY_BELOW, opportunitiesOf, optimizeAskFrom, SETTLE_DAYS, UNPROVEN_MAX, verdictOf, WEAK_SPOT, type QualityCategory, type QualityConcern } from "@/lib/plan-quality";
import { briefAsk, briefItems } from "@/components/plan-quality/plan-intelligence";
import { scoreProgram, type ProgramQualityContext } from "@/lib/program-quality";
import type { CheckExercise, CheckInput } from "@/lib/program-check";
import { scoreCardioPlan, type CardioScoreContext } from "@/lib/cardio/quality";
import { newSession, pickChanges, diffPlans, type CardioPlan } from "@/lib/cardio/plan";
import { mealFactsOf, scoreNutritionPlan, type NutritionScoreContext } from "@/lib/nutrition-targets/plan-quality";

const read = (p: string) => readFileSync(p, "utf8");
const cat = (key: string, score: number | null, weight = 0.2, note = `${key} note`): QualityCategory => ({ key, label: key[0].toUpperCase() + key.slice(1), score, weight, notes: [note] });

describe("one quality model: design apart from how it's followed", () => {
  const good = [cat("goal", 92), cat("recovery", 88), cat("dose", 90)];
  const weak = [cat("goal", 92), cat("sustain", 40, 0.2, "Cardio every day with a lot of minutes"), cat("dose", 90)];
  const weakElsewhere = [cat("goal", 92), cat("recovery", 40, 0.2, "Hard cardio the day before heavy squats"), cat("dose", 90)];

  it("a sound plan they aren't following is a conversation, not a rewrite", () => {
    const v = verdictOf(90, good, { adherence: { pct: 45, label: "9 of 20" }, outcome: null });
    expect(v.kind).toBe("follow_through");
    expect(v.action).toBe("review");
    expect(v.headline).toMatch(/struggling to follow \(45%\)/);
  });

  it("low adherence with a weak spot in the plan is practicality, and names the weak spot", () => {
    const v = verdictOf(70, weak, { adherence: { pct: 50, label: "" }, outcome: null });
    expect(v.kind).toBe("practicality");
    expect(v.action).toBe("act");
    expect(v.headline).toMatch(/sustain may be why: cardio every day/i);
  });

  it("low adherence never blames a part of the plan that isn't about keeping it up", () => {
    const v = verdictOf(70, weakElsewhere, { adherence: { pct: 50, label: "" }, outcome: null });
    expect(v.kind).toBe("follow_through");
    expect(v.headline).toMatch(/talk through what's getting in the way\. Separately, recovery could be better/);
  });

  it("followed well but not working needs changing even when it looks right on paper", () => {
    const v = verdictOf(90, good, { adherence: { pct: 92, label: "" }, outcome: { status: "behind", label: "Bodyweight is behind the goal" } });
    expect(v.kind).toBe("results");
    expect(v.action).toBe("act");
    const unknown = verdictOf(90, good, { adherence: null, outcome: { status: "behind", label: "Bodyweight is behind the goal" } });
    expect(unknown.action).toBe("review");
  });

  it("working: well designed, followed and on track says keep it as is", () => {
    const v = verdictOf(90, good, { adherence: { pct: 90, label: "" }, outcome: { status: "on_track", label: "" } });
    expect(v.kind).toBe("working");
    expect(v.action).toBe("none");
    expect(v.headline).toBe("Keep it as is: well designed, followed (90%) and results are on track.");
  });

  it("asks Cleo for what matters most in order, with now vs proposed, why and the effect", () => {
    const opp = opportunitiesOf([cat("a", 50, 0.3), cat("b", 80, 0.1), cat("c", 95, 0.6)]);
    expect(opp.map((o) => o.key)).toEqual(["a", "b"]);
    expect(opp[0].impact).toBe("high");
    const q = finishQuality([cat("a", 50, 0.3), cat("c", 95, 0.6)], { what: "cardio plan", points: 4, missing: [] });
    expect(q.optimize).toMatch(/^Optimize the cardio plan\. What matters most for them, in order:\n1\. a note/);
    expect(q.optimize).toMatch(/what it is now, what you'd change it to, why, and the effect you expect/);
    expect(q.optimize).toMatch(/Keep what's working: c: c note/);
    expect(q.optimize).toMatch(/Don't change anything just to tidy the plan/);
    expect(optimizeAskFrom("x", { ...q, opportunities: [], concerns: [] })).toBeNull();
  });

  it("working on its own terms but pulled on by another plan is worth a look, and says why", () => {
    const q = finishQuality([cat("goal", 95), cat("dose", 92)], { what: "cardio plan", points: 4, missing: [], execution: { adherence: { pct: 90, label: "" }, outcome: null }, connections: [{ domain: "training", text: "Harder cardio lands the day before heavy squat or deadlift days (Mon, Thu)" }] });
    expect(q.verdict.kind).toBe("watch");
    expect(q.verdict.action).toBe("review");
    expect(q.verdict.headline).toBe("Well designed and followed (90%). Across their plans: harder cardio lands the day before heavy squat or deadlift days (Mon, Thu).");
  });

  it("never scores a plan with nothing to judge", () => {
    const q = finishQuality([cat("a", null)], { what: "x", points: 0, missing: ["A goal"] });
    expect(q.score).toBeNull();
    expect(q.confidence).toBe("insufficient");
    expect(q.verdict.kind).toBe("insufficient");
  });
});

/* ── the workout score ── */

const EX: Array<[string, string, Partial<CheckExercise>?]> = [
  ["sq", "Barbell Back Squat", { competition_lift_type: "squat" }],
  ["rdl", "Romanian Deadlift"],
  ["dl", "Competition Deadlift", { competition_lift_type: "deadlift", is_competition_lift: true }],
  ["lext", "Leg Extension"],
  ["lcurl", "Lying Leg Curl"],
  ["bp", "Barbell Bench Press", { competition_lift_type: "bench" }],
  ["idb", "Incline Dumbbell Press"],
  ["pd", "Lat Pulldown"],
  ["row", "Seated Cable Row"],
  ["lat", "Dumbbell Lateral Raise"],
  ["push", "Cable Triceps Pushdown"],
  ["curl", "Dumbbell Curl"],
  ["ht", "Barbell Hip Thrust"],
  ["calf", "Standing Calf Raise"],
];
const exercises = new Map<string, CheckExercise>(EX.map(([id, name, extra]) => [id, { id, name, video_url: "x", exercise_category: null, ...(extra ?? {}) }]));
const row = (exercise_id: string, sets: number, reps: string, rpe: string | null, extra: Record<string, unknown> = {}) => ({ exercise_id, sets, reps_text: reps, rpe, ...extra });

function hypertrophyBlock(weeks = 5, rpeFor = (w: number) => String(7 + Math.min(2, w * 0.5))) {
  return {
    id: "b1",
    name: "Hypertrophy",
    blockType: "hypertrophy",
    weeks: Array.from({ length: weeks }, (_, w) => ({
      week_index: w + 1,
      days: [
        { day_index: 1, subtitle: "Upper A", rows: [row("bp", 4, "6-10", rpeFor(w)), row("row", 4, "8-12", rpeFor(w)), row("idb", 3, "8-12", rpeFor(w)), row("lat", 3, "12-15", rpeFor(w)), row("push", 3, "10-15", rpeFor(w)), row("curl", 3, "10-15", rpeFor(w))] },
        { day_index: 2, subtitle: "Lower A", rows: [row("sq", 4, "6-10", rpeFor(w)), row("rdl", 3, "8-10", rpeFor(w)), row("lext", 3, "10-15", rpeFor(w)), row("lcurl", 3, "10-15", rpeFor(w)), row("calf", 3, "10-15", rpeFor(w))] },
        { day_index: 3, subtitle: "Upper B", rows: [row("idb", 4, "8-12", rpeFor(w)), row("pd", 4, "8-12", rpeFor(w)), row("bp", 3, "8-10", rpeFor(w)), row("row", 3, "10-12", rpeFor(w)), row("lat", 3, "12-15", rpeFor(w)), row("push", 3, "10-15", rpeFor(w))] },
        { day_index: 4, subtitle: "Lower B", rows: [row("ht", 4, "8-12", rpeFor(w)), row("sq", 3, "8-10", rpeFor(w)), row("lcurl", 3, "10-15", rpeFor(w)), row("lext", 3, "12-15", rpeFor(w)), row("calf", 3, "10-15", rpeFor(w))] },
      ],
    })),
  };
}

const pctx = (over: Partial<ProgramQualityContext> = {}): ProgramQualityContext => ({
  today: "2026-11-24",
  level: "intermediate",
  style: "bodybuilding",
  trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"],
  meet: null,
  blocks: [{ name: "Hypertrophy", start: "2026-11-02", end: "2026-12-06", current: true }],
  direction: "maintain",
  deficitPct: null,
  recoveryFlags: 0,
  lowerPerformance: "steady",
  cardio: null,
  adherence: { done: 15, planned: 16 },
  effort: null,
  checkins: 4,
  ...over,
});
const input = (blocks: any[], athlete: CheckInput["athlete"] = { sessionLimit: { minutes: 75, source: "goals", pt: null, stated: 75, phrase: "", short: "75 min" }, equipment: null, pain: [] }): CheckInput => ({ kind: "client", style: "bodybuilding", blocks, exercises, athlete });

describe("workout plan quality", () => {
  it("scores a sensible intermediate hypertrophy program as good or strong, with what's working", () => {
    const q = scoreProgram(input([hypertrophyBlock()]), pctx());
    expect(q.score!).toBeGreaterThanOrEqual(78);
    expect(q.categories.map((c) => c.key)).toEqual(["goal", "selection", "dose", "fatigue", "progression", "order", "individual", "duration"]);
    expect(q.strengths.length).toBeGreaterThan(0);
    expect(q.execution.adherence?.pct).toBe(94);
  });

  it("isn't a template: the same program is light for an advanced lifter and fine for a beginner", () => {
    const thin = hypertrophyBlock();
    for (const w of thin.weeks) for (const d of w.days) d.rows = d.rows.slice(0, 2);
    const adv = scoreProgram(input([thin]), pctx({ level: "advanced" }));
    const beg = scoreProgram(input([thin]), pctx({ level: "beginner" }));
    const dose = (q: any) => q.categories.find((c: any) => c.key === "dose")!.score;
    expect(dose(adv)).toBeLessThan(dose(beg));
    expect(adv.categories.find((c) => c.key === "dose")!.notes[0]).toMatch(/advanced lifter/);
  });

  it("a heavy, low-rep program doesn't fit a muscle-building goal", () => {
    const heavy = hypertrophyBlock();
    for (const w of heavy.weeks) for (const d of w.days) for (const r of d.rows) r.reps_text = "3";
    const q = scoreProgram(input([heavy]), pctx());
    expect(q.categories.find((c) => c.key === "goal")!.score!).toBeLessThan(85);
    expect(q.categories.find((c) => c.key === "goal")!.notes.join(" ")).toMatch(/1–5 reps for a muscle-building goal/);
  });

  it("main lifts that never change are a progression gap", () => {
    const flat = hypertrophyBlock(5, () => "8");
    const q = scoreProgram(input([flat]), pctx());
    expect(q.categories.find((c) => c.key === "progression")!.notes[0]).toMatch(/stay the same every week/);
    expect(q.opportunities.map((o) => o.key)).toContain("progression");
  });

  it("a meet in 5 weeks with no peak or taper is the timeline's problem", () => {
    const q = scoreProgram(input([hypertrophyBlock()]), pctx({ style: "powerlifting", meet: { name: "Provincials", date: "2026-12-29", weeksOut: 5 } }));
    const t = q.categories.find((c) => c.key === "timeline")!;
    expect(t.score!).toBeLessThan(80);
    expect(t.notes.join(" ")).toMatch(/No peak or taper/);
    // a squat, bench and deadlift variation each week, but no competition lift 5 weeks out
    expect(q.categories.find((c) => c.key === "goal")!.notes.join(" ")).toMatch(/Only bench variations 5 weeks from the meet/);
  });

  it("reads their other plans: cardio the day before heavy legs and a deficit with high volume", () => {
    const q = scoreProgram(input([hypertrophyBlock()]), pctx({ cardio: { minutes: 150, hardMinutes: 40, highImpact: 1, dayBeforeHeavyLower: 2, beforeLifting: 0 }, direction: "lose", deficitPct: -15 }));
    expect(q.connections.map((c) => c.domain)).toEqual(expect.arrayContaining(["cardio", "nutrition"]));
    expect(q.categories.find((c) => c.key === "fatigue")!.notes.join(" ")).toMatch(/day before heavy squat/);
  });

  it("low adherence on a long-session program is practicality, never just a lower design score", () => {
    const q = scoreProgram(input([hypertrophyBlock()], { sessionLimit: { minutes: 45, source: "goals", pt: null, stated: 45, phrase: "", short: "45 min" }, equipment: null, pain: [] }), pctx({ adherence: { done: 6, planned: 16 } }));
    expect(q.categories.find((c) => c.key === "duration")!.notes.join(" ")).toMatch(/workouts run well past 45 min|a little over 45 min/);
    expect(q.verdict.kind).toBe("practicality");
  });

  it("singles for a beginner are flagged under individualization", () => {
    const b = hypertrophyBlock();
    b.weeks[0].days[1].rows[0] = row("sq", 3, "1", "9.5");
    const q = scoreProgram(input([b]), pctx({ level: "beginner" }));
    expect(q.categories.find((c) => c.key === "individual")!.notes.join(" ")).toMatch(/beginner/);
  });

  it("nothing left to train says plan the next block, with no number", () => {
    const b = hypertrophyBlock(1);
    const q = scoreProgram({ ...input([b]), locked: () => true }, pctx());
    expect(q.score).toBeNull();
    expect(q.verdict.headline).toMatch(/Plan their next block/);
  });
});

/* ── cardio audit ── */

const cctx: CardioScoreContext = {
  trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"],
  highDays: [],
  direction: "lose",
  context: "fat_loss",
  trendStatus: null,
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

describe("cardio plan quality (audit)", () => {
  const light: CardioPlan = { sessions: [{ ...newSession("treadmill_incline", "weekdays", cctx), weekdays: ["Wednesday"], minutes: 30 }] };

  it("results only count as evidence about the dose: on track is enough, behind while followed isn't", () => {
    const goal = (t: string | null) => scoreCardioPlan(light, { ...cctx, trendStatus: t }).categories.find((c) => c.key === "goal")!.score!;
    expect(goal("on_track")).toBeGreaterThan(goal(null));
    expect(goal("behind")).toBeLessThan(goal(null));
    // behind but barely done: not the dose's fault
    expect(scoreCardioPlan(light, { ...cctx, trendStatus: "behind", adherence: { done: 4, planned: 20 } }).categories.find((c) => c.key === "goal")!.score).toBe(goal(null));
  });

  it("low adherence alone never marks down sustainability; it corroborates a plan that's hard to keep", () => {
    const sustain = (p: CardioPlan, done: number) => scoreCardioPlan(p, { ...cctx, adherence: { done, planned: 20 } }).categories.find((c) => c.key === "sustain")!.score!;
    expect(sustain(light, 6)).toBe(sustain(light, 19));
    const long: CardioPlan = { sessions: [{ ...newSession("treadmill_flat", "daily", cctx), minutes: 50 }] };
    expect(sustain(long, 6)).toBeLessThan(sustain(long, 19));
    expect(scoreCardioPlan(light, { ...cctx, adherence: { done: 6, planned: 20 } }).verdict.kind).toBe("follow_through");
  });

  it("says what their training means for it", () => {
    const eve: CardioPlan = { sessions: [{ ...newSession("run", "weekdays", cctx), weekdays: ["Wednesday"], minutes: 30, rpeMin: 6, rpeMax: 7 }] };
    const q = scoreCardioPlan(eve, { ...cctx, lowerPerformance: "down" });
    expect(q.connections.map((c) => c.text).join(" ")).toMatch(/day before heavy squat or deadlift days \(Mon, Thu\)/);
    expect(q.connections.map((c) => c.text).join(" ")).toMatch(/a pattern, not a confirmed cause/);
  });

  it("Cleo's proposal can be applied change by change", () => {
    const a = { ...newSession("treadmill_incline", "non_training", cctx), key: "a", minutes: 30 };
    const b = { ...newSession("bike", "weekdays", cctx), key: "b", weekdays: ["Saturday" as const], minutes: 40 };
    const base: CardioPlan = { sessions: [a, b] };
    const proposed: CardioPlan = { sessions: [{ ...a, minutes: 35 }, { ...newSession("treadmill_flat", "training", cctx), key: "c", minutes: 10 }] };
    const changes = diffPlans(base, proposed, cctx, "mph");
    expect(changes.map((c) => `${c.kind}:${c.key}`).sort()).toEqual(["added:c", "changed:a", "removed:b"]);
    const onlyA = pickChanges(base, proposed, new Set(["a"]));
    expect(onlyA.sessions.map((s) => `${s.key}:${s.minutes}`)).toEqual(["a:35", "b:40"]);
    const addAndRemove = pickChanges(base, proposed, new Set(["c", "b"]));
    expect(addAndRemove.sessions.map((s) => `${s.key}:${s.minutes}`)).toEqual(["a:30", "c:10"]);
    expect(pickChanges(base, proposed, new Set(["a", "b", "c"])).sessions.map((s) => s.key)).toEqual(["a", "c"]);
  });
});

/* ── nutrition ── */

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
  restrictions: 0,
  hasMeals: true,
  safety: [],
  checkins: 4,
};
const ndays = [
  { label: "Training Day", kcal: 2450, protein: 180, carbs: 260, fats: 75, kind: "training" as const },
  { label: "Rest Day", kcal: 2100, protein: 180, carbs: 190, fats: 70, kind: "rest" as const },
];
const MEALS = `Meal 1: Breakfast
- 100 g oats (dry weight)
- 1 scoop whey protein
- 1 banana
Approximate macros: 40 g protein, 90 g carbs, 8 g fat

Meal 2 · Post-Workout
- 150 g cooked chicken breast
- 200 g cooked white rice
- 100 g broccoli
Approximate macros: 50 g protein, 60 g carbs, 6 g fat

Meal 3: Dinner
- 150 g lean ground beef
- 300 g potatoes
- 100 g green beans
Approximate macros: 40 g protein, 55 g carbs, 15 g fat`;

describe("nutrition plan quality (rework)", () => {
  it("reads the meals: variety, produce, a meal around training, foods they won't eat", () => {
    const f = mealFactsOf([{ label: "Training Day", notes: MEALS, kind: "training", kcal: null, protein: null, carbs: null, fats: null }], { dislikes: ["broccoli"] })!;
    expect(f.mealsPerDay).toEqual([3]);
    expect(f.produce).toBeGreaterThanOrEqual(3);
    expect(f.trainingDaysWithWorkoutMeal).toBe(1);
    expect(f.dislikes).toEqual(["broccoli"]);
    const q = scoreNutritionPlan(ndays, { ...nctx, meals: f });
    expect(q.categories.find((c) => c.key === "food")!.notes.join(" ")).toMatch(/won't eat: broccoli/);
    expect(q.categories.map((c) => c.key)).toEqual(["goal", "calories", "protein", "macros", "balance", "timing", "performance", "food", "sustain"]);
  });

  it("a sound plan they rate low on check-ins is a follow-through problem, not a design one", () => {
    const sound = scoreNutritionPlan(ndays, nctx);
    const struggling = scoreNutritionPlan(ndays, { ...nctx, adherence: 2.5, trendStatus: null });
    expect(struggling.score).toBe(scoreNutritionPlan(ndays, { ...nctx, trendStatus: null }).score);
    expect(struggling.verdict.kind).toBe("follow_through");
    expect(sound.verdict.action).toBe("none");
  });

  it("followed well while bodyweight is behind marks the targets down, and says why", () => {
    const q = scoreNutritionPlan(ndays, { ...nctx, trendStatus: "behind" });
    const goal = q.categories.find((c) => c.key === "goal")!;
    expect(goal.notes[0]).toMatch(/targets aren't doing the job/);
    expect(goal.score!).toBeLessThan(scoreNutritionPlan(ndays, nctx).categories.find((c) => c.key === "goal")!.score!);
  });

  it("a steep deficit with a lot of cardio is said across plans", () => {
    const q = scoreNutritionPlan(ndays, { ...nctx, weeklyKcal: 1900, maintenance: 2700, cardioMinutes: 200 });
    expect(q.connections.some((c) => c.domain === "cardio")).toBe(true);
  });
});

/* ── wiring ── */

describe("one signature strip on every management tab", () => {
  it("Training, Nutrition and Cardio lead with the same component, Optimize opens their own Cleo with the brief", () => {
    const training = read("src/components/clients/client-training-tab.tsx");
    expect(training).toMatch(/<ProgramQualityStrip clientId=\{clientId\} dock=\{dock\}/);
    expect(training.indexOf("<ProgramQualityStrip")).toBeLessThan(training.indexOf("<ProgramCard clientId"));
    expect(training).toMatch(/dock\.optimize\(\{ domain: "training"/);
    expect(training).toContain('target={{ kind: "client", clientId, focusBlockId: focusId }}');
    expect(training).toMatch(/data-builder-page/);

    const page = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
    const nutrition = page.slice(page.indexOf('<TabsContent value="nutrition"'), page.indexOf('<TabsContent value="cardio"'));
    expect(nutrition.indexOf("<NutritionQualityCard")).toBeLessThan(nutrition.indexOf("<NutritionRequestPanel"));
    expect(read("src/components/nutrition/NutritionQualityCard.tsx")).toMatch(/<PlanIntelligence[\s\S]*domain="nutrition"/);
    expect(read("src/components/nutrition/nutrition-cleo-dock.tsx")).toMatch(/<DockBrief dock=\{dock\} \/>/);

    const cardio = read("src/components/cardio/cardio-workspace.tsx");
    expect(cardio).toMatch(/<PlanIntelligence[\s\S]*domain="cardio"/);
    expect(cardio.indexOf("<PlanIntelligence")).toBeLessThan(cardio.indexOf("<CardioOverview"));
    expect(cardio).toMatch(/<DockBrief dock=\{dock\} \/>/);
    expect(read("src/components/cardio/cardio-overview.tsx")).not.toMatch(/QualityScoreCard/);
  });

  it("Optimize's Draft sends through each engine, and changes are approved one by one or all together", () => {
    expect(read("src/components/program-ai/edit-with-ai.tsx")).toMatch(/seed\?\.send/);
    expect(read("src/components/cardio/cardio-cleo-panel.tsx")).toMatch(/pickChanges\(turn\.base, p\.plan, turn\.picked\)/);
    const plan = read("src/components/nutrition/PlanAiChange.tsx");
    expect(plan).toMatch(/data-plan-ai-day-pick/);
    expect(plan).toMatch(/days: partial \? \[\.\.\.picked\] : undefined/);
    expect(read("src/lib/nutrition-plan-edits.server.ts")).toMatch(/onlyDays\?: number\[\]/);
  });

  it("an approved change rescores the plan", () => {
    expect(read("src/components/nutrition/PlanAiChange.tsx")).toMatch(/queryKey: \["nutrition-quality", clientId\]/);
    const training = read("src/components/clients/client-training-tab.tsx");
    expect(training).toMatch(/onApplied=\{afterApply\}/);
    expect(training).toMatch(/const afterApply = \(\) => \{\n {4}qc\.invalidateQueries\(\{ queryKey: programQualityKey\(clientId\) \}\)/);
  });

  it("the training score is read only after the staff member is checked against the client", () => {
    const fn = read("src/lib/program-quality.functions.ts");
    expect(fn.indexOf("assertStaffReachesClient")).toBeLessThan(fn.indexOf("supabaseAdmin"));
  });

  it("the training Cleo reads the client's cardio and nutrition too", () => {
    expect(read("src/lib/program-ai/worker.server.ts")).toMatch(/otherPlansForTraining\(admin, athleteId\)/);
    expect(read("src/lib/program-ai/prompts.ts")).toMatch(/THEIR OTHER PLANS/);
  });
});

/* ── Nov 24 2026: concerns before the score, importance over points, keep vs change, no inflation ── */

describe("intervention never rests on the overall score alone", () => {
  const crit = (key: string, score: number, weight: number, why: string, note = `${key} note`): QualityCategory => ({ ...cat(key, score, weight, note), critical: why });

  it("a high overall score never hides a weak category critical for this client", () => {
    const q = finishQuality([cat("goal", 97, 0.3), cat("dose", 96, 0.3), crit("recovery", 70, 0.15, "they lift heavy", "Hard cardio the day before heavy squats")], {
      what: "cardio plan",
      points: 4,
      missing: [],
      execution: { adherence: { pct: 92, label: "" }, outcome: { status: "on_track", label: "" } },
    });
    expect(q.score!).toBeGreaterThanOrEqual(85);
    expect(q.band).toBe("strong");
    expect(q.concerns.map((c) => c.category)).toEqual(["recovery"]);
    expect(q.verdict.kind).toBe("concern");
    expect(q.verdict.action).toBe("act");
    expect(q.verdict.headline).toMatch(/^Strong overall \(\d+\), but recovery matters most for them right now \(they lift heavy\), and it's weak: hard cardio the day before heavy squats\./);
    expect(70).toBeLessThan(CRITICAL_LOW);
  });

  it("any category under the weak-spot line is a concern, whatever the rest says", () => {
    const q = finishQuality([cat("goal", 98, 0.4), cat("dose", 98, 0.4), cat("efficiency", WEAK_SPOT - 5, 0.08, "A session over an hour")], { what: "cardio plan", points: 4, missing: [] });
    expect(q.score!).toBeGreaterThanOrEqual(85);
    expect(q.concerns[0]).toMatchObject({ category: "efficiency", reason: "weak_spot", severity: "significant" });
    expect(q.verdict.kind).toBe("concern");
  });

  it("an urgent flag (an allergen on the plan) comes first, even before not having enough data", () => {
    const allergen: QualityCategory = { ...cat("food", 60, 0.1, "Against what's on file: cooked shrimp (shellfish allergy)"), concerns: [{ text: "On the plan against an allergy on file: cooked shrimp", severity: "urgent", reason: "safety" }] };
    const thin = finishQuality([allergen, cat("goal", null), cat("protein", null)], { what: "nutrition plan", points: 1, missing: ["A recent bodyweight"] });
    expect(thin.score).toBeNull();
    expect(thin.verdict.kind).toBe("concern");
    expect(thin.verdict.headline).toMatch(/^On the plan against an allergy on file: cooked shrimp\. This comes first\./);
    const full = finishQuality([allergen, cat("goal", 95), cat("protein", 95)], { what: "nutrition plan", points: 4, missing: [] });
    expect(full.verdict.headline).toMatch(/The rest of the plan reads well \(\d+\), but this comes first\./);
  });

  it("recovery slipping is a concern worth a look, and lifts recovery work up the list", () => {
    const q = scoreProgram(input([hypertrophyBlock()]), pctx({ lowerPerformance: "down", recoveryFlags: 1 }));
    expect(q.recovery).toMatch(/Recovery looks to be slipping/);
    expect(q.concerns.some((c) => c.key === "recovery" && c.category == null)).toBe(true);
    expect(q.verdict.kind).toBe("concern");
    expect(q.verdict.action).toBe("review");
    expect(q.optimize).toMatch(/hold off adding anything until that's understood/);
    expect(q.categories.find((c) => c.key === "fatigue")!.critical).toMatch(/lower-body strength is down/);
  });

  it("very low adherence is its own concern; under the follow line it's a conversation", () => {
    const q = finishQuality([cat("goal", 95), cat("dose", 95), cat("recovery", 95)], { what: "cardio plan", points: 4, missing: [], execution: { adherence: { pct: FOLLOW_CONCERN - 10, label: "4 of 10 planned sessions done in 4 weeks" }, outcome: null } });
    expect(q.concerns.map((c) => c.key)).toEqual(["adherence"]);
    expect(q.verdict.kind).toBe("follow_through");
  });

  it("pain that's getting worse and still loaded is urgent; loads running heavier than written is a recovery concern", () => {
    const pain = { key: "shoulder", label: "Shoulder", sides: [], reports: 3, days: 3, first: "2026-11-02", last: "2026-11-20", worst: 6, trend: "worse" as const, evidence: [] as string[] };
    const b = hypertrophyBlock();
    const athlete = { sessionLimit: { minutes: 75, source: "goals" as const, pt: null, stated: 75, phrase: "", short: "75 min" }, equipment: null, pain: [{ ...pain, sides: [] }] };
    const q = scoreProgram(input([b], athlete), pctx({ effort: { rated: 10, harder: 6 } }));
    const kinds = q.concerns.map((c) => `${c.category}:${c.severity}:${c.reason}`);
    expect(kinds).toContain("fatigue:significant:recovery");
    expect(kinds).toContain("selection:urgent:safety");
    expect(q.concerns[0]).toMatchObject({ category: "selection", severity: "urgent" });
    expect(q.concerns[0].text).toMatch(/Shoulder pain is getting worse and the program still loads it/);
    expect(q.verdict.kind).toBe("concern");
    expect(q.verdict.action).toBe("act");
    expect(q.verdict.headline).toMatch(/^Shoulder pain is getting worse and the program still loads it\. The rest of the plan reads well \(\d+\), but this comes first\./);
  });
});

describe("what would help is ranked by importance, never by points", () => {
  it("a concern in a small category outranks a bigger gap with nothing behind it", () => {
    const cats = [cat("order", 70, 0.5, "Isolation work before the main lift"), cat("fatigue", 80, 0.2, "Loads heavier than written")];
    const concerns: QualityConcern[] = [{ key: "fatigue:0", category: "fatigue", label: "Fatigue", text: "The loads you set are running heavier than written", severity: "significant", reason: "recovery" }];
    const byPoints = opportunitiesOf(cats);
    expect(byPoints[0].key).toBe("order");
    const byImportance = opportunitiesOf(cats, { concerns });
    expect(byImportance.map((o) => o.key)).toEqual(["fatigue", "order"]);
    expect(byImportance[0]).toMatchObject({ title: "The loads you set are running heavier than written", reason: "Recovery", impact: "high", optional: false });
  });

  it("what's critical for this client, and what their adherence or results back up, come before plain gaps", () => {
    const cats = [cat("order", 72, 0.3, "Order"), { ...cat("sustain", 82, 0.15, "A 50-min walk is hard to keep up") }];
    const plain = opportunitiesOf(cats);
    expect(plain[0].key).toBe("order");
    const backed = opportunitiesOf(cats, { execution: { adherence: { pct: 55, label: "" }, outcome: null } });
    expect(backed[0].key).toBe("sustain");
    expect(backed[0].reason).toBe("Following it");
  });

  it("on a plan to keep, gaps without a concern are optional fine-tuning; the threshold for listing stays 90", () => {
    const q = finishQuality([cat("goal", 96, 0.3), cat("dose", 94, 0.3), cat("order", 84, 0.1, "Could move between fewer stations")], {
      what: "training program",
      points: 4,
      missing: [],
      execution: { adherence: { pct: 95, label: "" }, outcome: { status: "on_track", label: "" } },
    });
    expect(OPPORTUNITY_BELOW).toBe(90);
    expect(q.verdict.kind).toBe("working");
    expect(q.opportunities.map((o) => [o.key, o.optional])).toEqual([["order", true]]);
    expect(isReviewAsk(q.optimize)).toBe(true);
    expect(q.optimize).toMatch(/Keeping it as it is is a good answer when it's working/);
  });

  it("the ask never mentions a score or points, so nothing is changed to chase a number", () => {
    for (const q of [
      finishQuality([cat("a", 50, 0.3), cat("b", 80, 0.2), cat("c", 95, 0.5)], { what: "cardio plan", points: 4, missing: [] }),
      finishQuality([cat("goal", 96), cat("dose", 94), cat("order", 84)], { what: "training program", points: 4, missing: [] }),
    ]) {
      expect(q.optimize).not.toMatch(/\bscore|points?\b|\/100/i);
    }
  });
});

describe("Optimize with Cleo is always there", () => {
  it("offers an ask for every scored plan: the ranked fixes, or a review that may say keep it", () => {
    const working = finishQuality([cat("goal", 96), cat("dose", 95), cat("recovery", 93)], { what: "cardio plan", points: 4, missing: [] });
    const weak = finishQuality([cat("goal", 40), cat("dose", 60), cat("recovery", 70)], { what: "cardio plan", points: 4, missing: [] });
    expect(working.optimize).toBeTruthy();
    expect(isReviewAsk(working.optimize)).toBe(true);
    expect(weak.optimize).toMatch(/^Optimize the cardio plan\./);
    const none = scoreCardioPlan({ sessions: [] }, cctx);
    expect(none.score).toBeNull();
    expect(isReviewAsk(none.optimize)).toBe(true);
    expect(none.optimize).toMatch(/If no cardio is right for them, say so and why/);
  });

  it("the brief ticks what matters, leaves optional fine-tuning unticked, and nothing ticked is a review", () => {
    const q = finishQuality([cat("goal", 96, 0.3), cat("dose", 94, 0.3), cat("order", 84, 0.1, "Could move between fewer stations")], { what: "training program", points: 4, missing: [] });
    const items = briefItems(q);
    expect(items.map((i) => [i.key, i.optional])).toEqual([["order", true]]);
    expect(isReviewAsk(briefAsk({ domain: "training", what: "training program", quality: q, nonce: 1 }, new Set()))).toBe(true);
    expect(briefAsk({ domain: "training", what: "training program", quality: q, nonce: 1 }, new Set(["order"]))).toMatch(/Optional, only if clearly worth it for them: could move between fewer stations/);
    const r = scoreProgram(input([hypertrophyBlock()]), pctx({ lowerPerformance: "down", recoveryFlags: 1 }));
    const ri = briefItems(r);
    expect(ri[0]).toMatchObject({ key: "concern:recovery", concern: true, optional: false });
  });
});

describe("no inflation after a change, and a thin read says so", () => {
  it("a plan changed recently isn't judged on the old plan's results, can't reach top marks on them, and says give it time", () => {
    const fresh = { ...nctx, trendStatus: "behind", changedOn: "2026-11-14", today: "2026-11-24" };
    const q = scoreNutritionPlan(ndays, fresh);
    const goal = q.categories.find((c) => c.key === "goal")!;
    expect(goal.notes.join(" ")).not.toMatch(/targets aren't doing the job/);
    expect(goal.score!).toBeLessThanOrEqual(UNPROVEN_MAX);
    expect(goal.notes.join(" ")).toMatch(/New 10 days ago: their results will show whether these targets work/);
    expect(q.settling).toEqual({ days: 10, window: SETTLE_DAYS.nutrition });
    expect(q.provisional).toBe(true);
    expect(q.confidence).not.toBe("high");
    expect(q.verdict.kind).toBe("settling");
    expect(q.verdict.headline).toBe("Changed 10 days ago: give it about 3 more weeks to show in their results before changing it again.");
    expect(q.execution.outcome!.label).toMatch(/\(mostly before the change\)$/);
    expect(q.optimize).toMatch(/don't undo a recent change before it's had time to work/);
  });

  it("cardio: on-track results don't flatter a new plan, and behind results don't count against it", () => {
    const light: CardioPlan = { sessions: [{ ...newSession("treadmill_incline", "weekdays", cctx), weekdays: ["Wednesday"], minutes: 30 }] };
    const goal = (t: string, lastChanged: string) => scoreCardioPlan(light, { ...cctx, trendStatus: t, lastChanged }).categories.find((c) => c.key === "goal")!.score!;
    const old = "2026-10-01";
    const recent = "2026-11-16";
    expect(goal("on_track", old)).toBeGreaterThan(goal("on_track", recent));
    expect(goal("on_track", recent)).toBe(goal("behind", recent));
  });

  it("too few categories to read is no number; a thin read is provisional and says what's missing", () => {
    const none = finishQuality([cat("goal", 90), cat("dose", 90), cat("a", null), cat("b", null), cat("c", null), cat("d", null)], { what: "x", points: 1, missing: ["A bodyweight goal", "Their training days"] });
    expect(MIN_JUDGED).toBe(3);
    expect(none.score).toBeNull();
    expect(none.verdict.headline).toBe("Not enough on file to score this plan yet: a bodyweight goal and their training days would let it read the plan.");
    const thin = finishQuality([cat("goal", 95), cat("dose", 95), cat("e", 95), cat("a", null), cat("b", null), cat("c", null), cat("d", null), cat("f", null)], { what: "x", points: 1, missing: ["A bodyweight goal"] });
    expect(thin.score).toBe(95);
    expect(thin.confidence).toBe("low");
    expect(thin.provisional).toBe(true);
    expect(thin.verdict.headline).toBe("Looks sound on what's on file. Keep it as is; a bodyweight goal would make this read surer.");
  });
});

describe("one standard, read for the client, in all three", () => {
  it("each engine finishes through the shared model with its recovery trend and recent-change window", () => {
    for (const f of ["src/lib/program-quality.ts", "src/lib/nutrition-targets/plan-quality.ts", "src/lib/cardio/quality.ts"]) {
      const src = read(f);
      expect(src).toMatch(/recoveryTrend\(/);
      expect(src).toMatch(/settlingOf\("(training|nutrition|cardio)"/);
      expect(src).toMatch(/finishQuality\([\s\S]*recovery, settling/);
      expect(src).toMatch(/critical: /);
    }
  });

  it("what's critical follows the client: a meet makes the timeline and goal critical; a deficit makes protein critical", () => {
    const meet = scoreProgram(input([hypertrophyBlock()]), pctx({ style: "powerlifting", meet: { name: "Provincials", date: "2026-12-29", weeksOut: 5 } }));
    expect(meet.categories.find((c) => c.key === "timeline")!.critical).toMatch(/a meet in 5 weeks/);
    expect(scoreProgram(input([hypertrophyBlock()]), pctx()).categories.find((c) => c.key === "goal")!.critical).toBeNull();
    const cut = scoreNutritionPlan(ndays, nctx);
    expect(cut.categories.find((c) => c.key === "protein")!.critical).toBe("a cut");
    expect(scoreNutritionPlan(ndays, { ...nctx, direction: "maintain" }).categories.find((c) => c.key === "protein")!.critical).toBeNull();
  });
});

describe("one way into Cleo per page, and it stays reachable", () => {
  it("no second Cleo button beside the strip on Training, Nutrition or the cardio builder", () => {
    const training = read("src/components/clients/client-training-tab.tsx");
    expect(training).not.toMatch(/Adjust with Cleo/);
    expect(training).not.toMatch(/data-training-cleo/);
    expect(read("src/route-pages/_authenticated/admin/clients.$id.tsx")).toContain('<NutritionTargetsPanel clientId={id} className="md:col-span-2" cleoEntry={false} />');
    expect(read("src/components/nutrition-targets-panel.tsx")).toMatch(/\{cleoEntry && <NutritionCleoEntry clientId=\{clientId\} \/>\}/);
    expect(read("src/components/cardio/cardio-builder.tsx")).not.toMatch(/<CleoLauncher/);
  });

  it("each tab's closed dock shows its handle once the strip's buttons scroll away", () => {
    expect(read("src/components/clients/client-training-tab.tsx")).toMatch(/handle=\{focusId \? TRAINING_CLEO_ANCHOR : null\}/);
    expect(read("src/components/nutrition/nutrition-cleo-dock.tsx")).toMatch(/handle=\{NUTRITION_CLEO_ANCHOR\}/);
    expect(read("src/components/cardio/cardio-workspace.tsx")).toMatch(/handle=\{CARDIO_CLEO_ANCHOR\}/);
    const dock = read("src/components/program-ai/cleo-dock.tsx");
    expect(dock).toMatch(/const showHandle = !!handle && !dock\.open && !anchorInView/);
    expect(dock).toMatch(/data-hide-on-keyboard/);
    expect(read("src/components/plan-quality/plan-intelligence.tsx")).toMatch(/data-quality-actions/);
  });

  it("a review that keeps the plan says so instead of asking the coach to reword it", () => {
    expect(read("src/components/nutrition/PlanAiChange.tsx")).toMatch(/isReviewAsk\(edit\.instructions\) \? "No changes: Cleo would keep the plan as it is\."/);
  });
});
