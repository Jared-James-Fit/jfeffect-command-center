/**
 * Plan quality, round three (Nov 24 2026): adaptive evaluation windows (a
 * change log of minor and substantial changes, each judged on its own window),
 * coaching intelligence (design vs execution vs lifestyle vs missing data;
 * powerlifting phases; nutrition noise; cardio not logged vs not done), Cleo's
 * next steps and unpublished-draft reminders, and a Cleo handle that never gets
 * in the way.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  barriersFromCheckins,
  barriersIn,
  concernsOf,
  finishQuality,
  followUpAsk,
  lower,
  pastOverride,
  verdictOf,
  type QualityCategory,
} from "@/lib/plan-quality";
import {
  BASE_WINDOW,
  cardioFingerprint,
  cardioSlots,
  cardioVersionChanges,
  changeRead,
  diffCardio,
  diffNutrition,
  diffTraining,
  evaluateChanges,
  newNutritionPlanChanges,
  nutritionFingerprint,
  programEditChanges,
  sameFingerprint,
  settlingFrom,
  trainingFingerprint,
  windowFor,
  type PlanChange,
} from "@/lib/plan-changes";
import { overlayOpen, pillRoom, tabPeeks } from "@/components/program-ai/cleo-dock";
import { pendingReminder, waitedWords } from "@/components/plan-quality/plan-intelligence";
import { scoreProgram, phaseOf, type ProgramQualityContext } from "@/lib/program-quality";
import type { CheckExercise, CheckInput } from "@/lib/program-check";
import { scoreNutritionPlan, type NutritionScoreContext } from "@/lib/nutrition-targets/plan-quality";

const read = (p: string) => readFileSync(p, "utf8");
const TODAY = "2026-11-24";
const cat = (key: string, score: number | null, weight = 0.2, note = `${key} note`): QualityCategory => ({ key, label: key[0].toUpperCase() + key.slice(1), score, weight, notes: [note] });

/* ───────────────────────────── the change log ───────────────────────────── */

const trow = (id: string, ex: string, sets: number, open = true, date: string | null = "2026-11-26", day = "d1") => ({ id, exercise_id: ex, sets, reps_text: "5", rpe: "7", open, date, dayId: day });

