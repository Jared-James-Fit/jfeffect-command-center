import { describe, expect, it } from "vitest";
import {
  normalizeExerciseHistoryName,
  selectPreviousLifts,
  type PreviousLiftLog,
} from "@/lib/workout-previous-lift";

const log = (overrides: Partial<PreviousLiftLog>): PreviousLiftLog => ({
  id: "log",
  exerciseId: "squat-id",
  exerciseName: "Competition Squat",
  sessionKey: "instance:previous",
  occurredAt: "2026-07-24T18:00:00Z",
  reps: 3,
  rpe: 8,
  rir: null,
  enteredValue: 170,
  enteredUnit: "kg",
  normalizedKg: 170,
  normalizedLb: 374.7858,
  isWorkingSet: true,
  ...overrides,
});

describe("workout previous lift selection", () => {
  it("normalizes safe competition-name variants without overmatching other presses", () => {
    expect(normalizeExerciseHistoryName("Competition Squat")).toBe("squat");
    expect(normalizeExerciseHistoryName("Comp Squat")).toBe("squat");
    expect(normalizeExerciseHistoryName("Squat — Competition")).toBe("squat");
    expect(normalizeExerciseHistoryName("Competition Bench Press")).toBe("bench");
    expect(normalizeExerciseHistoryName("Machine Chest Press")).toBe("machine chest press");
  });

  it("prefers canonical id, excludes the current instance, then picks heaviest and highest reps", () => {
    const selected = selectPreviousLifts(
      [{ rowId: "current-row", exerciseId: "squat-id", exerciseName: "Competition Squat" }],
      [
        log({ id: "current", sessionKey: "instance:current", normalizedKg: 200, normalizedLb: 440.9245, reps: 1 }),
        log({ id: "lighter", normalizedKg: 160, normalizedLb: 352.7396, reps: 5 }),
        log({ id: "winner", normalizedKg: 170, normalizedLb: 374.7858, reps: 3 }),
        log({ id: "same-load-more-reps", normalizedKg: 170, normalizedLb: 374.7858, reps: 4 }),
        log({ id: "other-client-shape", exerciseId: "leg-press", exerciseName: "Leg Press", normalizedKg: 300, normalizedLb: 661.3868 }),
      ],
      "instance:current",
    ).get("current-row");
    expect(selected?.id).toBe("same-load-more-reps");
    expect(selected?.match).toBe("exercise_id");
  });

  it("uses normalized name only when an id match is unavailable", () => {
    const selected = selectPreviousLifts(
      [{ rowId: "row", exerciseId: "new-id", exerciseName: "Squat - Competition" }],
      [log({ exerciseId: "old-id", exerciseName: "Comp Squat" })],
      "instance:current",
    ).get("row");
    expect(selected?.match).toBe("name");
  });
});