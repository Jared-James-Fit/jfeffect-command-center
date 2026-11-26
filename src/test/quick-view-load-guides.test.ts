import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadModel, NEUTRAL_READINESS, planningTarget, suggestSetLoad } from "@/lib/load-suggestion";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";
import { dayGuides, parseEffortTarget, type DayGuideInput } from "@/lib/workouts/card-suggestion";
import { parseRepTarget } from "@/lib/set-input-cascade";
import { guidesShow } from "@/components/clients/workout-quick-view/load-guides";

const read = (p: string) => readFileSync(p, "utf8");
const DAY = 86_400_000;
const now = Date.now();

const squatEx = { id: "ex-squat", name: "Competition Squat", equipment: "Barbell", movement_family: "squat", competition_lift_type: "squat", is_competition_lift: true };
const rdlEx = { id: "ex-rdl", name: "Dumbbell Romanian Deadlift", equipment: "Dumbbell", movement_family: "accessory", competition_lift_type: null, is_competition_lift: false };

/** A past session's working sets of an exercise, in lb, rated. */
function session(exercise: { id: string; name: string }, daysAgo: number, sets: Array<[number, number, number]>, row = `old-${exercise.id}-${daysAgo}`): PreviousLiftLog[] {
  return sets.map(([lb, reps, rpe], i) => ({
    id: `${row}-${i}`,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    sessionKey: `instance:${row}`,
    occurredAt: new Date(now - daysAgo * DAY + i * 60_000).toISOString(),
    trainedOn: new Date(now - daysAgo * DAY).toISOString().slice(0, 10),
    reps,
    rpe,
    rir: null,
    enteredValue: lb,
    enteredUnit: "lb",
    normalizedKg: lb * 0.45359237,
    normalizedLb: lb,
    isWorkingSet: true,
    loadType: "external",
    rowId: row,
    rowOrder: 0,
  }));
}

const squatHistory = [
  ...session(squatEx, 21, [[405, 4, 7], [405, 4, 7.5]]),
  ...session(squatEx, 14, [[415, 4, 7], [415, 4, 7.5]]),
  ...session(squatEx, 7, [[425, 4, 7.5], [425, 4, 8]]),
];

const base = (over: Partial<DayGuideInput> = {}): DayGuideInput => ({
  rows: [],
  results: [],
  units: {},
  fallbackUnit: "lb",
  history: new Map(),
  bodyweightKg: null,
  readiness: NEUTRAL_READINESS,
  warmups: new Map(),
  maxes: [],
  maxesPending: false,
  strengthRefs: null,
  ...over,
});

const topSet = { id: "r1", sort_order: 0, exercise_id: squatEx.id, exercises: squatEx, sets: 1, reps_text: "4", rpe: "7", purpose_label: "Top Set" };
const backoff = { id: "r2", sort_order: 1, exercise_id: squatEx.id, exercises: squatEx, sets: 2, reps_text: "4", rpe: "7", percentage: 92.5, percentage_basis: "top_set", purpose_label: "Back-off" };

