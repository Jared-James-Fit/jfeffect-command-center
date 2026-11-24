import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { finishQuality, opportunitiesOf, optimizeAskFrom, verdictOf, type QualityCategory } from "@/lib/plan-quality";
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

  it("working: well designed, followed and on track says nothing needs changing", () => {
    const v = verdictOf(90, good, { adherence: { pct: 90, label: "" }, outcome: { status: "on_track", label: "" } });
    expect(v.kind).toBe("working");
    expect(v.action).toBe("none");
    expect(v.headline).toBe("Well designed, followed (90%) and results are on track. Nothing needs changing.");
  });

  it("ranks what would help most by how much it lifts the score, and asks Cleo for now vs proposed, why and impact", () => {
    const opp = opportunitiesOf([cat("a", 50, 0.3), cat("b", 80, 0.1), cat("c", 95, 0.6)]);
    expect(opp.map((o) => o.key)).toEqual(["a", "b"]);
    expect(opp[0].impact).toBe("high");
    const q = finishQuality([cat("a", 50, 0.3), cat("c", 95, 0.6)], { what: "cardio plan", points: 4, missing: [] });
    expect(q.optimize).toMatch(/^Optimize the cardio plan\. In order of expected impact:\n1\. a note/);
    expect(q.optimize).toMatch(/what it is now, what you'd change it to, why, and how much it should help/);
    expect(q.optimize).toMatch(/Keep what's working: c: c note/);
    expect(optimizeAskFrom("x", { ...q, opportunities: [] })).toBeNull();
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
