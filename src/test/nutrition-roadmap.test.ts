/**
 * The nutrition roadmap engine on the scenarios it has to get right: blocks,
 * feasibility, feedback, check-in timing and safe adjustments. Each athlete
 * is built from the same records the loader reads (src/lib/nutrition-roadmap).
 */
import { describe, expect, it } from "vitest";
import { buildAssessment, type AssessmentInput } from "@/lib/weight-management/assessment";
import type { CheckinRow } from "@/lib/weight-management/digestion";
import type { WeighIn } from "@/lib/weight-management/trajectory";
import { addDays, daysBetween } from "@/lib/weight-management/units";
import { buildRoadmap, compareRoadmaps, type RoadmapInput } from "@/lib/nutrition-roadmap/build";
import { activityFactor, estimateEnergy, macrosFor, restingEnergy, splitDays } from "@/lib/nutrition-roadmap/energy";
import { screenSafety } from "@/lib/nutrition-roadmap/safety";
import { roadmapCheckinQuestions, missingAnswers } from "@/lib/nutrition-roadmap/questions";
import { roadmapText } from "@/lib/nutrition-roadmap/text";
import type { Macros, RoadmapPlan } from "@/lib/nutrition-roadmap/types";

const TODAY = "2026-11-22";

/** A weigh-in every day for `days` days ending `end`: a straight trend plus a repeatable wobble (± amp kg). */
function series(days: number, endKg: number, kgPerWeek: number, amp = 0.2, end = TODAY): WeighIn[] {
  const out: WeighIn[] = [];
  for (let i = days - 1; i >= 0; i--) out.push({ date: addDays(end, -i), kg: endKg - (kgPerWeek * i) / 7 + (amp ? amp * Math.sin(i * 2.3) : 0) });
  return out;
}

function checkins(ratings: number[], extra: Record<string, unknown> = {}, end = TODAY): CheckinRow[] {
  return ratings.map((r, i) => ({ date: addDays(end, -7 * i), answers: { nutrition_rating: r, recovery_flags: ["All good"], ...extra } }));
}

function athlete(o: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    today: TODAY,
    unit: "kg",
    speedUnit: "kmh",
    sex: "M",
    age: 30,
    heightCm: 178,
    level: "intermediate",
    weighIns: series(28, 90, 0),
    goal: null,
    meet: null,
    powerlifter: false,
    plan: { start: null, weeklyKcal: null, phase: null, starts: [] },
    checkins: checkins([4.5, 4.5, 4.5]),
    cardio: { targets: [], lastChanged: null, history: null, done: null, planned: null },
    trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"],
    heavyLowerDays: [],
    sessionMinutes: 75,
    dailySteps: 8000,
    water: { avgMl: null, targetMl: null, daysLogged: 0 },
    waist: [],
    performance: { lower: "steady", detail: null },
    health: { walkingLimits: [], fluidRestriction: false },
    profile: { climate: null, sweat: null, maxIncline: null, availableMinutes: null },
    pastPhases: [],
    ...o,
  };
}

function roadmap(inp: AssessmentInput, o: Partial<RoadmapInput> = {}) {
  return buildRoadmap({
    today: inp.today,
    input: inp,
    assessment: buildAssessment(inp),
    selfCoached: false,
    planNow: null,
    current: null,
    targetsChangedOn: null,
    observed: null,
    healthTexts: [],
    answers: [],
    recentEvent: null,
    nextEvent: null,
    prefs: { everyDays: null, lockCompetition: false },
    consent: false,
    active: null,
    lastCheckin: null,
    missedCheckins: 0,
    ...o,
  });
}

const kcalOf = (m: Macros) => m.proteinG * 4 + m.carbsG * 4 + m.fatG * 9;