describe("quick view: each exercise's load guidance is the logger's", () => {
  it("the first heavy set of a main lift reads the engine's own number as a range to pick within", () => {
    const guides = dayGuides(base({
      rows: [topSet],
      units: { "row:r1": "lb" },
      history: new Map([["r1", squatHistory]]),
    }));
    const g = guides.get("r1");
    expect(g?.kind).toBe("suggested");
    if (g?.kind !== "suggested") return;
    // the engine's own target, read the way the logger feeds it
    const plan = planningTarget({ repTarget: parseRepTarget("4"), rpeTarget: parseEffortTarget("7"), rirTarget: parseEffortTarget(null) })!;
    const model = buildLoadModel({ history: squatHistory, today: [], unit: "lb", readiness: NEUTRAL_READINESS, warmups: [], bodyweightKg: null, dayFactor: null, carryToday: [], lift: "competition", equipment: "barbell" });
    const hint = suggestSetLoad(model, plan)!;
    expect(g.target).toBe(hint.target);
    expect(g.shown).toMatch(/^\d+(\.\d+)?–\d+(\.\d+)?$/);
    expect(g.unit).toBe("lb");
    // the prescription already says "× 4 @ 7"
    expect(g.plan).toBeNull();
  });

  it("a back-off at a % of the top set waits for the top set, then reads what it comes to", () => {
    const before = dayGuides(base({ rows: [topSet, backoff], units: { "row:r1": "lb", "row:r2": "lb" }, history: new Map([["r1", squatHistory], ["r2", squatHistory]]) }));
    expect(before.get("r2")).toEqual({ kind: "planned", label: "92.5% of top set", value: null, waiting: "After the top set", capped: false });
    const results = [{ row_id: "r1", set_index: 1, completed_at: new Date().toISOString(), actual_load: 435, actual_load_unit: "lb", entered_value: 435, entered_unit: "lb", actual_reps: 4, actual_rpe: "7", load_type: "external" }];
    const after = dayGuides(base({ rows: [topSet, backoff], results, units: { "row:r1": "lb", "row:r2": "lb" }, history: new Map([["r1", squatHistory], ["r2", squatHistory]]) }));
    const g = after.get("r2");
    expect(g?.kind).toBe("planned");
    if (g?.kind === "planned") expect(g.value).toBe("400 lb");
    // the top set's own card is done: where next time starts
    expect(after.get("r1")?.kind).toBe("next");
  });

  it("a % of a training max on file reads the weight; with none on file it's the engine's like the logger", () => {
    const pctRow = { id: "r3", sort_order: 0, exercise_id: squatEx.id, exercises: squatEx, sets: 3, reps_text: "5", rpe: "7", percentage: 75, percentage_basis: "training_max" };
    const max = { id: "m", client_id: "c", lift: "Competition Squat", exercise_id: squatEx.id, one_rm: null, training_max: 200, estimated_1rm: null, unit: "kg", notes: null, tested_at: null, source: "manual", active: true, source_lift: null, source_exercise_id: null, variation_modifier: null, manual_override: false, rounding_step: null, rounding_mode: "nearest", block_id: null, updated_at: new Date().toISOString() } as any;
    const withMax = dayGuides(base({ rows: [pctRow], units: { "row:r3": "kg" }, history: new Map([["r3", squatHistory]]), maxes: [max] }));
    const g = withMax.get("r3");
    expect(g?.kind).toBe("planned");
    if (g?.kind === "planned") {
      expect(g.value).toBe("150 kg");
      expect(g.label).toMatch(/75% .*TM/);
    }
    const none = dayGuides(base({ rows: [pctRow], units: { "row:r3": "kg" }, history: new Map([["r3", squatHistory]]) }));
    expect(none.get("r3")?.kind).toBe("suggested");
  });

  it("an accessory on a rep range is double progression from last session", () => {
    const row = { id: "r4", sort_order: 0, exercise_id: rdlEx.id, exercises: rdlEx, sets: 3, reps_text: "8-12", rpe: "8" };
    const history = session(rdlEx, 6, [[60, 12, 8], [60, 12, 8], [60, 12, 8]]);
    const g = dayGuides(base({ rows: [row], units: { "row:r4": "lb" }, history: new Map([["r4", history]]) })).get("r4");
    expect(g?.kind).toBe("suggested");
    if (g?.kind === "suggested") {
      expect(Number(g.shown)).toBeGreaterThan(60);
      // the change from last time, as the logger words it
      expect(g.plan).toBe(`+${Number(g.shown) - 60} lb`);
      expect(g.note).toBeNull();
    }
  });

  it("nothing to go on yet says so; timed, bodyweight, a coach's fixed weight and the day's cardio say nothing", () => {
    const fresh = { id: "r5", sort_order: 0, exercise_id: "ex-new", exercises: { id: "ex-new", name: "Barbell Row", equipment: "Barbell", movement_family: "accessory" }, sets: 3, reps_text: "8", rpe: "8" };
    expect(dayGuides(base({ rows: [fresh], history: new Map([["r5", []]]) })).get("r5")).toEqual({ kind: "pending", note: "After their first set" });
    const timed = { ...fresh, id: "r6", reps_text: "30 sec" };
    const bodyweight = { ...fresh, id: "r7", exercises: { ...fresh.exercises, default_load_type: "bodyweight" } };
    const fixed = { ...fresh, id: "r8", manual_override: true, load_lb: 135 };
    const cardio = { ...fresh, id: "r9", cardio_target_id: "ct" };
    const g = dayGuides(base({ rows: [timed, bodyweight, fixed, cardio], history: new Map() }));
    expect(g.size).toBe(0);
  });

  it("only on a workout still to do", () => {
    const today = "2026-11-23";
    expect(guidesShow({ status: "today", date: today }, today)).toBe(true);
    expect(guidesShow({ status: "in_progress", date: "2026-11-21" }, today)).toBe(true);
    expect(guidesShow({ status: "upcoming", date: "2026-11-25" }, today)).toBe(true);
    expect(guidesShow({ status: "done", date: today }, today)).toBe(false);
    expect(guidesShow({ status: "missed", date: "2026-11-20" }, today)).toBe(false);
    expect(guidesShow({ status: "upcoming", date: "2026-11-20" }, today)).toBe(false);
    expect(guidesShow(null, today)).toBe(false);
  });
});