describe("changes are sized, and a minor edit never restarts the read", () => {
  it("a tweak to one exercise's sets is minor; swapping three exercises is substantial", () => {
    const before = trainingFingerprint([trow("r1", "sq", 4), trow("r2", "bp", 4), trow("r3", "row", 3), trow("r4", "curl", 3)]);
    const tweak = trainingFingerprint([trow("r1", "sq", 5), trow("r2", "bp", 4), trow("r3", "row", 3), trow("r4", "curl", 3)]);
    const c1 = diffTraining(before, tweak, TODAY);
    expect(c1).toEqual([expect.objectContaining({ area: "dose", size: "minor" })]);
    const swap = trainingFingerprint([trow("r1", "fsq", 4), trow("r2", "ibp", 4), trow("r3", "pd", 3), trow("r4", "curl", 3)]);
    expect(diffTraining(before, swap, TODAY)).toEqual([expect.objectContaining({ area: "exercises", size: "substantial", summary: "Exercises: 3 swapped" })]);
  });

  it("a workout getting trained (or its day passing) is never a change", () => {
    const before = trainingFingerprint([trow("r1", "sq", 4), trow("r2", "bp", 4)]);
    const trained = trainingFingerprint([trow("r1", "sq", 4, false), trow("r2", "bp", 4)]);
    expect(diffTraining(before, trained, TODAY)).toEqual([]);
  });

  it("a block of new workouts is a new program, effective when its first workout lands", () => {
    const before = trainingFingerprint([trow("r1", "sq", 4)]);
    const rows = [trow("r1", "sq", 4)];
    for (let d = 0; d < 4; d++) for (let r = 0; r < 4; r++) rows.push(trow(`n${d}${r}`, "bp", 3, true, `2026-12-0${d + 1}`, `nd${d}`));
    const c = diffTraining(before, trainingFingerprint(rows), TODAY);
    expect(c).toEqual([expect.objectContaining({ area: "program", size: "substantial", on: "2026-12-01" })]);
  });

  it("nutrition: a 50 kcal nudge is minor, a 250 kcal cut is substantial, meals are their own minor change", () => {
    const day = (label: string, kcal: number, notes = "Meal 1 - Breakfast\n150 g chicken") => ({ label, kcal, protein: 180, carbs: 250, fats: 70, notes });
    const base = nutritionFingerprint("p1", "2026-11-01", [day("Training Day", 2600), day("Rest Day", 2300)]);
    const nudge = nutritionFingerprint("p1", "2026-11-01", [day("Training Day", 2650), day("Rest Day", 2340)]);
    expect(diffNutrition(base, nudge, TODAY).map((c) => [c.area, c.size])).toEqual([["calories", "minor"]]);
    const cut = nutritionFingerprint("p1", "2026-11-01", [day("Training Day", 2350), day("Rest Day", 2050)]);
    expect(diffNutrition(base, cut, TODAY)).toEqual([expect.objectContaining({ area: "calories", size: "substantial", summary: "Calories: Training Day −250 kcal, Rest Day −250 kcal" })]);
    const meals = nutritionFingerprint("p1", "2026-11-01", [day("Training Day", 2600, "Meal 1 - Breakfast\n150 g turkey"), day("Rest Day", 2300)]);
    expect(diffNutrition(base, meals, TODAY)).toEqual([expect.objectContaining({ area: "meals", size: "minor" })]);
  });

  it("a new plan with the same numbers and meals (a re-publish) is no change", () => {
    const days = [{ label: "Training Day", kcal: 2600, protein: 180, carbs: 250, fats: 70, notes: "x" }];
    expect(newNutritionPlanChanges({ id: "a", start: "2026-10-01", days }, { id: "b", start: "2026-11-20", days }, TODAY)).toEqual([]);
    expect(newNutritionPlanChanges(null, { id: "b", start: "2026-11-20", days }, TODAY)).toEqual([expect.objectContaining({ summary: "First nutrition plan", size: "substantial", on: "2026-11-20" })]);
  });

  it("cardio sessions match by what they are, never by row id: a republished tweak isn't a new session", () => {
    const s = (minutes: number, rpeMax = 4) => ({ key: Math.random().toString(36), modality: "treadmill_incline_walk", days: "non_training", weekdays: ["Wednesday", "Saturday", "Sunday"], minutes, rpeMin: 3, rpeMax, enabled: true });
    const a = cardioFingerprint(cardioSlots([s(30)]));
    const b = cardioFingerprint(cardioSlots([s(32)]));
    expect(diffCardio(a, b, TODAY)).toEqual([expect.objectContaining({ area: "cardio_dose", size: "minor" })]);
    const c = cardioFingerprint(cardioSlots([s(45)]));
    expect(diffCardio(a, c, TODAY)).toEqual([expect.objectContaining({ area: "cardio_dose", size: "substantial", summary: "Weekly cardio 90 → 135 min" })]);
    const v = cardioVersionChanges(
      [
        { effective_date: "2026-10-01", state: "live", sessions: cardioSlots([s(30)]) },
        { effective_date: "2026-11-20", state: "live", sessions: cardioSlots([s(30, 6)]) },
      ],
      TODAY,
    );
    expect(v.map((x) => [x.on, x.area, x.size])).toEqual([
      ["2026-10-01", "cardio_dose", "substantial"],
      ["2026-11-20", "cardio_intensity", "minor"],
    ]);
  });

  it("an applied Adjust program change is sized by what it touched", () => {
    const result = { changes: [{ id: "c1", title: "Swap the squat for a front squat", ops: [{ op: "swap", rows: ["a", "b", "c", "d"] }] }, { id: "c2", title: "One more set of curls", ops: [{ op: "update", rows: ["e"] }] }] };
    expect(programEditChanges(result, ["c2"], "2026-11-20")).toEqual([expect.objectContaining({ area: "dose", size: "minor", summary: "One more set of curls" })]);
    expect(programEditChanges(result, ["c1", "c2"], "2026-11-20").map((c) => [c.area, c.size])).toEqual([
      ["exercises", "substantial"],
      ["dose", "minor"],
    ]);
  });

  it("only a substantial change in a results area holds the plan's read; a minor one is listed and judged on its own", () => {
    const changes: PlanChange[] = [
      { domain: "nutrition", area: "meals", size: "minor", summary: "Meals changed on 2 day types", on: "2026-11-22" },
      { domain: "nutrition", area: "calories", size: "substantial", summary: "Calories: Training Day −250 kcal", on: "2026-11-10" },
    ];
    const ev = evaluateChanges("nutrition", changes, TODAY);
    expect(ev.find((c) => c.area === "meals")!.holds).toBe(false);
    expect(ev.find((c) => c.area === "calories")!).toMatchObject({ holds: true, window: 28, ready: "2026-12-08", daysIn: 14 });
    expect(settlingFrom(ev, "nutrition")).toMatchObject({ what: "Calories: Training Day −250 kcal", minor: false });
    // with only the meals change, nothing holds the read
    expect(settlingFrom(evaluateChanges("nutrition", [changes[0]], TODAY), "nutrition")).toBeNull();
  });

  it("an edit seen only as 'edited' (before the log existed) is listed but never holds anything", () => {
    const ev = evaluateChanges("cardio", [{ domain: "cardio", area: "cardio_dose", size: "minor", summary: "Cardio targets edited", on: "2026-11-20", unknown: true }], TODAY);
    expect(ev).toHaveLength(1);
    expect(settlingFrom(ev, "cardio")).toBeNull();
  });

  it("a minor calorie adjustment waits for its own trend without making the score provisional", () => {
    const r = changeRead("nutrition", [{ domain: "nutrition", area: "calories", size: "minor", summary: "Calories: Training Day +100 kcal", on: "2026-11-21" }], TODAY);
    expect(r.settling).toMatchObject({ minor: true, ready: "2026-12-05" });
    const q = finishQuality([cat("goal", 92), cat("calories", 95), cat("protein", 95)], { what: "nutrition plan", points: 5, missing: [], settling: r.settling, changes: r.changes });
    expect(q.provisional).toBe(false);
    expect(q.verdict.kind).toBe("settling");
    expect(q.verdict.headline).toMatch(/^Calories: Training Day \+100 kcal \(adjusted 3 days ago\)\. Give it until Dec 5/);
  });

  it("windows adapt: a meet close by, a taper, daily weigh-ins, how often they train", () => {
    expect(windowFor("nutrition", { area: "calories", size: "substantial" }).days).toBe(BASE_WINDOW.calories.substantial);
    expect(windowFor("nutrition", { area: "calories", size: "substantial" }, { weighIns14: 12 })).toMatchObject({ days: 21, why: "daily weigh-ins show the trend sooner" });
    expect(windowFor("nutrition", { area: "calories", size: "substantial" }, { weighIns14: 2 }).days).toBe(35);
    expect(windowFor("nutrition", { area: "calories", size: "substantial" }, { meetWeeksOut: 3 })).toMatchObject({ days: 10, why: "a meet in 3 weeks can't wait longer" });
    expect(windowFor("training", { area: "program", size: "substantial" }, { phase: "taper" })).toMatchObject({ days: 7, why: "a taper changes week to week" });
    expect(windowFor("training", { area: "program", size: "substantial" }, { sessionsPerWeek: 4 }).days).toBe(14);
    expect(windowFor("training", { area: "program", size: "substantial" }, { sessionsPerWeek: 2 }).days).toBe(28);
  });

  it("a significant trend the wrong way overrides settling once half its window has passed", () => {
    expect(pastOverride({ days: 3, window: 28 })).toBe(false);
    expect(pastOverride({ days: 14, window: 28 })).toBe(true);
    const ex = { adherence: { pct: 90, label: "" }, outcome: { status: "off" as const, label: "Bodyweight is moving the wrong way" } };
    expect(concernsOf([], ex, { settling: { days: 5, window: 28 } }).some((c) => c.reason === "results")).toBe(false);
    const late = concernsOf([], ex, { settling: { days: 16, window: 28 } });
    expect(late.find((c) => c.reason === "results")!.text).toBe("16 days into the change, followed well (90%), but bodyweight is moving the wrong way");
  });

  it("the snapshot only rewrites when something that matters moved", () => {
    const a = trainingFingerprint([trow("r1", "sq", 4)]);
    expect(sameFingerprint(a, trainingFingerprint([trow("r1", "sq", 4)]))).toBe(true);
    expect(sameFingerprint(a, trainingFingerprint([trow("r1", "sq", 5)]))).toBe(false);
    expect(sameFingerprint(null, a)).toBe(false);
  });
});

