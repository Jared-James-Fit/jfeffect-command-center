import { describe, expect, it } from "vitest";
import { buildTrajectory, recentTrend, cleanWeighIns, type WeighIn } from "@/lib/weight-management/trajectory";
import { assessTarget, classLimitKg, cutHistory, plannedClassWeight, weighInTiming } from "@/lib/weight-management/target";
import {
  isTreadmill,
  pickRestDays,
  plannedModality,
  prescribeTreadmill,
  sessionNetKcal,
  sessionsFromExisting,
  stepTreadmill,
  walkingLimits,
  walkingNetKcalPerMin,
  zone2,
  type StepContext,
  type TreadmillSession,
} from "@/lib/weight-management/treadmill";
import { hasFluidRestriction, hydrationTarget, DAY_CAP_ML } from "@/lib/weight-management/hydration";
import { readDigestion } from "@/lib/weight-management/digestion";
import { decide, type DecisionInput } from "@/lib/weight-management/decision";
import { assessmentText, buildAssessment, readCheckins, resolveGoal, waistChange, type AssessmentInput } from "@/lib/weight-management/assessment";
import { addDays, fmtSpeed, fmtWeight, kmhToMph, treadmillSpeedMph } from "@/lib/weight-management/units";

const TODAY = "2026-11-17";

/** A weigh-in every day for `days` days ending today: a straight trend plus a repeatable wobble (± amp kg). */
function series(days: number, endKg: number, kgPerWeek: number, amp = 0, end = TODAY): WeighIn[] {
  const out: WeighIn[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(end, -i);
    const wobble = amp ? amp * Math.sin(i * 2.3) : 0;
    out.push({ date, kg: endKg - (kgPerWeek * i) / 7 + wobble });
  }
  return out;
}

describe("trajectory", () => {
  it("reads a clean loss as a clear trend at the right rate, level from the line", () => {
    const t = recentTrend(series(28, 85, -0.5, 0.2))!;
    expect(t.clear).toBe(true);
    expect(t.kgPerWeek).toBeCloseTo(-0.5, 1);
    expect(t.levelKg).toBeCloseTo(85, 0);
    expect(t.weighIns).toBe(28);
  });

  it("never reads a noisy flat month as a trend", () => {
    const t = recentTrend(series(28, 85, 0, 0.8))!;
    expect(t.clear).toBe(false);
    expect(t.noiseKg).toBeGreaterThan(0.4);
  });

  it("needs 4 weigh-ins over 10 days before calling anything", () => {
    expect(recentTrend(series(3, 85, -1))).toBeNull();
    const tr = buildTrajectory({ weighIns: [{ date: TODAY, kg: 85 }], today: TODAY, goal: { kg: 83, date: "2027-02-01", kind: "at_most" } });
    expect(tr.status).toBe("not_enough_data");
    expect(tr.current?.from).toBe("latest");
  });

  it("drops impossible and duplicate weigh-ins, the last of a day wins", () => {
    const pts = cleanWeighIns([
      { date: "2026-11-01", kg: 84 },
      { date: "2026-11-01", kg: 84.4 },
      { date: "2026-11-02", kg: 840 },
      { date: "bad", kg: 80 },
    ]);
    expect(pts).toEqual([{ date: "2026-11-01", kg: 84.4 }]);
  });

  it("projects to the date with a band that widens the further out it is", () => {
    const pts = series(28, 86, -0.5, 0.3);
    const near = buildTrajectory({ weighIns: pts, today: TODAY, goal: { kg: 83, date: addDays(TODAY, 28), kind: "at_most" } });
    const far = buildTrajectory({ weighIns: pts, today: TODAY, goal: { kg: 83, date: addDays(TODAY, 84), kind: "at_most" } });
    const width = (t: typeof near) => t.projected!.highKg - t.projected!.lowKg;
    expect(width(far)).toBeGreaterThan(width(near));
    expect(near.projected!.kg).toBeCloseTo(84, 0);
    expect(near.required!.kgPerWeek).toBeLessThan(0);
  });

  it("on track, ahead, behind, stalled and the wrong way", () => {
    const lose = series(28, 86, -0.5, 0.15);
    expect(buildTrajectory({ weighIns: lose, today: TODAY, goal: { kg: 83, date: addDays(TODAY, 42), kind: "at_most" } }).status).toBe("on_track");
    expect(buildTrajectory({ weighIns: lose, today: TODAY, goal: { kg: 84, date: addDays(TODAY, 56), kind: "at_most" } }).status).toBe("ahead");
    expect(buildTrajectory({ weighIns: lose, today: TODAY, goal: { kg: 80, date: addDays(TODAY, 28), kind: "at_most" } }).status).toBe("behind");
    expect(buildTrajectory({ weighIns: series(28, 86, 0, 0.6), today: TODAY, goal: { kg: 83, date: addDays(TODAY, 42), kind: "at_most" } }).status).toBe("stalled");
    expect(buildTrajectory({ weighIns: series(28, 86, 0.5, 0.1), today: TODAY, goal: { kg: 83, date: addDays(TODAY, 42), kind: "at_most" } }).status).toBe("wrong_way");
    expect(buildTrajectory({ weighIns: series(28, 82, 0, 0.1), today: TODAY, goal: { kg: 83, date: addDays(TODAY, 42), kind: "at_most" } }).status).toBe("reached");
  });

  it("flags a weigh-in well off the line as water or gut content", () => {
    const pts = series(27, 85, -0.3, 0.15, addDays(TODAY, -1));
    pts.push({ date: TODAY, kg: 86.8 });
    const t = buildTrajectory({ weighIns: pts, today: TODAY });
    expect(t.fluctuation?.direction).toBe("above");
    expect(t.current!.kg).toBeLessThan(86);
  });

  it("the 7-day average against the week before", () => {
    const t = buildTrajectory({ weighIns: series(21, 85, -0.7), today: TODAY });
    expect(t.weeklyChangeKg).toBeCloseTo(-0.7, 1);
    expect(t.status).toBe("no_target");
  });

  it("a planned path from now to the date, weekly", () => {
    const t = buildTrajectory({ weighIns: series(28, 86, -0.5), today: TODAY, goal: { kg: 83, date: addDays(TODAY, 42), kind: "at_most" } });
    expect(t.path[0].kg).toBeCloseTo(86, 0);
    expect(t.path[t.path.length - 1]).toMatchObject({ date: addDays(TODAY, 42), kg: 83 });
    expect(t.path.length).toBe(7);
  });
});