describe("quick view: one path with the logger", () => {
  const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
  const qv = read("src/components/clients/workout-quick-view/quick-view.tsx");
  const guides = read("src/components/clients/workout-quick-view/load-guides.ts");

  it("the logger reads its cards' inputs through the shared helpers", () => {
    for (const fn of ["liftIdentityOf(", "historyByRow(", "dayReads(", "readinessFromReview(", "topSetBasisFor(", "backoffPlanFor(", "prescribedWeightFor(", "capHeldFor(", "progressionPlanFor(", "todaySetsIn(", "carryTodayIn(", "fetchClientLiftHistory(", "fetchLastOtherReview(", "fetchStrengthReadInputs("]) {
      expect(wdv).toContain(fn);
    }
    expect(read("src/components/workout-day/load-suggestion-card.tsx")).toContain("suggestionBadge(hint, model)");
  });

  it("the quick view uses the same keys and engine, and shows the line under the plan", () => {
    expect(guides).toContain("liftHistoryKey(clientId, identities)");
    expect(guides).toContain('["load-bodyweight", clientId]');
    expect(guides).toContain('["load-readiness", clientId, dayId]');
    expect(guides).toContain("dayGuides({");
    expect(qv).toContain("usePeekLoadGuides(");
    expect(qv).toContain("data-load-guide={guide.kind}");
  });
});

describe("quick view: the setup and rest their card shows", () => {
  it("a card with no programmed rest shows the usual one for the kind of exercise, said to be the usual", async () => {
    const { buildPeekDay } = await import("@/lib/workout-peek");
    const { cardRest } = await import("@/lib/exercise-metadata");
    const row = { id: "x", sort_order: 0, exercise_id: squatEx.id, exercises: squatEx, sets: 3, reps_text: "5", rpe: "7" };
    const day = buildPeekDay({ day: null, rows: [row], results: [], completions: [], notes: [], feedback: null } as any, { instanceId: null, weekIndex: 1 });
    const rest = cardRest(row as any);
    expect(rest.usual).toBe(true);
    expect(rest.seconds).toBeGreaterThan(0);
    expect(day.exercises[0].rest).toEqual({ seconds: rest.seconds, usual: true });
  });

  it("the setup line is their card's: what the sets were logged on, else today's pick, never a retired setup for an old workout", async () => {
    const { cardSetupView } = await import("@/lib/equipment/equipment");
    const now = Date.parse("2026-11-23T18:00:00Z");
    const data = {
      gyms: [],
      equipment: [
        { id: "rack-1", name: "Rogue rack", kind: "rack", archived_at: null } as any,
        { id: "rack-2", name: "Garage rack", kind: "rack", archived_at: null } as any,
      ],
      setups: [
        { exercise_id: squatEx.id, equipment_id: "rack-1", settings: [{ label: "J-hooks", value: "9" }, { label: "Safeties", value: "4" }], last_used_at: "2026-11-20T00:00:00Z" } as any,
        { exercise_id: squatEx.id, equipment_id: "rack-2", settings: [{ label: "J-hooks", value: "11" }], last_used_at: "2026-10-01T00:00:00Z" } as any,
      ],
    };
    // nothing logged yet: today's pick (the newest used)
    expect(cardSetupView(data as any, squatEx.id, [], now).summary).toBe("Rogue rack · J-hooks 9 · Safeties 4");
    // logged on the garage rack: that's what it says
    expect(cardSetupView(data as any, squatEx.id, [{ completed_at: "2026-11-23T17:00:00Z", equipment_id: "rack-2" }], now).summary).toBe("Garage rack · J-hooks 11");
    // an old workout with nothing stamped: never today's pick
    expect(cardSetupView(data as any, squatEx.id, [{ completed_at: "2026-09-01T17:00:00Z", equipment_id: null }], now).summary).toBe("");
  });

  it("the logger reads both the same way, and the drawer shows them", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("cardSetupView(equipmentData, exerciseId, existingResults as any[])");
    expect(wdv).toContain("cardRest(row)");
    const qv = read("src/components/clients/workout-quick-view/quick-view.tsx");
    expect(qv).toContain("data-setup");
    expect(qv).toContain('data-rest={ex.rest.usual ? "usual" : "program"}');
    expect(qv).toContain("cardSetupView(equipment, ex.exerciseId, ex.sets)");
  });
});