describe("energy and macros", () => {
  it("Mifflin–St Jeor resting energy and an activity factor from steps and training days", () => {
    expect(restingEnergy({ sex: "M", age: 30, heightCm: 180, kg: 80 })).toBe(1780);
    expect(restingEnergy({ sex: "F", age: 30, heightCm: 165, kg: 60 })).toBe(1320);
    expect(restingEnergy({ sex: null, age: 30, heightCm: 180, kg: 80 })).toBeNull();
    expect(activityFactor({ steps: 4000, trainingDays: 0 })).toBe(1.3);
    expect(activityFactor({ steps: 11000, trainingDays: 4 })).toBeCloseTo(1.72, 2);
  });

  it("their own results beat the formula, and a missing height says what would tighten it", () => {
    const formula = estimateEnergy({ sex: "M", age: 30, heightCm: 180, kg: 80, trainingDays: 4, steps: 8000, observed: null });
    expect(formula.source).toBe("formula");
    expect(formula.confidence).toBe("low");
    const seen = estimateEnergy({ sex: "M", age: 30, heightCm: 180, kg: 80, trainingDays: 4, steps: 8000, observed: { kcal: 3100, from: "logged food", confidence: "high", why: "logged" } });
    expect(seen.kcal).toBe(3100);
    expect(seen.source).toBe("observed");
    const rough = estimateEnergy({ sex: null, age: null, heightCm: null, kg: 80, trainingDays: 4, steps: null, observed: null });
    expect(rough.source).toBe("bodyweight");
    expect(rough.why).toMatch(/Height, date of birth and sex/);
    expect(rough.highKcal - rough.lowKcal).toBeGreaterThan(formula.highKcal - formula.lowKcal);
  });

  it("the energy floor is resting energy or 25% under maintenance, whichever is higher", () => {
    const e = estimateEnergy({ sex: "F", age: 28, heightCm: 160, kg: 55, trainingDays: 4, steps: 7000, observed: null });
    expect(e.floorKcal).toBeGreaterThanOrEqual(e.rmr!);
    expect(e.floorKcal).toBeGreaterThanOrEqual(Math.round(e.kcal * 0.75 / 25) * 25 - 25);
  });

  it("macros add up, protein is higher in a deficit, fat never under 0.6 g/kg", () => {
    const cut = macrosFor({ kcal: 2200, kg: 80, heightCm: 180, vsMaintenance: -500 });
    const bulk = macrosFor({ kcal: 3200, kg: 80, heightCm: 180, vsMaintenance: 250 });
    expect(Math.abs(kcalOf(cut) - 2200)).toBeLessThanOrEqual(30);
    expect(Math.abs(kcalOf(bulk) - 3200)).toBeLessThanOrEqual(30);
    expect(cut.proteinG / 80).toBeGreaterThanOrEqual(2.0);
    expect(bulk.proteinG / 80).toBeCloseTo(1.8, 1);
    expect(cut.fatG).toBeGreaterThanOrEqual(48);
  });

  it("protein for a higher BMI is worked from an adjusted weight, never a body-fat guess", () => {
    const m = macrosFor({ kcal: 2600, kg: 130, heightCm: 178, vsMaintenance: -600 });
    expect(m.proteinG).toBeLessThan(130 * 2.2);
  });

  it("a training/rest split keeps the weekly average and only moves carbs", () => {
    const avg = { kcal: 2600, proteinG: 180, carbsG: 300, fatG: 75 };
    const s = splitDays(avg, 4, 80)!;
    expect(s.training.proteinG).toBe(180);
    expect(s.rest.fatG).toBe(75);
    expect(Math.abs((s.training.kcal * 4 + s.rest.kcal * 3) / 7 - 2600)).toBeLessThan(15);
    expect(splitDays(avg, 6, 80)).toBeNull();
  });
});

describe("1. a realistic 12-week fat-loss goal", () => {
  const inp = athlete({ goal: { type: "lose", kg: 84, kgMax: null, date: addDays(TODAY, 84) } });
  const { fresh, read } = roadmap(inp);

  it("is realistic, with a controlled deficit that ends on the date", () => {
    expect(fresh.feasibility.verdict).toBe("realistic");
    expect(fresh.feasibility.required!.kgPerWeek).toBeCloseTo(-0.5, 1);
    const cut = fresh.blocks.find((b) => b.kind === "fat_loss")!;
    expect(cut).toBeTruthy();
    expect(cut.energy.vsMaintenance).toBeLessThan(-300);
    expect(cut.energy.proteinG / 90).toBeGreaterThanOrEqual(2.0);
    const lastWeight = [...fresh.blocks].reverse().find((b) => b.kind === "fat_loss")!;
    expect(Math.abs(lastWeight.weight!.targetKg - 84)).toBeLessThan(0.6);
    expect(Math.abs(daysBetween(lastWeight.end, addDays(TODAY, 84)))).toBeLessThanOrEqual(1);
  });

  it("checkpoints every two weeks and a hold after", () => {
    const cut = fresh.blocks.find((b) => b.kind === "fat_loss")!;
    expect(cut.checkpoints.length).toBeGreaterThanOrEqual(5);
    expect(daysBetween(cut.checkpoints[0].date, cut.checkpoints[1].date)).toBe(14);
    expect(fresh.blocks[fresh.blocks.length - 1].kind).toBe("transition");
  });

  it("only the current block is final; a coached athlete's numbers are their coach's plan, never offered from the estimate", () => {
    expect(fresh.blocks.filter((b) => b.final)).toHaveLength(1);
    expect(read.decision.action).toBe("hold");
    expect(read.decision.kcalChange).toBeNull();
    expect(read.decision.reasons.join(" ")).toContain(`${read.currentBlock!.energy.engine.kcal} kcal`);
  });

  it("a self-coached athlete with no targets yet is offered the block's targets, theirs to accept", () => {
    const r = roadmap(inp, { selfCoached: true });
    expect(r.read.decision.action).toBe("adjust");
    expect(r.read.decision.next?.kcal).toBe(r.read.currentBlock!.energy.engine.kcal);
    expect(r.read.decision.approval).toBe("athlete");
  });

  it("a coached athlete on a maintenance plan is offered the block's deficit, for the coach to approve", () => {
    const plan = { start: "2026-10-01", phase: "Maintenance", days: [{ label: "Training Day", kcal: 2950, protein: 180, carbs: 380, fat: 80 }], weeklyKcal: 2950 };
    const r = roadmap(inp, { planNow: plan, current: { kcal: 2950, proteinG: 180, carbsG: 380, fatG: 80 }, targetsChangedOn: "2026-10-01" });
    expect(r.read.decision.action).toBe("adjust");
    expect(r.read.decision.kcalChange!).toBeLessThan(-300);
    expect(r.read.decision.approval).toBe("coach");
    expect(r.read.decision.autoEligible).toBe(false);
  });
});