/* ───────────────────────────── coaching intelligence ───────────────────────────── */

describe("design, execution, lifestyle or data: the read says which", () => {
  const good = [cat("goal", 92), cat("recovery", 88), cat("dose", 90)];

  it("low adherence with their life in the check-ins is lifestyle: a conversation, never a prescription change", () => {
    const v = verdictOf(90, good, { adherence: { pct: 45, label: "" }, outcome: null, barriers: ["travel"] }, { domain: "training", firstName: "Marc" });
    expect(v.kind).toBe("lifestyle");
    expect(v.action).toBe("review");
    expect(v.headline).toBe("Only 45% followed, and their check-ins mention travel: their week, more than the plan. Talk it through; change the plan only if it needs to fit around that.");
    expect(v.ask).toBe("Hey Marc, checking in. How's the travel been? I noticed your workouts have been harder to get to lately. What's getting in the way, and what would make it easier this week?");
  });

  it("adherence is said in tiers: 'only' when it's low, 'about' when it's middling", () => {
    expect(verdictOf(90, good, { adherence: { pct: 62, label: "" }, outcome: null }).headline).toMatch(/\(about 62%\)/);
    expect(verdictOf(90, good, { adherence: { pct: 30, label: "" }, outcome: null }).headline).toMatch(/\(only 30%\)/);
  });

  it("a safety flag comes before how well it's followed", () => {
    const cats = [cat("goal", 92), { ...cat("selection", 80), concerns: [{ text: "Shoulder: pain on file, and the program still loads it", severity: "significant" as const, reason: "safety" as const }] }, cat("dose", 90)];
    const q = finishQuality(cats, { what: "training program", points: 5, missing: [], execution: { adherence: { pct: 40, label: "" }, outcome: null } });
    expect(q.verdict.kind).toBe("concern");
    // a strong design still leads with the flag, never with how well it's followed
    expect(q.verdict.headline).toMatch(/^Strong overall \(\d+\), but shoulder: pain on file, and the program still loads it\./);
  });

  it("practicality is blamed only when a practical category is clearly weak, not a mild gap", () => {
    const mild = [cat("goal", 92), cat("sustain", 85, 0.2, "A 50-min session"), cat("dose", 90)];
    expect(verdictOf(88, mild, { adherence: { pct: 50, label: "" }, outcome: null }).kind).toBe("follow_through");
    const weak = [cat("goal", 92), cat("sustain", 70, 0.2, "Cardio every day"), cat("dose", 90)];
    expect(verdictOf(80, weak, { adherence: { pct: 50, label: "" }, outcome: null }).kind).toBe("practicality");
  });

  it("a working plan with one untidy part is still kept: said as something to tidy next time", () => {
    const v = verdictOf(90, [cat("goal", 98), cat("calories", 72, 0.2, "Training Day: 3250 kcal vs 3040 from its macros"), cat("dose", 98)], { adherence: { pct: 100, label: "" }, outcome: null });
    expect(v).toMatchObject({ kind: "watch", action: "none" });
    expect(v.headline).toBe("Working: well designed and followed (100%). Calories could be tidier: Training Day: 3250 kcal vs 3040 from its macros, next time you change it.");
  });

  it("names stay names when a sentence runs on ('Training Day', 'RPE'), plain words lower-case", () => {
    expect(lower("Training Day: 3250 kcal")).toBe("Training Day: 3250 kcal");
    expect(lower("Non-Training Day under 1,500")).toBe("Non-Training Day under 1,500");
    expect(lower("RPE runs high")).toBe("RPE runs high");
    expect(lower("Both shoulders: pain on file")).toBe("both shoulders: pain on file");
  });

  it("barriers come from what they wrote about their week, never from numbers or pain details", () => {
    expect(barriersIn(["Work has been crazy", "Back from vacay"])).toEqual(["work", "travel"]);
    expect(barriersIn(["workout felt great", "busy gym"])).toEqual(["no time"]);
    expect(barriersFromCheckins([{ answers: { pain_details: "Neck sore from work stress", help: "None", training_rating: 4 } }])).toEqual([]);
    expect(barriersFromCheckins([{ answers: { next_week_goal: "Get back on track once I'm done vacay" } }])).toEqual(["travel"]);
  });

  it("the follow-up message reads right for each plan", () => {
    expect(followUpAsk("nutrition", { pct: 40 })).toMatch(/^Hey, checking in\. I noticed the nutrition plan has been harder to stick to lately\./);
    expect(followUpAsk("cardio", { pct: 40, firstName: "Ash", barriers: ["illness"] })).toMatch(/^Hey Ash, checking in\. How are you feeling now\? I noticed the cardio has been harder to get to lately\./);
  });
});