describe("competition weight targets", () => {
  it("reads class labels in kg and lb, never an open class", () => {
    expect(classLimitKg("83")).toBe(83);
    expect(classLimitKg("-83kg")).toBe(83);
    expect(classLimitKg("120+")).toBeNull();
    expect(classLimitKg("181 lb")).toBeCloseTo(82.1, 1);
  });

  it("plans to the limit less a small buffer, never a dehydration cut", () => {
    expect(plannedClassWeight(83)).toEqual({ kg: 82.59, bufferKg: 0.42 });
    expect(plannedClassWeight(83, 0.6).kg).toBe(82.4);
    expect(plannedClassWeight(83, 3).bufferKg).toBe(0.83); // capped at 1%
  });

  it("weigh-in timing by federation", () => {
    expect(weighInTiming("CPU")).toMatchObject({ hours: 2, known: true });
    expect(weighInTiming("IPF Worlds")).toMatchObject({ hours: 2 });
    expect(weighInTiming("USPA")).toMatchObject({ hours: 24, known: true });
    expect(weighInTiming("Local Strongman")).toMatchObject({ hours: null, known: false });
    expect(weighInTiming(null).known).toBe(false);
  });

  it("calls a too-fast class cut and points at the next class up", () => {
    const a = assessTarget({ context: "powerlifting_class", currentKg: 89, targetKg: 82.6, weeks: 6, sex: "M", level: "intermediate", unit: "kg", classLimitKg: 83 });
    expect(a.verdict).toBe("too_fast");
    expect(a.alternative).toMatchObject({ label: "93 kg", requiredPctPerWeek: 0 });
    expect(a.message).toMatch(/93 kg class takes no cut/);
  });

  it("comfortable and aggressive by sport", () => {
    expect(assessTarget({ context: "powerlifting_class", currentKg: 86, targetKg: 82.6, weeks: 12, sex: "M", level: "advanced", unit: "kg", classLimitKg: 83 }).verdict).toBe("comfortable");
    expect(assessTarget({ context: "powerlifting_class", currentKg: 86, targetKg: 82.6, weeks: 6, sex: "M", level: "advanced", unit: "kg", classLimitKg: 83 }).verdict).toBe("aggressive");
    expect(assessTarget({ context: "bodybuilding", currentKg: 90, targetKg: 80, weeks: 16, sex: "M", level: "advanced", unit: "kg" }).verdict).toBe("comfortable");
    expect(assessTarget({ context: "fat_loss", currentKg: 80, targetKg: 85, weeks: 8, sex: "F", level: null, unit: "kg" }).verdict).toBe("reached");
  });

  it("gains slower the more trained they are", () => {
    const beginner = assessTarget({ context: "gain", currentKg: 70, targetKg: 73, weeks: 16, sex: "M", level: "beginner", unit: "kg" });
    const advanced = assessTarget({ context: "gain", currentKg: 70, targetKg: 73, weeks: 16, sex: "M", level: "advanced", unit: "kg" });
    expect(beginner.verdict).toBe("comfortable");
    expect(advanced.verdict).toBe("too_fast");
  });

  it("learns from their own earlier cuts", () => {
    const h = cutHistory([
      { phase: "cutting", from: "2025-01-01", to: "2025-03-01", pctPerWeek: -0.8, strengthChangePct: -5 },
      { phase: "cutting", from: "2025-06-01", to: "2025-08-01", pctPerWeek: -0.4, strengthChangePct: 1 },
    ]);
    expect(h).toMatchObject({ safePct: 0.4, costlyPct: 0.8 });
    const a = assessTarget({ context: "powerlifting_class", currentKg: 86, targetKg: 82.6, weeks: 7, sex: "M", level: "advanced", unit: "kg", classLimitKg: 83, past: [{ phase: "cutting", from: "2025-01-01", to: "2025-03-01", pctPerWeek: -0.8, strengthChangePct: -5 }] });
    expect(a.rates.limit).toBe(0.8);
    expect(a.history).toMatch(/lost strength/);
  });
});

