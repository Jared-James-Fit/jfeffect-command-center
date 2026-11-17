import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildTrajectory, recentTrend, type WeighIn } from "@/lib/weight-management/trajectory";
import { decide, goalPlanConflict, persistentGut, SETTLE_DAYS, type DecisionInput } from "@/lib/weight-management/decision";
import { buildAssessment, type AssessmentInput } from "@/lib/weight-management/assessment";
import { readDigestion } from "@/lib/weight-management/digestion";
import { needsCoach } from "@/lib/weight-management/reviews.server";
import { addDays } from "@/lib/weight-management/units";

/**
 * Edge cases from the production audit (Nov 17 2026): every client's real
 * records replayed through the loader week by week found two calorie changes
 * that would have been noise, a gut problem hidden behind "hold", a stale
 * weigh-in read as "reached" three weeks before a 57 kg meet, and a plan and
 * a goal pointing different ways. Each case below is one of those, or a
 * neighbour of it.
 */
const TODAY = "2026-11-17";

function series(days: number, endKg: number, kgPerWeek: number, amp = 0, end = TODAY, every = 1): WeighIn[] {
  const out: WeighIn[] = [];
  for (let i = days - 1; i >= 0; i -= every) out.push({ date: addDays(end, -i), kg: endKg - (kgPerWeek * i) / 7 + (amp ? amp * Math.sin(i * 2.3) : 0) });
  return out;
}

