import { describe, expect, it } from "vitest";
import { computeRepMaxBests, detectSetPR } from "@/lib/workout-pr";
import {
  parseRepQuickTarget,
  parseEffortQuickTarget,
  repQuickOptions,
  rpeQuickOptions,
  moreOptions,
  RPE_FULL_OPTIONS,
} from "@/lib/workout-quick-select";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

const log = (overrides: Partial<PreviousLiftLog>): PreviousLiftLog => ({
  id: "log",
  exerciseId: "squat-id",
  exerciseName: "Competition Squat",
  sessionKey: "instance:previous",
  occurredAt: "2026-07-24T18:00:00Z",
  reps: 3,
  rpe: 8,
  rir: null,
  enteredValue: 315,
  enteredUnit: "lb",
  normalizedKg: 142.88,
  normalizedLb: 315,
  isWorkingSet: true,
  ...overrides,
});

const identity = { rowId: "row-1", exerciseId: "squat-id", exerciseName: "Competition Squat" };

describe("rep-max PR baselines", () => {
  it("keeps the heaviest set per exact rep count and excludes the current session", () => {
    const bests = computeRepMaxBests(identity, [
      log({ id: "a", reps: 3, normalizedLb: 315, normalizedKg: 142.88 }),
      log({ id: "b", reps: 3, normalizedLb: 305, normalizedKg: 138.35 }),
      log({ id: "c", reps: 5, normalizedLb: 275, normalizedKg: 124.74 }),
      log({ id: "current", reps: 3, normalizedLb: 500, normalizedKg: 226.8, sessionKey: "instance:current" }),
    ], "instance:current");
    expect(bests.get(3)?.id).toBe("a");
    expect(bests.get(5)?.id).toBe("c");
  });

  it("matches safe name variants but never unrelated exercises", () => {
    const noId = { rowId: "row-1", exerciseId: null, exerciseName: "Squat - Competition" };
    const bests = computeRepMaxBests(noId, [
      log({ id: "variant", exerciseId: null, exerciseName: "Comp Squat", reps: 3, normalizedLb: 315 }),
      log({ id: "unsafe", exerciseId: null, exerciseName: "Leg Press", reps: 3, normalizedLb: 600 }),
    ], "instance:current");
    expect(bests.get(3)?.id).toBe("variant");
  });
});

describe("detectSetPR", () => {
  const bests = computeRepMaxBests(identity, [
    log({ id: "best-3", reps: 3, normalizedLb: 315, normalizedKg: 142.88, enteredValue: 315, enteredUnit: "lb" }),
  ], "instance:current");

  it("flags a heavier set at the same rep count with the amount added", () => {
    const pr = detectSetPR({ reps: 3, load: 325, loadUnit: "lb" }, bests, "lb");
    expect(pr).toEqual({ reps: 3, amount: 10, unit: "lb" });
  });

  it("shows no PR for ties or lower weights", () => {
    expect(detectSetPR({ reps: 3, load: 315, loadUnit: "lb" }, bests, "lb")).toBeNull();
    expect(detectSetPR({ reps: 3, load: 305, loadUnit: "lb" }, bests, "lb")).toBeNull();
  });

  it("shows no PR without a historical baseline for that rep count", () => {
    expect(detectSetPR({ reps: 8, load: 225, loadUnit: "lb" }, bests, "lb")).toBeNull();
  });

  it("converts kg/lb correctly for the amount added", () => {
    // Best: 315 lb (142.88 kg). New set: 150 kg → +7.1 kg; in lb: 330.7 lb → +15.7 lb.
    const prKg = detectSetPR({ reps: 3, load: 150, loadUnit: "kg" }, bests, "kg");
    expect(prKg?.reps).toBe(3);
    expect(prKg?.amount).toBeCloseTo(7.1, 1);
    expect(prKg?.unit).toBe("kg");
    const prLb = detectSetPR({ reps: 3, load: 150, loadUnit: "kg" }, bests, "lb");
    expect(prLb?.amount).toBeCloseTo(15.7, 1);
    expect(prLb?.unit).toBe("lb");
  });

  it("supports rep-maxes from 1 through 12 and ignores beyond", () => {
    const wide = computeRepMaxBests(identity, [
      log({ id: "r1", reps: 1, normalizedLb: 405 }),
      log({ id: "r12", reps: 12, normalizedLb: 225 }),
      log({ id: "r20", reps: 20, normalizedLb: 135 }),
    ], "instance:current");
    expect(wide.has(1)).toBe(true);
    expect(wide.has(12)).toBe(true);
    expect(wide.has(20)).toBe(false);
  });
});

describe("quick selector options", () => {
  it("RPE 7-8 range yields 7, 7.5, 8", () => {
    expect(rpeQuickOptions(parseEffortQuickTarget("RPE 7-8"))).toEqual([7, 7.5, 8]);
  });

  it("RPE 8 single emphasizes 7.5, 8, 8.5", () => {
    expect(rpeQuickOptions(parseEffortQuickTarget("8"))).toEqual([7.5, 8, 8.5]);
    expect(rpeQuickOptions(parseEffortQuickTarget("@8"))).toEqual([7.5, 8, 8.5]);
  });

  it("RPE 8-9 range yields 8, 8.5, 9", () => {
    expect(rpeQuickOptions(parseEffortQuickTarget("8-9"))).toEqual([8, 8.5, 9]);
  });

  it("no RPE prescription falls back to common whole values with halves in More", () => {
    const primary = rpeQuickOptions(parseEffortQuickTarget(null));
    expect(primary).toEqual([6, 7, 8, 9, 10]);
    expect(moreOptions(RPE_FULL_OPTIONS, primary)).toEqual([5, 5.5, 6.5, 7.5, 8.5, 9.5]);
  });

  it("reps 8-10 yields 8, 9, 10", () => {
    expect(repQuickOptions(parseRepQuickTarget("8-10"))).toEqual([8, 9, 10]);
  });

  it("reps 3 single yields 2, 3, 4", () => {
    expect(repQuickOptions(parseRepQuickTarget("3"))).toEqual([2, 3, 4]);
  });

  it("reps 12-15 yields 12, 13, 14, 15", () => {
    expect(repQuickOptions(parseRepQuickTarget("12-15"))).toEqual([12, 13, 14, 15]);
  });

  it("reps 8-12 wider range yields every value", () => {
    expect(repQuickOptions(parseRepQuickTarget("8-12"))).toEqual([8, 9, 10, 11, 12]);
  });

  it("AMRAP / plus sets widen around the target", () => {
    expect(repQuickOptions(parseRepQuickTarget("8+"))).toEqual([8, 9, 10, 11, 12, 15]);
    expect(repQuickOptions(parseRepQuickTarget("AMRAP 10"))).toEqual([10, 11, 12, 13, 14, 17]);
  });

  it("no rep target falls back to common options", () => {
    expect(repQuickOptions(parseRepQuickTarget(null))).toEqual([1, 2, 3, 5, 8, 10, 12, 15]);
  });
});