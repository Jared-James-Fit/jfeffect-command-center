import { describe, expect, it } from "vitest";
import {
  buildLoadModel,
  loadStep,
  percentOf1RM,
  planningTarget,
  predictReadiness,
  setE1rm,
  suggestSetLoad,
  suggestedSessionRpe,
} from "@/lib/load-suggestion";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

const NOW = new Date("2026-10-06T18:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const log = (session: string, d: number, kg: number, reps: number, rpe: number | null, extra: Partial<PreviousLiftLog> = {}): PreviousLiftLog => ({
  id: `${session}-${kg}-${reps}-${Math.random()}`, exerciseId: "squat", exerciseName: "Squat",
  sessionKey: session, occurredAt: daysAgo(d), reps, rpe, rir: null,
  enteredValue: kg, enteredUnit: "kg", normalizedKg: kg, normalizedLb: kg * 2.2046226218,
  isWorkingSet: true, loadType: "external", ...extra,
});
const twoWeeks = [
  log("s1", 9, 140, 5, 8), log("s1", 9, 140, 5, 8), log("s1", 9, 140, 5, 8.5),
  log("s2", 2, 145, 5, 8), log("s2", 2, 145, 5, 8.5), log("s2", 2, 145, 5, 8.5),
];

describe("RPE chart", () => {
  it("matches the RTS chart and interpolates half RPEs", () => {
    expect(percentOf1RM(1, 0)).toBe(1);
    expect(percentOf1RM(5, 2)).toBeCloseTo(0.811, 3); // 5 @ RPE 8 ≈ 7RM
    expect(percentOf1RM(3, 1.5)!).toBeGreaterThan(percentOf1RM(3, 2)!);
    expect(percentOf1RM(15, 3)!).toBeLessThan(percentOf1RM(12, 0)!);
    expect(percentOf1RM(20, 4)).toBeNull(); // too far out to trust
  });

  it("ignores warm-ups and down-weights unlogged effort", () => {
    expect(setE1rm({ load: 100, reps: 5, rpe: 5 })).toBeNull();
    expect(setE1rm({ load: 100, reps: 5, rpe: null })!.trust).toBeLessThan(setE1rm({ load: 100, reps: 5, rpe: 8 })!.trust);
  });
});