describe("treadmill cardio", () => {
  const base = { goal: "fat_loss" as const, bodyweightKg: 85, unit: "mph" as const, trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"] };

  it("is the default modality, and a coach's own bike plan is kept", () => {
    expect(plannedModality([]).modality).toBe("treadmill");
    expect(plannedModality([{ day_type: "Training Day", cardio_type: "Incline Treadmill Walk", duration_minutes: 15 }]).modality).toBe("treadmill");
    expect(plannedModality([{ day_type: "Non-Training Day", cardio_type: "Bike", duration_minutes: 30 }])).toEqual({ modality: "other", keep: "Bike" });
    // a walk read off the program isn't the coach's choice of modality
    expect(plannedModality([{ day_type: "Training Day", cardio_type: "Stairmaster", duration_minutes: 10, source: "program_rows" }]).modality).toBe("treadmill");
    expect(isTreadmill("Outdoor Walking")).toBe(false);
    expect(isTreadmill("Incline Walking")).toBe(true);
    expect(isTreadmill("Rowing")).toBe(false);
  });

  it("speed in mph and km/h, always labelled, set to a treadmill's 0.1 steps", () => {
    expect(fmtSpeed(3, "mph")).toBe("3.0 mph");
    expect(fmtSpeed(3, "kmh")).toBe("4.8 km/h");
    const mph = treadmillSpeedMph(3, "kmh");
    expect(fmtSpeed(mph, "kmh")).toBe("4.8 km/h");
    expect(mph).toBeCloseTo(kmhToMph(4.8), 5);
  });

  it("the ACSM walking equation: a heavier person burns more at the same setting", () => {
    expect(walkingNetKcalPerMin(3, 5, 90)).toBeCloseTo(6.9, 1);
    expect(walkingNetKcalPerMin(3, 5, 120)).toBeGreaterThan(walkingNetKcalPerMin(3, 5, 80));
    expect(sessionNetKcal({ minutes: 30, speedMph: 3, inclinePct: 5 }, 90)).toBe(210);
    expect(sessionNetKcal({ minutes: 30, speedMph: 3, inclinePct: 5 }, null)).toBeNull();
  });

  it("is individual: not one setting for everyone", () => {
    const tall = prescribeTreadmill({ ...base, heightCm: 190 });
    const heavy = prescribeTreadmill({ ...base, bodyweightKg: 130 });
    const knee = prescribeTreadmill({ ...base, jointLimits: ["Left knee"] });
    const used = prescribeTreadmill({ ...base, history: { speedMph: 3.4, inclinePct: 7, avgRpe: 4, sessions: 6 } });
    expect(tall.restDay!.speedMph).toBeGreaterThan(heavy.restDay!.speedMph);
    expect(heavy.restDay!.inclinePct).toBeLessThanOrEqual(3);
    expect(knee.restDay!.inclinePct).toBeLessThanOrEqual(3);
    expect(knee.restDay!.speedMph).toBeLessThanOrEqual(3);
    expect(used.restDay).toMatchObject({ speedMph: 3.4, inclinePct: 7 });
    expect(tall.title).toBe("Treadmill — Incline Walking");
  });

  it("the smallest dose for the goal, most of it on days off", () => {
    const fat = prescribeTreadmill(base);
    expect(fat.trainingDay).toMatchObject({ minutes: 15, perWeek: 4 });
    expect(fat.restDay!.minutes).toBeGreaterThanOrEqual(20);
    expect(fat.weeklyMinutes).toBeGreaterThanOrEqual(85);
    const gain = prescribeTreadmill({ ...base, goal: "gain" });
    expect(gain.trainingDay).toBeNull();
    expect(gain.weeklyMinutes).toBeLessThanOrEqual(45);
    const active = prescribeTreadmill({ ...base, dailySteps: 12000 });
    expect(active.weeklyMinutes).toBeLessThan(fat.weeklyMinutes);
    expect(zone2(30)).toEqual({ low: 112, high: 131 });
  });

  it("powerlifters: walk after lifting, short and flat, never the day before a heavy lower day", () => {
    const p = prescribeTreadmill({ ...base, powerlifter: true, heavyLowerDays: ["Monday", "Thursday"], history: { speedMph: 3.2, inclinePct: 7, avgRpe: 4, sessions: 5 } });
    expect(p.trainingDay!.minutes).toBeLessThanOrEqual(15);
    expect(p.trainingDay!.inclinePct).toBeLessThanOrEqual(4);
    expect(p.restDay!.weekdays).not.toContain("Sunday");
    expect(p.restDay!.weekdays).not.toContain("Wednesday");
    expect(p.placement.join(" ")).toMatch(/never before/);
    expect(pickRestDays(["Monday", "Tuesday", "Thursday", "Friday"], 1, ["Monday", "Thursday"])).toEqual(["Saturday"]);
  });

  it("tapers into a meet: easy, flat, little", () => {
    const p = prescribeTreadmill({ ...base, powerlifter: true, meetWeeksOut: 1 });
    expect(p.trainingDay).toBeNull();
    expect(p.weeklyMinutes).toBeLessThanOrEqual(40);
    expect(p.restDay!.inclinePct).toBeLessThanOrEqual(3);
  });

  it("which injuries walking would aggravate", () => {
    expect(walkingLimits(["Right knee (patellar tendon)", "Shoulder impingement", "Low back"])).toEqual(["Right knee (patellar tendon)", "Low back"]);
  });

  const ctx: StepContext = { bodyweightKg: 85, trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"], unit: "mph" };
  type Plan = { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null };
  const s = (o: Partial<TreadmillSession>): TreadmillSession => ({ minutes: 20, speedMph: 3, inclinePct: 5, perWeek: 2, weekdays: ["Wednesday", "Saturday"], ...o });

  it("progresses one variable at a time, in order", () => {
    let plan: Plan = { trainingDay: s({ minutes: 10, perWeek: 4, weekdays: ctx.trainingDays }), restDay: s({ minutes: 40 }) };
    const steps: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = stepTreadmill(plan, "up", ctx);
      steps.push(`${r.step.session}:${r.step.variable}`);
      const changed = (["minutes", "speedMph", "inclinePct", "perWeek"] as const).filter(
        (k) => r.plan.restDay?.[k] !== plan.restDay?.[k] || r.plan.trainingDay?.[k] !== plan.trainingDay?.[k],
      );
      expect(changed.length).toBeLessThanOrEqual(r.step.variable === "frequency" ? 1 : 1);
      plan = r.plan;
      if (r.step.variable === "none") break;
    }
    expect(steps[0]).toBe("restDay:minutes");
    expect(steps).toContain("restDay:frequency");
    expect(steps.indexOf("trainingDay:minutes")).toBeGreaterThan(steps.indexOf("restDay:frequency"));
    expect(steps.indexOf("restDay:incline")).toBeGreaterThan(steps.indexOf("trainingDay:minutes"));
    expect(steps.indexOf("restDay:speed")).toBeGreaterThan(steps.lastIndexOf("restDay:incline"));
    expect(steps[steps.length - 1]).toBe("null:none");
  });

  it("each step up adds energy, each step down takes it away", () => {
    const plan = { trainingDay: null, restDay: s({}) };
    expect(stepTreadmill(plan, "up", ctx).step.weeklyNetKcal).toBeGreaterThan(0);
    expect(stepTreadmill({ trainingDay: null, restDay: s({ inclinePct: 8 }) }, "down", ctx).step.weeklyNetKcal).toBeLessThan(0);
  });

  it("comes down incline first when it's costing training", () => {
    const r = stepTreadmill({ trainingDay: s({ minutes: 15, inclinePct: 3, perWeek: 4 }), restDay: s({ inclinePct: 8 }) }, "down", ctx);
    expect(r.step).toMatchObject({ variable: "incline", session: "restDay", from: 8, to: 6 });
    const next = stepTreadmill({ trainingDay: s({ minutes: 15, inclinePct: 3, perWeek: 4 }), restDay: s({ inclinePct: 3 }) }, "down", ctx);
    expect(next.step).toMatchObject({ variable: "minutes", session: "trainingDay", from: 15, to: 10 });
  });

  it("adds no incline or speed close to a meet", () => {
    const near = { ...ctx, powerlifter: true, meetWeeksOut: 5 };
    let plan: Plan = { trainingDay: s({ minutes: 15, perWeek: 4, weekdays: ctx.trainingDays }), restDay: s({ minutes: 45, perWeek: 3, weekdays: ["Wednesday", "Saturday", "Sunday"] }) };
    for (let i = 0; i < 6; i++) {
      const r = stepTreadmill(plan, "up", near);
      expect(["incline", "speed"]).not.toContain(r.step.variable);
      plan = r.plan;
    }
  });

  it("never touches incline or speed on a coach's non-treadmill plan", () => {
    const bike = { ...ctx, treadmill: false };
    let plan: Plan = { trainingDay: null, restDay: s({ minutes: 45, perWeek: 3, weekdays: ["Wednesday", "Saturday", "Sunday"] }) };
    for (let i = 0; i < 5; i++) {
      const up = stepTreadmill(plan, "up", bike);
      expect(["incline", "speed"]).not.toContain(up.step.variable);
      plan = up.plan;
    }
    const down = stepTreadmill({ trainingDay: null, restDay: s({ inclinePct: 9 }) }, "down", bike);
    expect(down.step.variable).not.toBe("incline");
  });

  it("reads their existing plan as sessions", () => {
    const p = sessionsFromExisting([
      { day_type: "Training Day", cardio_type: "Incline Treadmill Walk", duration_minutes: 15, incline: 5, speed_min_mph: 2, speed_max_mph: 3, frequency_per_week: 4, scheduled_weekdays: ["Monday"] },
      { day_type: "Non-Training Day", cardio_type: "Incline Treadmill Walk", duration_minutes: 30, incline: "6", speed_min_mph: 3.2, scheduled_weekdays: ["Saturday", "Sunday"] },
    ]);
    expect(p.trainingDay).toMatchObject({ minutes: 15, speedMph: 2.5, inclinePct: 5, perWeek: 4 });
    expect(p.restDay).toMatchObject({ minutes: 30, speedMph: 3.2, inclinePct: 6, perWeek: 2 });
  });
});

describe("hydration", () => {
  it("bodyweight and training, rest days and training days", () => {
    const h = hydrationTarget({ bodyweightKg: 80, trainingMinutes: 75 });
    expect(h.restMl).toBe(2400);
    expect(h.trainingMl).toBe(3000);
    expect(h.trainingExtraMl).toBe(600);
    expect(h.electrolytes).toBeNull();
    expect(h.totalFluidNote).toMatch(/Plain water/);
    // lifting sweats little: sodium only past two hours, or past one for a heavy sweater or a hot gym
    expect(hydrationTarget({ bodyweightKg: 50, trainingMinutes: 75, trainingDayCardioMinutes: 25 }).electrolytes).toBeNull();
    expect(hydrationTarget({ bodyweightKg: 80, trainingMinutes: 100, trainingDayCardioMinutes: 25 }).electrolytes).toMatch(/sodium/);
    expect(hydrationTarget({ bodyweightKg: 80, trainingMinutes: 60, sweat: "heavy" }).electrolytes).toMatch(/sodium/);
  });

  it("tapers past 100 kg, adds for heat and heavy sweat, sodium for long sessions", () => {
    const big = hydrationTarget({ bodyweightKg: 140, trainingMinutes: 90, sweat: "heavy", climate: "hot" });
    expect(big.restMl).toBeLessThanOrEqual(4000);
    expect(big.trainingMl).toBeLessThanOrEqual(DAY_CAP_ML);
    expect(big.electrolytes).toMatch(/300–600 mg/);
    expect(hydrationTarget({ bodyweightKg: 140, trainingMinutes: 60 }).restMl).toBe(3600);
  });

  it("never sets a number over a medical fluid limit", () => {
    const h = hydrationTarget({ bodyweightKg: 90, trainingMinutes: 60, fluidRestriction: true });
    expect(h).toMatchObject({ restricted: true, restMl: null, trainingMl: null });
    expect(hasFluidRestriction(["Stage 3 CKD", null])).toBe(true);
    expect(hasFluidRestriction(["takes furosemide"])).toBe(true);
    expect(hasFluidRestriction(["Knee tendinitis"])).toBe(false);
  });

  it("builds up when they drink far less", () => {
    const h = hydrationTarget({ bodyweightKg: 90, trainingMinutes: 60, recentAvgMl: 1200 });
    expect(h.ramp).toMatchObject({ fromMl: 1200, stepMlPerWeek: 500 });
    expect(h.ramp!.weeks).toBe(3);
  });

  it("a light lifter still gets a sensible floor", () => {
    expect(hydrationTarget({ bodyweightKg: 50, trainingMinutes: 45 }).restMl).toBe(2000);
    expect(hydrationTarget({ bodyweightKg: null, trainingMinutes: 45 }).restMl).toBe(3000);
  });
});

describe("digestion", () => {
  const ci = (date: string, a: Record<string, unknown>) => ({ date, answers: a });

  it("names a pattern, its timing and practical changes, never a food group cut", () => {
    const d = readDigestion([
      ci("2026-11-15", { recovery_flags: ["Digestion / bloating"], digestion_symptoms: ["Bloating"], digestion_timing: "After meals", digestion_severity: 3 }),
      ci("2026-11-08", { recovery_flags: ["Digestion / bloating", "Sleep"], digestion_symptoms: ["Bloating", "Constipation"], digestion_timing: "After meals", digestion_severity: 4 }),
      ci("2026-11-01", { recovery_flags: ["All good"] }),
      ci("2026-10-25", { recovery_flags: ["Digestion / bloating"], digestion_symptoms: ["Bloating"], digestion_timing: "Training days" }),
    ]);
    expect(d.flagged).toBe(3);
    expect(d.streak).toBe(2);
    expect(d.timing).toBe("After meals");
    expect(d.symptoms[0]).toEqual({ symptom: "Bloating", weeks: 3 });
    expect(d.severityTrend).toBe("better");
    expect(d.scaleEffect).toBe(true);
    expect(d.summary).toMatch(/^Bloating and constipation flagged 3 of the last 4 check-ins, mostly after meals/);
    expect(d.suggestions.join(" ")).toMatch(/Spread vegetables/);
    expect(d.suggestions.join(" ")).not.toMatch(/cut (out )?(dairy|gluten|carbs)/i);
    expect(d.medical).toBeNull();
  });

  it("notices it started with a new plan", () => {
    const d = readDigestion([ci("2026-11-15", { recovery_flags: ["Digestion / bloating"], digestion_symptoms: ["Gas"] })], ["2026-11-05"]);
    expect(d.afterPlanChange).toBe("2026-11-05");
    expect(d.suggestions[0]).toMatch(/started within 2 weeks of the plan/);
  });

  it("sends persistent or severe symptoms to a doctor", () => {
    const sev = readDigestion([
      ci("2026-11-15", { recovery_flags: ["Digestion / bloating"], digestion_severity: 5 }),
      ci("2026-11-08", { recovery_flags: ["Digestion / bloating"], digestion_severity: 4 }),
    ]);
    expect(sev.medical).toMatch(/doctor/);
    const streak = readDigestion(["2026-11-15", "2026-11-08", "2026-11-01", "2026-10-25"].map((d) => ci(d, { recovery_flags: ["Digestion / bloating"], digestion_severity: 2 })));
    expect(streak.medical).toMatch(/4 weeks in a row/);
  });

  it("says nothing when nothing's flagged", () => {
    const d = readDigestion([ci("2026-11-15", { recovery_flags: ["All good"] })]);
    expect(d.summary).toBeNull();
    expect(d.scaleEffect).toBe(false);
  });
});

// --------------------------------------------------------------------------
// The decisions the coach asked for

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

describe("decisions", () => {
  it("weight stable, waist down, strength holding: hold the plan", () => {
    const r = decide(input({ weighIns: series(35, 86, 0, 0.5), waist: { changeCm: -2, weeks: 4 } }));
    expect(r.verdict).toBe("maintain");
    expect(r.headline).toMatch(/waist down/);
    expect(r.material).toBe(false);
  });

  it("losing too fast with the lifts dropping: more food", () => {
    const r = decide(input({ weighIns: series(35, 84, -1.1, 0.2), performance: { lower: "down", detail: "Squat down 4%" } }));
    expect(r.verdict).toBe("adjust");
    const n = r.actions.find((a) => a.kind === "nutrition");
    expect(n && n.kind === "nutrition" && n.kcalPerDay).toBeGreaterThan(0);
    expect(r.material).toBe(true);
  });

  it("losing too fast right after cardio went up, lifts dropping: ease the cardio", () => {
    const r = decide(input({ weighIns: series(35, 84, -1.1, 0.2), performance: { lower: "down", detail: "Squat down 4%" }, cardio: { plan: { trainingDay: null, restDay: { minutes: 40, speedMph: 3, inclinePct: 9, perWeek: 3, weekdays: ["Wednesday", "Saturday", "Sunday"] } }, treadmill: true, lastChanged: "2026-11-05", issues: [] } }));
    expect(r.verdict).toBe("reduce_load");
    const c = r.actions[0];
    expect(c.kind === "cardio" && c.step.variable).toBe("incline");
  });

  it("heavier with constipation and bloating: digestion before calories", () => {
    const pts = series(34, 86, 0, 0.3, addDays(TODAY, -1));
    pts.push({ date: TODAY, kg: 87.6 });
    const digestion = readDigestion([{ date: TODAY, answers: { recovery_flags: ["Digestion / bloating"], digestion_symptoms: ["Constipation", "Bloating"] } }]);
    const r = decide(input({ weighIns: pts, digestion }));
    expect(r.verdict).toBe("investigate");
    expect(r.actions[0].kind).toBe("digestion");
    expect(r.material).toBe(false);
  });

  it("slower than needed with good adherence: a modest change, food first", () => {
    const r = decide(input({ weighIns: series(35, 86, -0.15, 0.15), goal: { kg: 82, date: addDays(TODAY, 56), kind: "at_most" } }));
    expect(r.verdict).toBe("adjust");
    const n = r.actions.find((a) => a.kind === "nutrition");
    expect(n?.kind === "nutrition" && n.kcalPerDay).toBeLessThan(0);
    expect(n?.kind === "nutrition" && Math.abs(n.kcalPerDay)).toBeLessThanOrEqual(250);
  });

  it("near the calorie floor: activity takes the rest, one step", () => {
    const r = decide(input({ weighIns: series(35, 86, -0.1, 0.15), goal: { kg: 80, date: addDays(TODAY, 56), kind: "at_most" }, plan: { start: "2026-09-01", weeklyKcal: 1600 } }));
    const kinds = r.actions.map((a) => a.kind);
    expect(kinds).toContain("cardio");
    const n = r.actions.find((a) => a.kind === "nutrition");
    expect(n?.kind === "nutrition" ? Math.abs(n.kcalPerDay) : 0).toBeLessThanOrEqual(100);
  });

  it("the squat dropping after incline walking went up: cut back the cardio", () => {
    const r = decide(input({ weighIns: series(35, 86, -0.4, 0.15), performance: { lower: "down", detail: "Squat down 5% since Oct 20" }, cardio: { plan: { trainingDay: null, restDay: { minutes: 35, speedMph: 3, inclinePct: 10, perWeek: 3, weekdays: ["Wednesday", "Saturday", "Sunday"] } }, treadmill: true, lastChanged: "2026-11-01", issues: [] } }));
    expect(r.verdict).toBe("reduce_load");
    expect(r.headline).toMatch(/squat and deadlift/);
  });

  it("a meet close with a gap that can't be made safely: a heavier class, not a harder cut", () => {
    const target = assessTarget({ context: "powerlifting_class", currentKg: 89, targetKg: 82.6, weeks: 5, sex: "M", level: "intermediate", unit: "kg", classLimitKg: 83 });
    const r = decide(input({ weighIns: series(35, 89, -0.3, 0.2), goal: { kg: 82.6, date: addDays(TODAY, 35), kind: "at_most" }, context: "powerlifting_class", target, powerlifter: true, meetWeeksOut: 5 }));
    expect(r.verdict).toBe("reconsider_target");
    expect(r.headline).toMatch(/93 kg/);
    expect(r.actions.some((a) => a.kind === "nutrition" || a.kind === "cardio")).toBe(false);
  });

  it("a new plan settling: hold", () => {
    const r = decide(input({ weighIns: series(35, 86, 0, 0.4), plan: { start: addDays(TODAY, -6), weeklyKcal: 2400 } }));
    expect(r.verdict).toBe("maintain");
    expect(r.headline).toMatch(/settling/);
  });

  it("off plan most days: consistency before numbers", () => {
    const r = decide(input({ weighIns: series(35, 86, 0, 0.4), adherence: { avg: 3, checkins: 3 } }));
    expect(r.verdict).toBe("investigate");
    expect(r.headline).toMatch(/Consistency/);
  });

  it("too few weigh-ins: ask for more, change nothing", () => {
    const r = decide(input({ weighIns: [{ date: TODAY, kg: 86 }, { date: addDays(TODAY, -2), kg: 86.2 }] }));
    expect(r.verdict).toBe("need_data");
    expect(r.material).toBe(false);
  });

  it("on track: hold the plan, and never change things to look busy", () => {
    const r = decide(input({ weighIns: series(35, 86, -0.5, 0.15), goal: { kg: 83, date: addDays(TODAY, 42), kind: "at_most" } }));
    expect(r.verdict).toBe("maintain");
    expect(r.actions).toEqual([]);
  });

  it("under the class and still losing: food back for training", () => {
    const r = decide(input({ weighIns: series(35, 80, -0.5, 0.1), goal: { kg: 82.6, date: addDays(TODAY, 56), kind: "at_most" }, context: "powerlifting_class", powerlifter: true }));
    expect(r.verdict).toBe("adjust");
    expect(r.headline).toMatch(/Under the target/);
  });

  it("gaining faster than useful: a little less", () => {
    const r = decide(input({ weighIns: series(35, 75, 0.6, 0.1), goal: { kg: 80, date: null, kind: "at_least" }, direction: "gain", context: "gain", level: "advanced" }));
    expect(r.verdict).toBe("adjust");
    const n = r.actions[0];
    expect(n.kind === "nutrition" && n.kcalPerDay).toBeLessThan(0);
  });

  it("a powerlifter's cut comes from fats first, carbs around training kept", () => {
    const r = decide(input({ weighIns: series(35, 86, -0.15, 0.15), goal: { kg: 82, date: addDays(TODAY, 70), kind: "at_most" }, context: "powerlifting_class", powerlifter: true }));
    const n = r.actions.find((a) => a.kind === "nutrition");
    expect(n?.kind === "nutrition" && n.from).toBe("fats");
    expect(n?.kind === "nutrition" && n.instruction).toMatch(/fats first/);
  });

  it("a digestion red flag beats everything", () => {
    const digestion = readDigestion([
      { date: TODAY, answers: { recovery_flags: ["Digestion / bloating"], digestion_severity: 5 } },
      { date: addDays(TODAY, -7), answers: { recovery_flags: ["Digestion / bloating"], digestion_severity: 5 } },
    ]);
    const r = decide(input({ digestion, weighIns: series(35, 84, -1.2) }));
    expect(r.verdict).toBe("investigate");
    expect(r.actions[0].kind).toBe("medical");
  });
});

describe("real records (regressions)", () => {
  it("a slow, steady loss on a 3-week-old plan with no date is on track, never a cut", () => {
    // Nov 17 2026: a 111-lb lifter losing ~0.35 lb a week since August on a plan that started 21 days ago; only the
    // last 14 days were being read, which looked flat, and the engine asked for −175 kcal and more cardio.
    const LB = 2.2046226218;
    const pts: WeighIn[] = [];
    for (let i = 90; i >= 0; i--) pts.push({ date: addDays(TODAY, -i), kg: (111.3 + i * 0.05 + 0.4 * Math.sin(i * 1.7)) / LB });
    const a = buildAssessment({
      today: TODAY,
      unit: "lb",
      speedUnit: "mph",
      sex: "F",
      age: null,
      heightCm: 150,
      level: null,
      weighIns: pts,
      goal: { type: "lose", kg: 108 / LB, kgMax: null, date: null },
      meet: null,
      powerlifter: true,
      plan: { start: addDays(TODAY, -21), weeklyKcal: 1430, phase: "Fat Loss", starts: [addDays(TODAY, -21)] },
      checkins: [{ date: addDays(TODAY, -3), answers: { nutrition_rating: 5, recovery_flags: ["All good"] } }],
      cardio: { targets: [], lastChanged: null, history: null, done: null, planned: null },
      trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"],
      heavyLowerDays: [],
      sessionMinutes: 75,
      dailySteps: null,
      water: { avgMl: null, targetMl: null, daysLogged: 0 },
      waist: [],
      performance: { lower: null, detail: null },
      health: { walkingLimits: [], fluidRestriction: false },
      profile: { climate: null, sweat: null, maxIncline: null, availableMinutes: null },
      pastPhases: [],
    });
    expect(a.trajectory.trend!.spanDays).toBeGreaterThanOrEqual(21);
    expect(a.trajectory.status).toBe("on_track");
    expect(a.recommendation.verdict).toBe("maintain");
    expect(a.recommendation.material).toBe(false);
  });

  it("no date and a short flat patch: hold, and ask for more weigh-ins", () => {
    const r = decide(input({ weighIns: series(14, 86, 0, 0.4), goal: { kg: 80, date: null, kind: "at_most" } }));
    expect(r.verdict).toBe("maintain");
    expect(r.material).toBe(false);
  });

  it("no date and a real plateau: a small change toward the slow end", () => {
    const r = decide(input({ weighIns: series(35, 86, 0, 0.4), goal: { kg: 80, date: null, kind: "at_most" } }));
    expect(r.verdict).toBe("adjust");
    const n = r.actions.find((x) => x.kind === "nutrition");
    expect(n?.kind === "nutrition" ? Math.abs(n.kcalPerDay) : 0).toBeLessThanOrEqual(250);
  });
});

describe("the core answer", () => {
  it("names what's limiting, or nothing", () => {
    expect(decide(input({ weighIns: series(35, 86, -0.5, 0.15), goal: { kg: 83, date: addDays(TODAY, 42), kind: "at_most" } })).limiting).toBe("none");
    expect(decide(input({ weighIns: series(35, 86, 0, 0.4), adherence: { avg: 3, checkins: 3 } })).limiting).toBe("adherence");
    expect(decide(input({ weighIns: [{ date: TODAY, kg: 86 }] })).limiting).toBe("data");
    expect(decide(input({ weighIns: series(35, 86, -0.15, 0.15), goal: { kg: 82, date: addDays(TODAY, 56), kind: "at_most" } })).limiting).toBe("energy_balance");
  });

  it("under-recovered and stalling with the lifts down: recovery first, no bigger deficit", () => {
    const r = decide(input({ weighIns: series(35, 86, 0, 0.3), goal: { kg: 82, date: addDays(TODAY, 56), kind: "at_most" }, recovery: { poorSleep: 2, lowEnergy: 1, stress: 0, hungerHigh: false, of: 3 }, performance: { lower: "down", detail: "Squat down 3%" }, cardio: { plan: { trainingDay: null, restDay: null }, treadmill: true, lastChanged: "2026-08-01", issues: [] } }));
    expect(r).toMatchObject({ verdict: "investigate", limiting: "recovery", material: false });
  });

  it("under-recovered: a nutrition change, never cardio on top", () => {
    const r = decide(input({ weighIns: series(35, 86, -0.1, 0.15), goal: { kg: 80, date: addDays(TODAY, 56), kind: "at_most" }, plan: { start: "2026-09-01", weeklyKcal: 1600 }, recovery: { poorSleep: 0, lowEnergy: 2, stress: 0, hungerHigh: false, of: 3 } }));
    expect(r.actions.some((a) => a.kind === "cardio")).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/no cardio is added/);
  });

  it("constipated and drinking well under target: water before fibre", () => {
    const d = readDigestion([{ date: TODAY, answers: { recovery_flags: ["Digestion / bloating"], digestion_symptoms: ["Constipation"] } }], [], { avgMl: 1500, targetMl: 3000, daysLogged: 10 });
    expect(d.suggestions[0]).toMatch(/water to the target before changing fibre/);
    const unlogged = readDigestion([{ date: TODAY, answers: { recovery_flags: ["Digestion / bloating"], digestion_symptoms: ["Constipation"] } }], [], { avgMl: 1500, targetMl: 3000, daysLogged: 1 });
    expect(unlogged.suggestions.join(" ")).not.toMatch(/water to the target/);
  });
});

