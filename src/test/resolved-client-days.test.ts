import { describe, expect, it } from "vitest";
import { resolveClientWeekDays, type CardioTargetLike, type ResolvedWorkoutDate } from "@/lib/resolved-client-days";

const clientId = "client-1";
const week = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"];

const targets: CardioTargetLike[] = [
  { id: "training", day_type: "Training Day", start_date: "2026-07-01", status: "Active", enabled: true, visible_to_client: true },
  { id: "high", day_type: "High Day", start_date: "2026-07-01", status: "Active", enabled: true, visible_to_client: true },
  { id: "non", day_type: "Non-Training Day", start_date: "2026-07-01", status: "Active", enabled: true, visible_to_client: true },
];

function workouts(dates: string[]): ResolvedWorkoutDate[] {
  return dates.map((date, index) => ({
    date,
    workoutId: `workout-${index + 1}`,
    workout: { id: `workout-${index + 1}` },
    isWorkoutOverride: false,
  }));
}

function map(types: ReturnType<typeof resolveClientWeekDays>) {
  return Object.fromEntries(types.map((d) => [d.date, d.cardioDayType]));
}

describe("resolveClientWeekDays", () => {
  it("covers four committed workout dates plus Sunday High Day across exactly seven dates", () => {
    const days = resolveClientWeekDays({
      clientId,
      weekDates: week,
      workouts: workouts(["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"]),
      recurringHighDays: ["Sunday"],
      cardioTargets: targets,
      defaultFullRestDay: false,
    });
    expect(days).toHaveLength(7);
    expect(map(days)).toEqual({
      "2026-07-06": "training",
      "2026-07-07": "training",
      "2026-07-08": "training",
      "2026-07-09": "training",
      "2026-07-10": "non_training",
      "2026-07-11": "non_training",
      "2026-07-12": "high",
    });
    expect(new Set(days.map((d) => d.date)).size).toBe(7);
    expect(days.every((d) => !Array.isArray(d.cardioTargetId))).toBe(true);
  });

  it("lets High Day override Training Day display while keeping the workout scheduled", () => {
    const days = resolveClientWeekDays({
      clientId,
      weekDates: week,
      workouts: workouts(["2026-07-06", "2026-07-12"]),
      recurringHighDays: ["Sunday"],
      cardioTargets: targets,
      defaultFullRestDay: false,
    });
    const sunday = days.find((d) => d.date === "2026-07-12")!;
    expect(sunday.hasCommittedWorkout).toBe(true);
    expect(sunday.nutritionDayType).toBe("high");
    expect(sunday.cardioDayType).toBe("high");
    expect(sunday.cardioTargetId).toBe("high");
  });

  it("moves Training Day cardio when a workout moves to another date", () => {
    const before = resolveClientWeekDays({ clientId, weekDates: week, workouts: workouts(["2026-07-07"]), recurringHighDays: ["Sunday"], cardioTargets: targets, defaultFullRestDay: false });
    const after = resolveClientWeekDays({ clientId, weekDates: week, workouts: workouts(["2026-07-08"]), recurringHighDays: ["Sunday"], cardioTargets: targets, defaultFullRestDay: false });
    expect(map(before)["2026-07-07"]).toBe("training");
    expect(map(before)["2026-07-08"]).toBe("non_training");
    expect(map(after)["2026-07-07"]).toBe("non_training");
    expect(map(after)["2026-07-08"]).toBe("training");
  });

  it("supports one-week High Day override without creating two High Days", () => {
    const days = resolveClientWeekDays({
      clientId,
      weekDates: week,
      workouts: workouts(["2026-07-06"]),
      recurringHighDays: ["Sunday"],
      highDayOverrides: [{ override_date: "2026-07-11", day_label: "High Day" }],
      cardioTargets: targets,
      defaultFullRestDay: false,
    });
    expect(days.filter((d) => d.cardioDayType === "high").map((d) => d.date)).toEqual(["2026-07-11"]);
    expect(days.find((d) => d.date === "2026-07-12")!.cardioDayType).toBe("non_training");
  });

  it("updates recurring High Day when the selected weekday changes", () => {
    const sunday = resolveClientWeekDays({ clientId, weekDates: week, workouts: [], recurringHighDays: ["Sunday"], cardioTargets: targets, defaultFullRestDay: false });
    const saturday = resolveClientWeekDays({ clientId, weekDates: week, workouts: [], recurringHighDays: ["Saturday"], cardioTargets: targets, defaultFullRestDay: false });
    expect(daysOf(sunday, "high")).toEqual(["2026-07-12"]);
    expect(daysOf(saturday, "high")).toEqual(["2026-07-11"]);
    expect(saturday.find((d) => d.date === "2026-07-12")!.cardioDayType).toBe("non_training");
  });

  it("assigns exactly one full cardio rest day on eligible non-training dates", () => {
    const days = resolveClientWeekDays({
      clientId,
      weekDates: week,
      workouts: workouts(["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"]),
      recurringHighDays: ["Sunday"],
      fullCardioRestDays: ["Saturday"],
      cardioTargets: targets,
    });
    expect(days.filter((d) => d.cardioDayType === "rest").map((d) => d.date)).toEqual(["2026-07-11"]);
    expect(days.find((d) => d.date === "2026-07-11")!.cardioTargetId).toBeUndefined();
  });

  it("does not duplicate cardio target assignments per date", () => {
    const days = resolveClientWeekDays({ clientId, weekDates: week, workouts: workouts(week.slice(0, 5)), recurringHighDays: ["Sunday"], cardioTargets: targets });
    expect(days).toHaveLength(7);
    expect(days.every((d) => [undefined, "training", "high", "non"].includes(d.cardioTargetId))).toBe(true);
  });

  it("still resolves legacy frequency-only targets by stable day type", () => {
    const legacyTargets = targets.map(({ start_date, ...target }) => ({ ...target, frequency_per_week: 4 } as CardioTargetLike));
    const days = resolveClientWeekDays({ clientId, weekDates: week, workouts: workouts(["2026-07-06"]), recurringHighDays: ["Sunday"], cardioTargets: legacyTargets, defaultFullRestDay: false });
    expect(days.find((d) => d.date === "2026-07-06")!.cardioTargetId).toBe("training");
    expect(days.find((d) => d.date === "2026-07-12")!.cardioTargetId).toBe("high");
  });

  it("uses date-only parsing safely around Sunday/Monday boundaries", () => {
    const days = resolveClientWeekDays({ clientId, weekDates: week, workouts: [], recurringHighDays: ["Sunday"], cardioTargets: targets, defaultFullRestDay: false });
    expect(days.find((d) => d.date === "2026-07-11")!.cardioDayType).not.toBe("high");
    expect(days.find((d) => d.date === "2026-07-12")!.cardioDayType).toBe("high");
  });

  it("returns the same resolved map for admin and client callers", () => {
    const input = { clientId, weekDates: week, workouts: workouts(["2026-07-06", "2026-07-08"]), recurringHighDays: ["Sunday"], cardioTargets: targets };
    const admin = resolveClientWeekDays(input);
    const client = resolveClientWeekDays(input);
    expect(client).toEqual(admin);
  });

  it("is idempotent across repeated syncs", () => {
    const input = { clientId, weekDates: week, workouts: workouts(["2026-07-06", "2026-07-08"]), recurringHighDays: ["Sunday"], cardioTargets: targets };
    expect(resolveClientWeekDays(input)).toEqual(resolveClientWeekDays(input));
  });
});

function daysOf(days: ReturnType<typeof resolveClientWeekDays>, type: "training" | "high" | "non_training" | "rest") {
  return days.filter((d) => d.cardioDayType === type).map((d) => d.date);
}