/* ── powerlifting phases ── */

const EX: Array<[string, string, Partial<CheckExercise>?]> = [
  ["sq", "Competition Squat", { competition_lift_type: "squat", is_competition_lift: true }],
  ["bp", "Competition Bench Press", { competition_lift_type: "bench", is_competition_lift: true }],
  ["dl", "Competition Deadlift", { competition_lift_type: "deadlift", is_competition_lift: true }],
  ["row", "Seated Cable Row"],
];
const exercises = new Map<string, CheckExercise>(EX.map(([id, name, extra]) => [id, { id, name, video_url: "x", exercise_category: null, ...(extra ?? {}) }]));
const r = (exercise_id: string, sets: number, reps: string, rpe: string) => ({ exercise_id, sets, reps_text: reps, rpe });
const plBlock = (blockType: string, phase: string, reps = "5") => ({
  id: "b1",
  name: phase,
  blockType,
  weeks: [1, 2, 3].map((w) => ({
    week_index: w,
    phase,
    days: [
      { day_index: 1, rows: [r("sq", 4, reps, String(7 + w * 0.5)), r("bp", 4, reps, "7"), r("row", 3, "10", "8")] },
      { day_index: 2, rows: [r("dl", 3, reps, String(7 + w * 0.5)), r("bp", 4, reps, "7"), r("row", 3, "10", "8")] },
      { day_index: 3, rows: [r("sq", 3, reps, "7"), r("bp", 5, reps, String(7 + w * 0.5)), r("row", 3, "10", "8")] },
    ],
  })),
});
const plInput = (b: any): CheckInput => ({ kind: "client", style: "powerlifting", blocks: [b], exercises, athlete: { sessionLimit: { minutes: 90, source: "goals", pt: null, stated: 90, phrase: "", short: "90 min" }, equipment: null, pain: [] } });
const plCtx = (over: Partial<ProgramQualityContext> = {}): ProgramQualityContext => ({
  today: TODAY,
  level: "intermediate",
  style: "powerlifting",
  trainingDays: ["Monday", "Wednesday", "Friday"],
  meet: null,
  blocks: [{ name: "Block", start: "2026-11-02", end: "2026-12-20", current: true }],
  direction: "maintain",
  deficitPct: null,
  recoveryFlags: 0,
  lowerPerformance: "down",
  cardio: null,
  adherence: { done: 11, planned: 12 },
  effort: null,
  checkins: 4,
  ...over,
});