function input(o: Partial<DecisionInput> & { weighIns?: WeighIn[]; goal?: { kg: number; date: string | null; kind: "at_most" | "at_least" | "around" } | null }): DecisionInput {
  const trajectory = buildTrajectory({ weighIns: o.weighIns ?? series(35, 86, -0.4, 0.2), today: TODAY, goal: o.goal === undefined ? { kg: 83, date: addDays(TODAY, 56), kind: "at_most" } : o.goal });
  return {
    today: TODAY,
    unit: "kg",
    direction: "lose",
    context: "fat_loss",
    level: "intermediate",
    target: null,
    plan: { start: "2026-09-01", weeklyKcal: 2600 },
    kcalFloor: 1500,
    adherence: { avg: 4.5, checkins: 3 },
    recovery: { poorSleep: 0, lowEnergy: 0, stress: 0, hungerHigh: false, of: 3 },
    performance: { lower: "steady", detail: null },
    cardio: { plan: { trainingDay: null, restDay: { minutes: 25, speedMph: 3, inclinePct: 5, perWeek: 2, weekdays: ["Wednesday", "Saturday"] } }, treadmill: true, lastChanged: "2026-09-01", issues: [] },
    digestion: null,
    waist: null,
    meetWeeksOut: null,
    powerlifter: false,
    stepCtx: { bodyweightKg: 86, trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"], unit: "mph" },
    ...o,
    trajectory,
  } as DecisionInput;
}

const gut = (flags: boolean[]) =>
  readDigestion(
    flags.map((f, i) => ({ date: addDays(TODAY, -7 * i), answers: f ? { recovery_flags: ["Digestion / bloating"], digestion_symptoms: ["Bloating"], digestion_severity: 2 } : { recovery_flags: ["All good"] } })),
    [],
    null,
  );

describe("irregular weigh-ins", () => {
  it("a burst of weigh-ins then nothing is not a trend, and never a change", () => {
    const burst = [0, 1, 2, 3, 4].map((i) => ({ date: addDays(TODAY, -16 - i), kg: 86 - i * 0.3 }));
    const d = decide(input({ weighIns: burst }));
    expect(d.verdict).toBe("need_data");
    expect(d.material).toBe(false);
  });
  it("every 5 days for 6 weeks is enough for a trend, read with its scatter", () => {
    const sparse = series(42, 86, -0.5, 0.3, TODAY, 5);
    expect(sparse.length).toBeGreaterThanOrEqual(8);
    expect(recentTrend(sparse)).not.toBeNull();
  });
  it("one weigh-in from weeks ago is never 'reached', even when it's under the goal", () => {
    const t = buildTrajectory({ weighIns: [{ date: addDays(TODAY, -29), kg: 56.4 }], today: TODAY, goal: { kg: 56.7, date: addDays(TODAY, 18), kind: "at_most" } });
    expect(t.status).toBe("not_enough_data");
  });
});

describe("no change on data that can't carry one", () => {
  it("a rate a hair past the limit is inside its own uncertainty: hold", () => {
    // maintenance, drifting down ~0.5%/week with daily scatter: Nov 3 for a real client, flat a week later
    const d = decide(input({ direction: "maintain", context: "maintain", goal: null, weighIns: series(28, 63, -0.33, 0.45) }));
    expect(d.material).toBe(false);
  });
  it("a new cut's first two weeks lose fast (water and glycogen): never 'add food back'", () => {
    const d = decide(input({ plan: { start: addDays(TODAY, -9), weeklyKcal: 2400 }, weighIns: series(30, 84, -1.6, 0.1) }));
    expect(d.verdict).toBe("maintain");
    expect(d.limiting).toBe("settling");
  });
  it("a new gain phase isn't trimmed before it's read on its own weigh-ins (day 28)", () => {
    const d = decide(input({ direction: "gain", context: "gain", goal: null, plan: { start: addDays(TODAY, -14), weeklyKcal: 3200 }, weighIns: series(30, 80, 0.7, 0.2) }));
    expect(d.limiting).toBe("settling");
    expect(d.material).toBe(false);
    expect(SETTLE_DAYS).toBe(28);
  });
  it("past its water weeks, losing clearly too fast still gets food back (safety isn't held)", () => {
    const d = decide(input({ plan: { start: addDays(TODAY, -20), weeklyKcal: 2200 }, weighIns: series(30, 82, -1.5, 0.05) }));
    expect(d.verdict).toBe("adjust");
    expect(d.actions[0]).toMatchObject({ kind: "nutrition" });
    expect((d.actions[0] as any).kcalPerDay).toBeGreaterThan(0);
  });
  it("on track on a plan past day 28: hold, the most common answer", () => {
    const d = decide(input({}));
    expect(d.verdict).toBe("maintain");
    expect(d.material).toBe(false);
  });
});

describe("the limiting factor isn't hidden behind 'hold'", () => {
  it("digestion flagged most weeks surfaces even on track or settling, never as a calorie change", () => {
    expect(persistentGut(gut([true, true, false]))).toBe(true);
    expect(persistentGut(gut([true, false, false]))).toBe(false);
    const onTrack = decide(input({ digestion: gut([true, true, true]) }));
    expect(onTrack).toMatchObject({ verdict: "investigate", limiting: "digestion", material: false });
    expect(onTrack.actions.some((a) => a.kind === "digestion")).toBe(true);
    const settling = decide(input({ plan: { start: addDays(TODAY, -5), weeklyKcal: 2400 }, digestion: gut([true, true, true]) }));
    expect(settling.limiting).toBe("digestion");
    // one bad week isn't a pattern
    expect(decide(input({ digestion: gut([true, false, false]) })).verdict).toBe("maintain");
  });
  it("missed check-ins: one check-in is never enough to call consistency the problem", () => {
    const stalled = series(28, 86, 0, 0.2);
    const d = decide(input({ weighIns: stalled, adherence: { avg: 2, checkins: 1 } }));
    expect(d.limiting).not.toBe("adherence");
  });
});

describe("plan and goal disagree", () => {
  it("names the conflict only for clear opposites", () => {
    expect(goalPlanConflict("lose", "Maintenance", "to get to 65 kg")).toMatch(/plan is Maintenance but their bodyweight goal is to get to 65 kg/);
    expect(goalPlanConflict("gain", "Fat Loss", "x")).not.toBeNull();
    expect(goalPlanConflict("lose", "Recomp", "x")).toBeNull();
    expect(goalPlanConflict("lose", "Fat Loss", "x")).toBeNull();
    expect(goalPlanConflict(null, "Maintenance", "x")).toBeNull();
  });
  it("nothing moves until the coach says which is current (losing too fast still protects first)", () => {
    const flat = series(35, 66, 0, 0.2);
    const d = decide(input({ weighIns: flat, goal: { kg: 65, date: null, kind: "at_most" }, conflict: "Their nutrition plan is Maintenance but their bodyweight goal is to get to 65 kg. Which one is current?" }));
    expect(d).toMatchObject({ verdict: "investigate", limiting: "target", material: false });
    // said even while weigh-ins are missing
    const blind = decide(input({ weighIns: [], conflict: "x" }));
    expect(blind.reasons).toContain("x");
  });
});

describe("competition dates", () => {
  const raw = (o: Partial<AssessmentInput> = {}): AssessmentInput => ({
    today: TODAY,
    unit: "kg",
    speedUnit: "kmh",
    sex: "F",
    age: 24,
    heightCm: 160,
    level: "intermediate",
    weighIns: [{ date: "2026-10-19", kg: 56.4 }],
    goal: null,
    meet: { name: "Provincials", date: "2026-12-05", weightClass: "57", federation: "CPU", sport: "powerlifting" },
    powerlifter: true,
    plan: { start: null, weeklyKcal: null, phase: null, starts: [] },
    checkins: [],
    cardio: { targets: [], lastChanged: null, history: null, done: null, planned: null },
    trainingDays: ["Monday", "Wednesday", "Friday"],
    heavyLowerDays: [],
    sessionMinutes: 75,
    dailySteps: null,
    water: { avgMl: null, targetMl: null, daysLogged: 0 },
    waist: [],
    performance: { lower: null, detail: null },
    health: { walkingLimits: [], fluidRestriction: false },
    profile: { climate: null, sweat: null, maxIncline: null, availableMinutes: null },
    pastPhases: [],
    ...o,
  });

  it("a class meet in 3 weeks with no weigh-ins since October: said plainly, and the coach hears it now", () => {
    const a = buildAssessment(raw());
    expect(a.recommendation.verdict).toBe("need_data");
    expect(a.recommendation.headline).toMatch(/^Meet in 3 weeks: not enough weigh-ins since Oct 19/);
    expect(a.recommendation.reasons.join(" ")).not.toMatch(/needs 0/);
    expect(needsCoach(a)).toBe(true);
  });
  it("the same gap with the meet moved past 4 weeks: still need data, no push", () => {
    const a = buildAssessment(raw({ meet: { name: "Provincials", date: "2027-01-30", weightClass: "57", federation: "CPU", sport: "powerlifting" } }));
    expect(a.recommendation.verdict).toBe("need_data");
    expect(needsCoach(a)).toBe(false);
  });
  it("a meet moved closer makes the same pace harder: the goal and its weeks follow the date", () => {
    const steady = series(35, 58.2, -0.3, 0.1);
    const far = buildAssessment(raw({ weighIns: steady, meet: { name: "Provincials", date: "2027-02-20", weightClass: "57", federation: "CPU", sport: "powerlifting" } }));
    const near = buildAssessment(raw({ weighIns: steady, meet: { name: "Provincials", date: "2026-12-01", weightClass: "57", federation: "CPU", sport: "powerlifting" } }));
    expect(far.goal?.date).toBe("2027-02-20");
    expect(near.goal?.date).toBe("2026-12-01");
    expect(near.meetWeeksOut!).toBeLessThan(far.meetWeeksOut!);
    // never a dehydration answer, whatever the date
    expect(JSON.stringify(near.recommendation)).not.toMatch(/dehydrat|water load|sauna|diuretic/i);
  });
});

describe("deactivated, archived and non-coaching clients are never sent anything", () => {
  it("both senders filter them", () => {
    const coord = readFileSync("supabase/migrations/20270402091000_checkin_coordination.sql", "utf8");
    const nutrition = readFileSync("supabase/migrations/20270403090000_nutrition_update_in_checkin.sql", "utf8");
    for (const sql of [coord, nutrition]) {
      expect(sql).toMatch(/not in \('Deactivated', 'Deleted'\)/);
      expect(sql).toMatch(/service_tier = 'coaching'/);
      expect(sql).toMatch(/coalesce\(c\.archived, false\) = false/);
    }
  });
});