describe("2. a highly unrealistic six-week weight-loss goal", () => {
  const inp = athlete({ weighIns: series(28, 85, 0), goal: { type: "lose", kg: 75, kgMax: null, date: addDays(TODAY, 42) } });
  const { fresh } = roadmap(inp);
  it("refuses to agree with it, says why, and offers ways that work", () => {
    expect(["unlikely", "unsafe"]).toContain(fresh.feasibility.verdict);
    expect(fresh.feasibility.reasons.join(" ")).toMatch(/past the 1%\/week/);
    const kinds = fresh.feasibility.alternatives.map((a) => a.kind);
    expect(kinds).toContain("extend");
    expect(kinds).toContain("revise_target");
    const later = fresh.feasibility.alternatives.find((a) => a.kind === "extend")!;
    expect(daysBetween(TODAY, later.date!)).toBeGreaterThan(80);
  });
  it("never plans past the safe rate: the roadmap ends short of 75 kg", () => {
    const cut = fresh.blocks.filter((b) => b.kind === "fat_loss");
    for (const b of cut) expect(Math.abs(b.rate.pctPerWeek)).toBeLessThanOrEqual(1.01);
    expect(cut[cut.length - 1].weight!.targetKg).toBeGreaterThan(78);
    expect(fresh.feasibility.reasons.join(" ")).toMatch(/ends short/);
  });
});

describe("3. a 66 kg powerlifter, meet with a two-hour weigh-in", () => {
  const meetDate = addDays(TODAY, 84);
  const inp = athlete({
    weighIns: series(28, 68.4, -0.1, 0.25),
    powerlifter: true,
    meet: { name: "CPU Nationals", date: meetDate, weightClass: "66", federation: "CPU", sport: "powerlifting" },
  });
  const { fresh } = roadmap(inp);
  it("plans to the class less a buffer, in a normal state, made before the peak", () => {
    expect(fresh.goal?.kind).toBe("weight_class");
    expect(fresh.goal?.kg).toBeLessThan(66);
    expect(fresh.goal?.kg).toBeGreaterThan(65.3);
    expect(fresh.goal?.weighInHours).toBe(2);
    expect(["realistic", "aggressive"]).toContain(fresh.feasibility.verdict);
  });
  it("cut, then a fueled peak, then meet week ending on the meet, then recovery", () => {
    const kinds = fresh.blocks.map((b) => b.kind);
    expect(kinds).toEqual(expect.arrayContaining(["pl_prep", "performance", "taper", "post_comp", "transition"]));
    const taper = fresh.blocks.find((b) => b.kind === "taper")!;
    expect(taper.end).toBe(meetDate);
    const peak = fresh.blocks.find((b) => b.kind === "performance")!;
    expect(peak.energy.vsMaintenance).toBe(0);
    expect(peak.weight!.targetKg).toBeLessThanOrEqual(66);
    const prep = fresh.blocks.find((b) => b.kind === "pl_prep")!;
    expect(prep.end < peak.start).toBe(true);
  });
  it("never plans dehydration or an acute cut, and says the 2-hour rule", () => {
    const taper = fresh.blocks.find((b) => b.kind === "taper")!;
    expect(taper.priorities.join(" ")).toMatch(/2-hour weigh-in/);
    expect(taper.why).toMatch(/never plans dehydration/);
    const all = JSON.stringify(fresh.blocks);
    expect(all).not.toMatch(/sauna protocol|water load(ing)? (to|for)|diuretics? (to|for)/i);
  });
  it("a far-off meet with a small gap fuels training first and cuts later", () => {
    const far = athlete({ weighIns: series(28, 67.2, 0), powerlifter: true, meet: { name: "Provincials", date: addDays(TODAY, 26 * 7), weightClass: "66", federation: "CPU", sport: "powerlifting" } });
    const r = roadmap(far).fresh;
    expect(r.blocks[0].kind === "performance" || r.blocks[0].kind === "baseline").toBe(true);
    const prep = r.blocks.find((b) => b.kind === "pl_prep")!;
    expect(daysBetween(TODAY, prep.start)).toBeGreaterThan(30);
  });
});