describe("powerlifting: planned fatigue and lower-rep phases aren't read as a failing program", () => {
  it("reads the phase from the live week's words, else the block's type", () => {
    expect(phaseOf(plInput(plBlock("accumulation", "Accumulation")), { bi: 0, wi: 0 })).toBe("accumulation");
    expect(phaseOf(plInput(plBlock("peaking", "Peak + Taper")), { bi: 0, wi: 0 })).toBe("taper");
    expect(phaseOf(plInput(plBlock("intensification", "")), { bi: 0, wi: 0 })).toBe("intensification");
  });

  it("strength a little down in an accumulation block, with recovery fine, is expected: keep it as written", () => {
    const q = scoreProgram(plInput(plBlock("accumulation", "Accumulation")), plCtx());
    expect(q.execution.expected).toMatch(/high-volume block: accumulated fatigue, planned/);
    expect(q.verdict.kind).toBe("working");
    expect(q.verdict.action).toBe("none");
    expect(q.concerns.some((c) => c.reason === "results")).toBe(false);
  });

  it("an intensification's lower-rep sets estimate lower: judge the heavy singles, not the estimate", () => {
    const q = scoreProgram(plInput(plBlock("intensification", "Intensification", "2")), plCtx());
    expect(q.verdict.headline).toMatch(/heavier, lower-rep sets in an intensification block often estimate lower than sets of five did.*Judge the heavy singles, not the estimate/);
    // with the meet close and no peak written, the timeline comes first
    const meet = scoreProgram(plInput(plBlock("intensification", "Intensification", "2")), plCtx({ meet: { name: "Nationals", date: "2026-12-12", weeksOut: 2.6 } }));
    expect(meet.verdict.headline).toMatch(/no peak or taper/i);
  });

  it("the same dip with sleep or energy flagged is a recovery concern, never 'expected'", () => {
    const q = scoreProgram(plInput(plBlock("accumulation", "Accumulation")), plCtx({ recoveryFlags: 1 }));
    expect(q.execution.expected).toBeNull();
    expect(q.recovery).toMatch(/Recovery looks to be slipping/);
  });

  it("a deload or taper week's lower volume is by design, never 'low weekly sets'", () => {
    const light = plBlock("deload", "Deload");
    for (const w of light.weeks) for (const d of w.days) d.rows = d.rows.slice(0, 1).map((x: any) => ({ ...x, sets: 1 }));
    const q = scoreProgram(plInput(light), plCtx({ lowerPerformance: "steady" }));
    const dose = q.categories.find((c) => c.key === "dose")!;
    expect(dose.notes.join(" ")).not.toMatch(/Low weekly sets/);
    expect(dose.notes[0]).toMatch(/A lighter deload week by design/);
  });

  it("loads running well under target RPE are room to progress faster", () => {
    const q = scoreProgram(plInput(plBlock("strength", "Strength")), plCtx({ lowerPerformance: "steady", effort: { rated: 12, harder: 0 }, easier: 8 }));
    expect(q.categories.find((c) => c.key === "progression")!.notes.join(" ")).toMatch(/ran 2\+ RPE under target lately: room to progress the loads faster/);
  });
});