describe("buildLoadModel / suggestSetLoad", () => {
  it("waits for a week of data before suggesting anything cold", () => {
    const one = buildLoadModel({ history: twoWeeks.filter((l) => l.sessionKey === "s2"), today: [], unit: "kg", now: NOW });
    expect(one.status).toBe("calibrating");
    expect(suggestSetLoad(one, { reps: 5, rpe: 8 })).toBeNull();
    const two = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
    expect(two.status).toBe("ready");
  });

  it("suggests the athlete's recent load for the same reps/RPE, as a plate-loadable range", () => {
    const m = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
    const s = suggestSetLoad(m, { reps: 5, rpe: 8 })!;
    expect(s.target).toBeGreaterThanOrEqual(140);
    expect(s.target).toBeLessThanOrEqual(147.5);
    expect(s.low).toBeLessThan(s.target);
    expect(s.high).toBeGreaterThan(s.target);
    for (const v of [s.low, s.target, s.high]) expect(v % 2.5).toBe(0);
  });

  it("goes lighter for more reps or a lower RPE, heavier for a higher RPE", () => {
    const m = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
    const base = suggestSetLoad(m, { reps: 5, rpe: 8 })!.target;
    expect(suggestSetLoad(m, { reps: 8, rpe: 8 })!.target).toBeLessThan(base);
    expect(suggestSetLoad(m, { reps: 5, rpe: 6.5 })!.target).toBeLessThan(base);
    expect(suggestSetLoad(m, { reps: 3, rpe: 9 })!.target).toBeGreaterThan(base);
  });

  it("autoregulates from today's sets: an easy top set raises the back-offs", () => {
    const cold = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), { reps: 5, rpe: 8 })!;
    const strongDay = buildLoadModel({
      history: twoWeeks, today: [{ load: 150, reps: 5, rpe: 7 }], unit: "kg", now: NOW,
    });
    expect(strongDay.source).toBe("blend");
    expect(suggestSetLoad(strongDay, { reps: 5, rpe: 8 })!.target).toBeGreaterThan(cold.target);
    const grindDay = buildLoadModel({
      history: twoWeeks, today: [{ load: 140, reps: 5, rpe: 9.5 }], unit: "kg", now: NOW,
    });
    expect(suggestSetLoad(grindDay, { reps: 5, rpe: 8 })!.target).toBeLessThan(cold.target);
  });

  it("works on a brand-new lift after the first logged set", () => {
    const m = buildLoadModel({ history: [], today: [{ load: 60, reps: 10, rpe: 8 }], unit: "kg", now: NOW });
    expect(m.source).toBe("today");
    expect(suggestSetLoad(m, { reps: 10, rpe: 8 })!.target).toBe(60);
  });

  it("only lets readiness trim a cold suggestion, never inflate it", () => {
    const tired = predictReadiness(
      { submittedAt: daysAgo(1), sessionRpe: 10, pain: true, sleepBucket: "lt5", recoveryToday: 1 }, NOW,
    );
    expect(tired.multiplier).toBeCloseTo(0.95, 5); // capped at -5%
    const normal = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), { reps: 5, rpe: 8 })!;
    const trimmed = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW, readiness: tired }), { reps: 5, rpe: 8 })!;
    expect(trimmed.target).toBeLessThan(normal.target);
    expect(predictReadiness({ submittedAt: daysAgo(6), sessionRpe: 10, pain: true, sleepBucket: "lt5", recoveryToday: 1 }, NOW).multiplier).toBe(1);
    expect(predictReadiness({ submittedAt: daysAgo(1), sessionRpe: 7, pain: false, sleepBucket: "7_8", recoveryToday: 5 }, NOW).multiplier).toBe(1);
  });

  it("ignores bodyweight/assisted sets, other units convert", () => {
    const bw = twoWeeks.map((l) => ({ ...l, loadType: "bodyweight" as const }));
    expect(buildLoadModel({ history: bw, today: [], unit: "kg", now: NOW }).status).toBe("calibrating");
    const lb = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "lb", now: NOW }), { reps: 5, rpe: 8 })!;
    expect(lb.target % 5).toBe(0);
    expect(lb.target).toBeGreaterThan(300);
  });

  it("backs off after a long layoff", () => {
    const old = twoWeeks.map((l) => ({ ...l, occurredAt: new Date(Date.parse(l.occurredAt!) - 35 * 86_400_000).toISOString() }));
    const m = buildLoadModel({ history: old, today: [], unit: "kg", now: NOW });
    expect(m.staleDays).toBeGreaterThan(21);
    const fresh = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), { reps: 5, rpe: 8 })!;
    expect(suggestSetLoad(m, { reps: 5, rpe: 8 })!.target).toBeLessThanOrEqual(fresh.target);
  });
});

describe("planningTarget", () => {
  it("plans rep ranges at the midpoint and defaults effort to RPE 8", () => {
    expect(planningTarget({ repTarget: { min: 8, max: 12 }, rpeTarget: {}, rirTarget: {} })).toEqual({ reps: 10, rpe: 8 });
    expect(planningTarget({ repTarget: { exact: 5 }, rpeTarget: { exact: 7.5 }, rirTarget: {} })).toEqual({ reps: 5, rpe: 7.5 });
    expect(planningTarget({ repTarget: { exact: 6 }, rpeTarget: {}, rirTarget: { min: 1, max: 2 } })).toEqual({ reps: 6, rpe: 8.5 });
    expect(planningTarget({ repTarget: { exact: 30 }, rpeTarget: {}, rirTarget: {} })).toBeNull();
  });
});

describe("helpers", () => {
  it("uses finer steps for light loads", () => {
    expect(loadStep("kg", 12)).toBe(1);
    expect(loadStep("lb", 30)).toBe(2.5);
    expect(loadStep("lb", 225)).toBe(5);
  });

  it("pre-fills session RPE from today's working sets", () => {
    expect(suggestedSessionRpe([8, 8, 8.5, 9])).toBe(9);
    expect(suggestedSessionRpe([7, 7])).toBe(7);
    expect(suggestedSessionRpe([8])).toBeNull();
    expect(suggestedSessionRpe([5, 4, null])).toBeNull();
  });
});