describe("the whole assessment", () => {
  const raw = (o: Partial<AssessmentInput> = {}): AssessmentInput => ({
    today: TODAY,
    unit: "lb",
    speedUnit: "mph",
    sex: "M",
    age: 28,
    heightCm: 178,
    level: "intermediate",
    weighIns: series(35, 85.5, -0.4, 0.2),
    goal: null,
    meet: { name: "Manitoba Provincials", date: addDays(TODAY, 70), weightClass: "83", federation: "CPU", sport: "powerlifting" },
    powerlifter: true,
    plan: { start: "2026-09-15", weeklyKcal: 2700, phase: "Fat Loss", starts: ["2026-09-15"] },
    checkins: [{ date: "2026-11-15", answers: { nutrition_rating: 5, recovery_flags: ["All good"] } }],
    cardio: { targets: [], lastChanged: null, history: null, done: null, planned: null },
    trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"],
    heavyLowerDays: ["Monday", "Thursday"],
    sessionMinutes: 75,
    dailySteps: null,
    water: { avgMl: null, targetMl: 3000, daysLogged: 0 },
    waist: [],
    performance: { lower: "steady", detail: null },
    health: { walkingLimits: [], fluidRestriction: false },
    profile: { climate: null, sweat: null, maxIncline: null, availableMinutes: null },
    pastPhases: [],
    ...o,
  });

  it("a meet's weight class is the goal: the limit less a buffer, in a normal state", () => {
    const a = buildAssessment(raw());
    expect(a.context).toBe("powerlifting_class");
    expect(a.goal).toMatchObject({ kind: "at_most", source: "meet", limitKg: 83 });
    expect(a.goal!.kg).toBeLessThan(83);
    expect(a.weighInTiming).toMatchObject({ hours: 2 });
    expect(a.cardio.modality).toBe("treadmill");
    expect(a.cardio.suggested.restDay?.weekdays).not.toContain("Sunday");
    const text = assessmentText(a);
    expect(text).toMatch(/^WEIGHT MANAGEMENT/);
    expect(text).toMatch(/83 kg class at Manitoba Provincials/);
    expect(text).toMatch(/class limit 183 lb less a 0\.9 lb buffer/);
    expect(text).toMatch(/Never dehydration, water loading or sodium manipulation/);
    expect(text).toMatch(/2 hours before lifting/);
  });

  it("no meet: the bodyweight goal the coach set", () => {
    const g = resolveGoal({ goal: { type: "lose", kg: 80, kgMax: null, date: "2027-02-01" }, meet: null, today: TODAY, plan: { start: null, weeklyKcal: null, phase: "Fat Loss", starts: [] }, powerlifter: false }, null);
    expect(g).toMatchObject({ context: "fat_loss", goal: { kg: 80, kind: "at_most", date: "2027-02-01" } });
    const m = resolveGoal({ goal: { type: "maintain", kg: 80, kgMax: 82, date: null }, meet: null, today: TODAY, plan: { start: null, weeklyKcal: null, phase: null, starts: [] }, powerlifter: false }, null);
    expect(m.goal).toMatchObject({ kg: 81, kind: "around" });
    // a meet more than 26 weeks out doesn't drive today's plan
    const far = resolveGoal({ goal: null, meet: { name: "Worlds", date: "2027-09-01", weightClass: "83", federation: "IPF", sport: "powerlifting" }, today: TODAY, plan: { start: null, weeklyKcal: null, phase: null, starts: [] }, powerlifter: true }, null);
    expect(far.goal).toBeNull();
  });

  it("the same records give the same hash; a new weigh-in changes it", () => {
    const a = buildAssessment(raw());
    const b = buildAssessment(raw());
    expect(a.hash).toBe(b.hash);
    const c = buildAssessment(raw({ weighIns: [...series(35, 85.5, -0.4, 0.2), { date: addDays(TODAY, 1), kg: 85 }], today: addDays(TODAY, 1) }));
    expect(c.hash).not.toBe(a.hash);
  });

  it("keeps a coach's bike plan and only moves its time", () => {
    const a = buildAssessment(raw({ cardio: { targets: [{ day_type: "Non-Training Day", cardio_type: "Bike", duration_minutes: 30, frequency_per_week: 2, scheduled_weekdays: ["Wednesday", "Saturday"] }], lastChanged: "2026-09-15", history: null, done: 6, planned: 8 } }));
    expect(a.cardio).toMatchObject({ modality: "other", keep: "Bike" });
    expect(assessmentText(a)).toMatch(/Bike \(the coach's choice: keep the type\)/);
    expect(assessmentText(a)).toMatch(/days off 30 min/);
  });

  it("water for them, and their doctor's when there's a fluid limit", () => {
    expect(buildAssessment(raw()).hydration.restMl).toBeGreaterThan(2000);
    expect(buildAssessment(raw({ health: { walkingLimits: [], fluidRestriction: true } })).hydration.restricted).toBe(true);
  });

  it("reads the check-ins: adherence, hunger, cardio and water problems", () => {
    const c = readCheckins([
      { date: "2026-11-15", answers: { nutrition_rating: 4, recovery_flags: ["Hunger / appetite", "Cardio"], hunger_level: 4, cardio_issue: ["Legs tired for lifting"] } },
      { date: "2026-11-08", answers: { nutrition_rating: 3, recovery_flags: ["Sleep"] } },
      { date: "2026-11-01", answers: { nutrition_rating: 5 } },
      { date: "2026-10-25", answers: { nutrition_rating: 1 } },
    ]);
    expect(c).toMatchObject({ count: 4, latest: "2026-11-15", adherence: 4, poorSleep: 1, hungerHigh: true, cardioIssues: ["Legs tired for lifting"] });
  });

  it("waist change needs two tapes 3+ weeks apart", () => {
    expect(waistChange([{ date: "2026-11-10", cm: 90 }, { date: "2026-11-15", cm: 89 }], TODAY)).toBeNull();
    expect(waistChange([{ date: "2026-10-20", cm: 91 }, { date: "2026-11-15", cm: 89 }], TODAY)).toMatchObject({ changeCm: -2, weeks: 3.7 });
  });

  it("shows weights in their unit", () => {
    expect(fmtWeight(83, "lb")).toBe("183 lb");
  });
});