/* ── nutrition noise ── */

describe("nutrition: a noisy trend is never read as the wrong way", () => {
  const days = [
    { label: "Training Day", kcal: 2600, protein: 180, carbs: 290, fats: 75, kind: "training" as const },
    { label: "Rest Day", kcal: 2300, protein: 180, carbs: 215, fats: 75, kind: "rest" as const },
  ];
  const ctx = (over: Partial<NutritionScoreContext> = {}): NutritionScoreContext => ({
    direction: "lose",
    sex: "M",
    bodyweightKg: 90,
    weeklyKcal: 2470,
    maintenance: 2900,
    trend: { pctPerWeek: 0.2, clear: false },
    trendStatus: "wrong_way",
    adherence: 4.5,
    hungerHigh: false,
    recoveryFlags: 0,
    trainingDays: 4,
    powerlifter: false,
    meetWeeksOut: null,
    conflicts: [],
    restrictions: 0,
    hasMeals: false,
    safety: [],
    checkins: 4,
    ...over,
  });

  it("an unclear trend 'the wrong way' reads as not moving yet, never a results concern", () => {
    const q = scoreNutritionPlan(days, ctx());
    expect(q.execution.outcome?.status).toBe("behind");
    expect(q.concerns.some((c) => c.reason === "results")).toBe(false);
  });

  it("a clear trend the wrong way while it's followed is a concern", () => {
    const q = scoreNutritionPlan(days, ctx({ trend: { pctPerWeek: 0.5, clear: true } }));
    expect(q.execution.outcome?.status).toBe("off");
    expect(q.concerns.some((c) => c.reason === "results")).toBe(true);
  });
});

/* ───────────────────────────── Cleo's next steps, reminders, the handle ───────────────────────────── */

