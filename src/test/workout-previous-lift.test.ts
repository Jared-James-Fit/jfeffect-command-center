import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  matchHistoryLogs,
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
describe("same lift twice in a workout: each card keeps its own role", () => {
  // Oct 2026: a sumo back-off card showed last week's 224.5 kg top set as
  // "Last time" and was offered a "last warm-up" after the top set was done.
  const log = (id: string, session: string, day: string, kg: number, rpe: number, purposeLabel: string) => ({
    id, exerciseId: "dl", exerciseName: "Competition Deadlift", sessionKey: session, occurredAt: `${day}T18:00:00Z`,
    reps: 5, rpe, rir: null, enteredValue: kg, enteredUnit: "kg" as const, normalizedKg: kg, normalizedLb: kg * 2.2046,
    isWorkingSet: null, purposeLabel,
  });
  const logs = [
    log("t1", "a", "2026-09-25", 215, 4, "Primary Deadlift"), log("b1", "a", "2026-09-25", 140, 6, "Primary Deadlift Backoff"),
    log("t2", "b", "2026-10-02", 224.5, 4, "Primary Deadlift"), log("b2", "b", "2026-10-02", 143, 6, "Primary Deadlift Backoff"),
  ];
  const ids = [
    { rowId: "top", exerciseId: "dl", exerciseName: "Competition Deadlift", purposeLabel: "Primary Deadlift" },
    { rowId: "back", exerciseId: "dl", exerciseName: "Competition Deadlift", purposeLabel: "Primary Deadlift Backoff" },
  ];

  it("Last Time is the same card last session", () => {
    const m = selectPreviousLifts(ids, logs, "today");
    expect(m.get("top")?.normalizedKg).toBe(224.5);
    expect(m.get("back")?.normalizedKg).toBe(143);
  });

  it("the back-off's suggestion learns from back-offs once there are 2 sessions of them", () => {
    expect(matchHistoryLogs(ids[1], logs, "today").map((l) => l.id)).toEqual(["b1", "b2"]);
    expect(matchHistoryLogs(ids[1], logs.filter((l) => l.id !== "b1"), "today")).toHaveLength(3);
  });

  it("only the first card of a lift asks for the last warm-up", () => {
    const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(view).toContain("if (seen.has(key)) later.add(r.id);");
    expect(view).toContain("const rampsUp = useMemo(() => !warmedUp && offersLastWarmup(family, name)");
  });
});