describe("4. a powerlifter targeting a class where the trade-off is questionable", () => {
  const inp = athlete({ weighIns: series(28, 81, 0), powerlifter: true, meet: { name: "Spring Open", date: addDays(TODAY, 70), weightClass: "74", federation: "CPU", sport: "powerlifting" } });
  const { fresh, read } = roadmap(inp);
  it("calls it out, names the next class up and putting the total first", () => {
    expect(["unlikely", "unsafe"]).toContain(fresh.feasibility.verdict);
    const alt = fresh.feasibility.alternatives;
    expect(alt.some((a) => a.kind === "weight_class" && /83/.test(a.label))).toBe(true);
    expect(alt.some((a) => a.kind === "performance")).toBe(true);
    expect(fresh.feasibility.tradeoffs.join(" ")).toMatch(/lowest class isn't always the best total/);
  });
  it("recommends rethinking the target, never a harder cut", () => {
    expect(["reconsider", "adjust", "hold", "investigate"]).toContain(read.decision.action);
    if (read.decision.kcalChange != null) expect(read.decision.next!.kcal).toBeGreaterThanOrEqual(read.currentBlock!.energy.floorKcal);
  });
});

describe("5. a bodybuilder's long contest prep", () => {
  const show = addDays(TODAY, 24 * 7);
  const inp = athlete({ weighIns: series(28, 88, 0), goal: { type: "lose", kg: 79, kgMax: null, date: show }, meet: { name: "Provincial Classic", date: show, weightClass: null, federation: null, sport: "bodybuilding" } });
  const { fresh } = roadmap(inp);
  it("prep slows in the final weeks, protein goes up, show week holds, then a gradual recovery", () => {
    expect(fresh.goal?.kind).toBe("contest_prep");
    const preps = fresh.blocks.filter((b) => b.kind === "contest_prep");
    expect(preps.length).toBeGreaterThanOrEqual(2);
    const late = preps[preps.length - 1];
    const early = preps[0];
    expect(Math.abs(late.rate.kgPerWeek)).toBeLessThan(Math.abs(early.rate.kgPerWeek));
    expect(late.energy.proteinG / ((late.weight!.startKg + late.weight!.targetKg) / 2)).toBeGreaterThanOrEqual(2.3);
    const showWeek = fresh.blocks.find((b) => b.kind === "taper")!;
    expect(showWeek.end).toBe(show);
    expect(showWeek.priorities.join(" ")).toMatch(/No water, sodium or carb loading/);
    const post = fresh.blocks.find((b) => b.kind === "post_comp")!;
    expect(post.weeks).toBe(4);
    expect(post.energy.notes.join(" ")).toMatch(/Step calories up/);
  });
});

describe("6. an advanced athlete in a controlled gain", () => {
  const inp = athlete({ level: "advanced", weighIns: series(28, 85, 0.05), goal: { type: "gain", kg: 87, kgMax: null, date: addDays(TODAY, 24 * 7) } });
  const { fresh } = roadmap(inp);
  it("a small surplus at an advanced lifter's rate, then a hold", () => {
    expect(fresh.feasibility.verdict).toBe("realistic");
    const surplus = fresh.blocks.filter((b) => b.kind === "surplus");
    expect(surplus.length).toBeGreaterThanOrEqual(2);
    for (const b of surplus) {
      expect(b.energy.vsMaintenance).toBeGreaterThan(0);
      expect(b.energy.vsMaintenance).toBeLessThanOrEqual(200);
    }
    expect(fresh.blocks[fresh.blocks.length - 1].kind).toBe("maintenance");
  });
  it("gaining far faster than planned is called out and trimmed, not praised", () => {
    const madeOn = addDays(TODAY, -35);
    const start = athlete({ today: madeOn, level: "advanced", weighIns: series(28, 85, 0, 0.2, madeOn), goal: { type: "gain", kg: 87, kgMax: null, date: addDays(madeOn, 24 * 7) } });
    const active = roadmap(start).fresh;
    const engine = active.blocks[0].energy.engine;
    const now = athlete({ level: "advanced", weighIns: [...series(28, 85, 0, 0.2, madeOn), ...series(35, 87.5, 0.5, 0.2)], goal: { type: "gain", kg: 87, kgMax: null, date: addDays(madeOn, 24 * 7) } });
    const r = roadmap(now, { active, current: engine, targetsChangedOn: madeOn, planNow: { start: madeOn, phase: "Muscle Gain", days: [{ label: "Training Day", kcal: engine.kcal, protein: engine.proteinG, carbs: engine.carbsG, fat: engine.fatG }], weeklyKcal: engine.kcal } });
    expect(r.read.progress.status === "ahead" || r.read.progress.status === "needs_attention").toBe(true);
    expect(r.read.decision.kcalChange ?? 0).toBeLessThan(0);
  });
});

/** A roadmap made `weeksAgo` and their weigh-ins since then following `rate` (kg a week). */
function onRoadmap(weeksAgo: number, rate: number, o: { amp?: number; ratings?: number[]; spike?: number; goalKg?: number } = {}) {
  const madeOn = addDays(TODAY, -7 * weeksAgo);
  const before = series(28, 90, 0, 0.2, madeOn);
  const goal = { type: "lose" as const, kg: o.goalKg ?? 84, kgMax: null, date: addDays(madeOn, 84) };
  const start = athlete({ today: madeOn, weighIns: before, goal, checkins: checkins([4.5, 4.5], {}, madeOn) });
  const active = roadmap(start).fresh;
  const engine = active.blocks[0].energy.engine;
  const since = series(7 * weeksAgo, 90 + rate * weeksAgo, rate, o.amp ?? 0.2).slice(1);
  if (o.spike) since[since.length - 1] = { ...since[since.length - 1], kg: since[since.length - 1].kg + o.spike };
  const now = athlete({ weighIns: [...before, ...since], goal, checkins: checkins(o.ratings ?? [4.5, 5, 4.5]), plan: { start: madeOn, weeklyKcal: engine.kcal, phase: "Fat Loss", starts: [madeOn] } });
  const planNow = { start: madeOn, phase: "Fat Loss", days: [{ label: "Training Day", kcal: engine.kcal, protein: engine.proteinG, carbs: engine.carbsG, fat: engine.fatG }], weeklyKcal: engine.kcal };
  return { madeOn, active, engine, now, planNow };
}

describe("7. progressing exactly to plan: nothing changes", () => {
  const s = onRoadmap(5, -0.5);
  const r = roadmap(s.now, { active: s.active, current: s.engine, targetsChangedOn: s.madeOn, planNow: s.planNow, lastCheckin: addDays(TODAY, -1) });
  it("on track, hold, no change, and a two-week check-in", () => {
    expect(r.read.progress.status).toBe("on_track");
    expect(r.read.decision.action).toBe("hold");
    expect(r.read.decision.kcalChange).toBeNull();
    expect(r.read.decision.headline).toMatch(/No changes needed/);
    expect(r.read.progress.detail).not.toMatch(/No changes needed/);
    expect(r.read.checkin.cadenceDays).toBe(14);
  });
  it("a fresh plan from today isn't a meaningful change", () => {
    expect(compareRoadmaps(s.active, r.fresh, TODAY).meaningful).toBe(false);
  });
});

describe("8. poor adherence: calories aren't cut", () => {
  const s = onRoadmap(5, 0, { ratings: [3, 2, 3] });
  const r = roadmap(s.now, { active: s.active, current: s.engine, targetsChangedOn: s.madeOn, planNow: s.planNow });
  it("behind, but it investigates what's getting in the way and asks about it", () => {
    expect(["behind", "needs_attention"]).toContain(r.read.progress.status);
    expect(r.read.decision.action).toBe("investigate");
    expect(r.read.decision.kcalChange).toBeNull();
    expect(r.read.checkin.asks).toContain("barriers");
  });
  it("behind with consistent eating and a reliable trend is a small, conservative change", () => {
    const g = onRoadmap(5, -0.05, { ratings: [5, 4.5, 5] });
    const rr = roadmap(g.now, { active: g.active, current: g.engine, targetsChangedOn: g.madeOn, planNow: g.planNow });
    expect(rr.read.decision.action).toBe("adjust");
    expect(rr.read.decision.kcalChange!).toBeLessThan(0);
    expect(Math.abs(rr.read.decision.kcalChange!)).toBeLessThanOrEqual(250);
    expect(rr.read.decision.next!.kcal).toBeGreaterThanOrEqual(rr.fresh.energy.floorKcal);
    expect(rr.read.checkin.asks).toContain("tracking");
  });
  it("the last change gets time to show before another", () => {
    const g = onRoadmap(5, -0.05, { ratings: [5, 4.5, 5] });
    const rr = roadmap(g.now, { active: g.active, current: g.engine, targetsChangedOn: addDays(TODAY, -6), planNow: g.planNow });
    expect(rr.read.decision.action).toBe("hold");
    expect(rr.read.decision.headline).toMatch(/needs time to show/);
  });
});

describe("9. weight bouncing around despite consistent intake", () => {
  const s = onRoadmap(5, -0.5, { amp: 0.6, spike: 2.0 });
  const r = roadmap(s.now, { active: s.active, current: s.engine, targetsChangedOn: s.madeOn, planNow: s.planNow, sex: undefined } as any);
  it("reads the spike as water, not fat, holds the plan, and asks what can hold water", () => {
    expect(r.read.progress.detail).toMatch(/water, glycogen, sodium or gut content/);
    expect(r.read.decision.kcalChange == null || r.read.decision.kcalChange > 0).toBe(true);
    expect(r.read.checkin.asks).toContain("confounders");
    expect(r.read.checkin.cadenceDays).toBeLessThanOrEqual(7);
  });
});

describe("10. missed check-ins, missing logs, multiple goals, a moved deadline, coach overrides", () => {
  it("two missed check-ins need attention, and nothing changes", () => {
    const s = onRoadmap(5, -0.5);
    const r = roadmap(s.now, { active: s.active, current: s.engine, targetsChangedOn: s.madeOn, planNow: s.planNow, missedCheckins: 2, selfCoached: true });
    expect(r.read.progress.status).toBe("needs_attention");
    expect(r.read.decision.kcalChange).toBeNull();
  });
  it("no weigh-ins for over a week: insufficient data, hold, check in once there's data", () => {
    const inp = athlete({ weighIns: series(20, 88, -0.5, 0.2, addDays(TODAY, -15)), goal: { type: "lose", kg: 84, kgMax: null, date: addDays(TODAY, 70) } });
    const r = roadmap(inp, { current: { kcal: 2400, proteinG: 190, carbsG: 240, fatG: 70 }, active: roadmap(inp).fresh });
    expect(r.read.progress.status).toBe("insufficient_data");
    expect(r.read.decision.action).toBe("hold");
    expect(r.read.checkin.cadenceDays).toBe(7);
  });
  it("a meet and a bodyweight goal: the meet leads, the next competition is the transition", () => {
    const inp = athlete({ powerlifter: true, weighIns: series(28, 75, 0), goal: { type: "lose", kg: 72, kgMax: null, date: addDays(TODAY, 200) }, meet: { name: "Winter Open", date: addDays(TODAY, 56), weightClass: "74", federation: "CPU", sport: "powerlifting" } });
    const r = roadmap(inp, { nextEvent: { name: "Nationals", date: addDays(TODAY, 160) } });
    expect(r.fresh.goal?.kind).toBe("weight_class");
    const tr = r.fresh.blocks.find((b) => b.kind === "transition")!;
    expect(tr.objective).toMatch(/Nationals/);
  });
  it("a changed deadline is a meaningful reforecast, said in words", () => {
    const a = athlete({ goal: { type: "lose", kg: 84, kgMax: null, date: addDays(TODAY, 84) } });
    const b = athlete({ goal: { type: "lose", kg: 84, kgMax: null, date: addDays(TODAY, 112) } });
    const diff = compareRoadmaps(roadmap(a).fresh, roadmap(b).fresh, TODAY);
    expect(diff.meaningful).toBe(true);
    expect(diff.changes.join(" ")).toMatch(/Date:/);
  });
  it("a coach's cadence wins, and locked competition phases stay as approved", () => {
    const meet = addDays(TODAY, 84);
    const inp = athlete({ powerlifter: true, weighIns: series(28, 68.4, -0.1), meet: { name: "Nationals", date: meet, weightClass: "66", federation: "CPU", sport: "powerlifting" } });
    const active = roadmap(inp).fresh;
    const tweaked: RoadmapPlan = { ...active, blocks: active.blocks.map((b) => (b.kind === "performance" ? { ...b, energy: { ...b.energy, engine: { ...b.energy.engine, kcal: 9999 } } } : b)) };
    const r = roadmap(inp, { active: tweaked, prefs: { everyDays: 7, lockCompetition: true } });
    expect(r.read.checkin.reason).toMatch(/Your coach set check-ins every 7 days/);
    expect(r.fresh.blocks.find((b) => b.kind === "performance")!.energy.engine.kcal).toBe(9999);
    expect(r.fresh.blocks.find((b) => b.kind === "performance")!.locked).toBe(true);
  });
});

describe("11. health risks escalate, never restrict further", () => {
  it("a missed period in a deficit: needs attention, food back toward maintenance, a professional's review", () => {
    const s = onRoadmap(5, -0.5);
    const inp = { ...s.now, sex: "F" as const };
    const low = { ...s.engine, kcal: s.engine.kcal - 300 };
    const r = roadmap(inp, { active: s.active, current: low, targetsChangedOn: s.madeOn, planNow: s.planNow, answers: [{ date: addDays(TODAY, -2), answers: { cycle_changes: "Missed or late period" } }] });
    expect(r.read.plan.safety.flags.some((f) => f.key === "reds_cycle")).toBe(true);
    expect(r.read.progress.status).toBe("needs_attention");
    expect(r.read.decision.action).toBe("escalate");
    expect(r.read.decision.kcalChange ?? 0).toBeGreaterThanOrEqual(0);
    expect(r.read.checkin.kind).toBe("professional");
  });
  it("under 18: no weight-loss plan from the app", () => {
    const inp = athlete({ age: 16, goal: { type: "lose", kg: 80, kgMax: null, date: addDays(TODAY, 90) } });
    const r = roadmap(inp);
    expect(r.fresh.feasibility.verdict).toBe("unsafe");
    expect(r.fresh.safety.noDeficit).toBe(true);
    for (const b of r.fresh.blocks) expect(b.energy.engine.kcal).toBeGreaterThanOrEqual(r.fresh.energy.floorKcal);
    expect(r.fresh.blocks.every((b) => b.rate.kgPerWeek >= 0)).toBe(true);
  });
  it("an eating disorder history, pregnancy, a GLP-1 are screened from their own words", () => {
    expect(screenSafety({ age: 30, sex: "F", heightCm: 165, kg: 70, healthTexts: ["history of anorexia"], recentLowEnergy: 0, recentChecks: 0, cycleChanged: false, illness: false, trendPctPerWeek: null, intakeKcal: null, rmr: null, losing: true }).noDeficit).toBe(true);
    expect(screenSafety({ age: 30, sex: "F", heightCm: 165, kg: 70, healthTexts: ["currently pregnant"], recentLowEnergy: 0, recentChecks: 0, cycleChanged: false, illness: false, trendPctPerWeek: null, intakeKcal: null, rmr: null, losing: false }).referral).toMatch(/Pregnancy/);
    const glp = screenSafety({ age: 40, sex: "M", heightCm: 180, kg: 110, healthTexts: ["on Ozempic"], recentLowEnergy: 0, recentChecks: 0, cycleChanged: false, illness: false, trendPctPerWeek: null, intakeKcal: null, rmr: null, losing: true });
    expect(glp.noDeficit).toBe(false);
    expect(glp.conservative).toBe(true);
    expect(screenSafety({ age: 30, sex: "M", heightCm: 180, kg: 80, healthTexts: ["None"], recentLowEnergy: 0, recentChecks: 0, cycleChanged: false, illness: false, trendPctPerWeek: null, intakeKcal: null, rmr: null, losing: true }).flags).toHaveLength(0);
  });
  it("a conservative health note keeps a loss at the comfortable rate", () => {
    const inp = athlete({ weighIns: series(28, 100, 0), goal: { type: "lose", kg: 90, kgMax: null, date: addDays(TODAY, 84) } });
    const r = roadmap(inp, { healthTexts: ["type 2 diabetes, on metformin"] });
    expect(r.fresh.safety.conservative).toBe(true);
    for (const b of r.fresh.blocks.filter((x) => x.kind === "fat_loss")) expect(Math.abs(b.rate.pctPerWeek)).toBeLessThanOrEqual(0.76);
  });
});

describe("12. after a competition, and sustained maintenance", () => {
  it("a meet last week with nothing new set: recovery, then a transition", () => {
    const inp = athlete({ powerlifter: true });
    const r = roadmap(inp, { recentEvent: { name: "Nationals", date: addDays(TODAY, -5), physique: false } });
    expect(r.fresh.blocks.map((b) => b.kind)).toEqual(["post_comp", "transition"]);
    expect(r.fresh.blocks[0].end).toBe(addDays(TODAY, 9));
    expect(r.fresh.blocks.every((b) => b.energy.vsMaintenance >= -100)).toBe(true);
  });
  it("holding a weight with steady data: on track, hold, a check-in every two weeks", () => {
    const inp = athlete({ goal: { type: "maintain", kg: 90, kgMax: null, date: null } });
    const active = roadmap(inp).fresh;
    const engine = active.blocks[0].energy.engine;
    const r = roadmap(inp, { active, current: engine, targetsChangedOn: addDays(TODAY, -60), lastCheckin: addDays(TODAY, -2) });
    expect(active.blocks.every((b) => b.kind === "maintenance")).toBe(true);
    expect(r.read.progress.status).toBe("on_track");
    expect(r.read.decision.action).toBe("hold");
    expect(r.read.checkin.cadenceDays).toBe(14);
  });
});

describe("the check-in form and the text for the AI", () => {
  it("is a few taps when nothing's wrong, with follow-ups only when asked", () => {
    const quick = roadmapCheckinQuestions([], "M");
    expect(quick.filter((q) => !q.optional && !q.showWhen)).toHaveLength(3);
    const answers = { nutrition_rating: 5, recovery_flags: ["All good"], training_rating: 4 };
    expect(missingAnswers(quick, answers)).toEqual([]);
    const asked = roadmapCheckinQuestions(["tracking", "cycle", "confounders"], "F");
    expect(asked.map((q) => q.key)).toEqual(expect.arrayContaining(["tracking_accuracy", "cycle_changes", "scale_confounders"]));
    expect(asked.find((q) => q.key === "scale_confounders")!.options).toContain("Period or cycle");
    expect(roadmapCheckinQuestions(["confounders"], "M").find((q) => q.key === "scale_confounders")!.options).not.toContain("Period or cycle");
  });
  it("hands the AI every number and the rules, never a reason to recompute", () => {
    const inp = athlete({ powerlifter: true, weighIns: series(28, 68.4, -0.1), meet: { name: "Nationals", date: addDays(TODAY, 84), weightClass: "66", federation: "CPU", sport: "powerlifting" } });
    const r = roadmap(inp);
    const text = roadmapText(r.read, { approved: true });
    expect(text).toMatch(/NUTRITION ROADMAP \(approved/);
    expect(text).toMatch(/Current block:/);
    expect(text).toMatch(/never plans dehydration/);
  });
});

describe("the words around the numbers", () => {
  it("a model's two lines are thrown away when they add a number or something the app never plans", async () => {
    const { readExplanation, numbersIn } = await import("@/lib/nutrition-roadmap/explain.server");
    const facts = "Current block: Controlled fat loss. The block calls for: 2300 kcal · 145 g protein. Target 65.7 kg by Feb 14.";
    expect(numbersIn("2,300 kcal and 65.7 kg")).toEqual(["2300", "65.7"]);
    expect(readExplanation('{"summary":"You are cutting toward 65.7 kg at 2300 kcal a day.","focus":"Hit 145 g protein every day."}', facts)).not.toBeNull();
    expect(readExplanation('{"summary":"You are cutting toward 64 kg.","focus":"Hit protein."}', facts)).toBeNull();
    expect(readExplanation('{"summary":"Cut water the day before.","focus":"Use the sauna on meet week."}', facts)).toBeNull();
    expect(readExplanation("not json", facts)).toBeNull();
    expect(readExplanation('{"summary":"Great work!","focus":"Keep going."}', facts)).toBeNull();
  });
  it("an athlete reads their roadmap addressed to them", async () => {
    const { toYou } = await import("@/lib/nutrition-roadmap/view");
    expect(toYou("Their current trajectory projects 70 kg. Reaching it needs a faster loss than their recent progress supports, without eating under their resting energy.")).toBe(
      "Your current trajectory projects 70 kg. Reaching it needs a faster loss than your recent progress supports, without eating under your resting energy.",
    );
    expect(toYou("the lowest this plan goes for them")).toBe("the lowest this plan goes for you");
  });
});

describe("live data, Nov 22 2026: the first run on every coaching client", () => {
  // Colten, Marc and Nicole: on plans in the same phase, on track, and drafted a 150–275 kcal move to the formula's estimate
  const start = addDays(TODAY, -42);
  const onPlan = (phase: string, kcal: number, kgPerWeek: number, goal: AssessmentInput["goal"] = null) => {
    const inp = athlete({ weighIns: series(42, 88, kgPerWeek), goal, plan: { start, weeklyKcal: kcal, phase, starts: [start] } });
    return roadmap(inp, {
      planNow: { start, phase, days: [{ label: "Training Day", kcal, protein: 180, carbs: 250, fat: 70 }], weeklyKcal: kcal },
      current: { kcal, proteinG: 180, carbsG: 250, fatG: 70 },
      targetsChangedOn: start,
    });
  };

  it("the plan they're on for this block is never moved to an estimate while it's working", () => {
    for (const [phase, kcal, rate] of [["Fat Loss", 2400, -0.5], ["Fat Loss", 1900, -0.5], ["Recomposition", 2000, -0.1], ["Muscle Gain", 3300, 0.2]] as const) {
      const r = onPlan(phase, kcal, rate);
      expect(r.read.currentBlock!.energy.from).toBe("plan");
      expect(r.read.decision.kcalChange, `${phase} at ${kcal}`).toBeNull();
    }
  });

  it("and the same with a target weight", () => {
    const r = onPlan("Fat Loss", 2300, -0.5, { type: "lose", kg: 82, kgMax: null, date: null });
    expect(r.read.decision.kcalChange).toBeNull();
  });

  it("a coached plan with no numbers and no recent weigh-ins holds (Nicolas: one day, no calories)", () => {
    const inp = athlete({ weighIns: series(10, 75, 0, 0.2, addDays(TODAY, -35)), plan: { start: "2026-06-07", weeklyKcal: null, phase: "Muscle Gain", starts: ["2026-06-07"] } });
    const r = roadmap(inp, { planNow: { start: "2026-06-07", phase: "Muscle Gain", days: [{ label: "Daily", kcal: null, protein: null, carbs: null, fat: null }], weeklyKcal: null } });
    expect(r.read.progress.status).toBe("insufficient_data");
    expect(r.read.decision.action).toBe("hold");
    expect(r.read.decision.kcalChange).toBeNull();
  });

  // Jared: Nationals Feb 8, class not decided (66 or 74); his journey ignored the meet
  it("a meet with no class still gets a fueled peak, meet week, recovery and a transition on its date", () => {
    const meetDate = addDays(TODAY, 78);
    const inp = athlete({ weighIns: series(28, 76, -0.4), powerlifter: true, meet: { name: "Nationals", date: meetDate, weightClass: null, federation: "CPU", sport: "powerlifting" }, plan: { start, weeklyKcal: 2500, phase: "Fat Loss", starts: [start] } });
    const r = roadmap(inp, { planNow: { start, phase: "Fat Loss", days: [{ label: "Training Day", kcal: 2500, protein: 170, carbs: 280, fat: 70 }], weeklyKcal: 2500 }, current: { kcal: 2500, proteinG: 170, carbsG: 280, fatG: 70 }, targetsChangedOn: start });
    const kinds = r.fresh.blocks.map((b) => b.kind);
    expect(kinds.slice(-4)).toEqual(["performance", "taper", "post_comp", "transition"]);
    expect(kinds[0]).toBe("fat_loss");
    const taper = r.fresh.blocks.find((b) => b.kind === "taper")!;
    expect(taper.end).toBe(meetDate);
    const peak = r.fresh.blocks.find((b) => b.kind === "performance")!;
    expect(daysBetween(peak.start, taper.start)).toBe(21);
    expect(peak.priorities.join(" ")).toContain("confirm the weight class");
    expect(r.fresh.missing.join(" ")).toContain("weight class for Nationals");
    expect(r.read.decision.kcalChange).toBeNull();
  });

  it("a meet two weeks out with no class is fueled from today", () => {
    const meetDate = addDays(TODAY, 13);
    const inp = athlete({ weighIns: series(28, 74, 0), powerlifter: true, meet: { name: "Total Fortification", date: meetDate, weightClass: null, federation: null, sport: "powerlifting" }, plan: { start, weeklyKcal: 1800, phase: "Maintenance", starts: [start] } });
    const r = roadmap(inp);
    expect(r.fresh.blocks.map((b) => b.kind)).toEqual(["performance", "taper", "post_comp", "transition"]);
    expect(r.fresh.blocks[0].start).toBe(TODAY);
  });

  // Alyssa: a 76 kg class (her competition profile) on Dec 5, last weigh-in 74.2 kg on Sep 27
  it("a stale weigh-in under the class is never 'reached': it needs weigh-ins, and says the meet is close", () => {
    const meetDate = addDays(TODAY, 13);
    const inp = athlete({ sex: "F", heightCm: 165, weighIns: series(10, 74.2, 0, 0.2, addDays(TODAY, -56)), powerlifter: true, meet: { name: "Total Fortification", date: meetDate, weightClass: "76", federation: null, sport: "powerlifting" } });
    const r = roadmap(inp);
    expect(r.fresh.goal?.kind).toBe("weight_class");
    expect(r.fresh.feasibility.verdict).toBe("needs_weigh_ins");
    expect(r.fresh.feasibility.headline).toMatch(/^Total Fortification in 2 weeks: no weigh-ins since/);
    expect(r.read.decision.kcalChange).toBeNull();
    expect(r.fresh.blocks.map((b) => b.kind).slice(-3)).toEqual(["taper", "post_comp", "transition"]);
  });
});