describe("Cleo's next steps and reminders", () => {
  it("each engine says what applying does and that an unapplied draft waits (and is reminded)", () => {
    expect(read("src/components/program-ai/edit-with-ai.tsx")).toMatch(/data-edit-with-ai-next[\s\S]{0,200}Program quality reminds you until you apply or discard it/);
    expect(read("src/components/nutrition/PlanAiChange.tsx")).toMatch(/data-plan-ai-next[\s\S]{0,260}Nutrition quality reminds you until you update or discard it/);
    const cardio = read("src/components/cardio/cardio-cleo-panel.tsx");
    expect(cardio).toMatch(/Publish it now, schedule it for a date, or keep it as a draft/);
    expect(cardio).toMatch(/data-proposal-publish/);
    expect(read("src/components/cardio/cardio-builder.tsx")).toMatch(/publishNonce === seenNonce\.current[\s\S]{0,120}setReviewOpen\(true\)/);
  });

  it("reminders are friendly, say how long it's waited, and open where it waits", () => {
    const now = Date.parse("2026-11-24T18:00:00Z");
    expect(waitedWords("2026-11-24T09:00:00Z", now)).toBe("from earlier today");
    expect(waitedWords("2026-11-23T09:00:00Z", now)).toBe("from yesterday");
    expect(waitedWords("2026-11-20T09:00:00Z", now)).toBe("from Nov 20");
    const open = () => undefined;
    expect(pendingReminder("program", "2026-11-24T09:00:00Z", { count: 3, cleo: true, onOpen: open }).text).toMatch(/^Cleo's 3 proposed changes from (earlier today|yesterday|Nov \d+) are still waiting\. Apply what you want, or discard it\.$/);
    expect(pendingReminder("cardio_draft", "2026-11-20T09:00:00Z", { onOpen: open }).action).toBe("Open draft");
  });

  it("every strip offers the reminder and 'Message them' for its client", () => {
    for (const f of ["src/components/clients/client-training-tab.tsx", "src/components/nutrition/NutritionQualityCard.tsx", "src/components/cardio/cardio-workspace.tsx"]) {
      const src = read(f);
      expect(src).toMatch(/messageClientId=\{clientId\}/);
      expect(src).toMatch(/pending=\{/);
    }
    expect(read("src/components/plan-quality/plan-intelligence.tsx")).toMatch(/queueComposerInsert\(messageClientId!, q\.verdict\.ask!\)/);
  });
});

describe("the Cleo handle never gets in the way", () => {
  it("the phone pill hides while scrolling down, at the page's end and under an open dialog or menu", () => {
    expect(pillRoom({ scrollingDown: false, nearEnd: false, overlay: false })).toBe(true);
    expect(pillRoom({ scrollingDown: true, nearEnd: false, overlay: false })).toBe(false);
    expect(pillRoom({ scrollingDown: false, nearEnd: true, overlay: false })).toBe(false);
    expect(pillRoom({ scrollingDown: false, nearEnd: false, overlay: true })).toBe(false);
  });

  it("the computer tab steps aside while the pointer works near the right edge, and comes back when aimed at", () => {
    const tab = { vw: 1440, tabTop: 400, tabBottom: 480 };
    expect(tabPeeks({ ...tab, x: 1360, y: 440 })).toBe(true); // a control 80px from the edge
    expect(tabPeeks({ ...tab, x: 1430, y: 440 })).toBe(false); // aiming at the edge itself
    expect(tabPeeks({ ...tab, x: 1360, y: 100 })).toBe(false); // far above it
    expect(tabPeeks({ ...tab, x: 900, y: 440 })).toBe(false);
  });

  it("an open dialog or menu counts as an overlay", () => {
    const doc = { querySelector: (sel: string) => (sel.includes('[role="dialog"][data-state="open"]') ? {} : null) } as unknown as Document;
    expect(overlayOpen(doc)).toBe(true);
    expect(overlayOpen({ querySelector: () => null } as unknown as Document)).toBe(false);
  });

  it("hidden while typing, never focusable while hidden", () => {
    const dock = read("src/components/program-ai/cleo-dock.tsx");
    expect(dock).toMatch(/data-hide-on-keyboard/);
    expect(dock).toMatch(/tabIndex=\{visible \? 0 : -1\}/);
    expect(dock).toMatch(/aria-hidden=\{!visible\}/);
  });
});
