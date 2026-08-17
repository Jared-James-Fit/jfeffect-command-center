import { describe, expect, it } from "vitest";
import { compareWorkoutItemsBySchedule, type WorkoutItem } from "@/lib/workout-today";

function item(id: string, extra: Partial<WorkoutItem> = {}): WorkoutItem {
  return {
    day: { id, day_index: 1 },
    week: { week_index: 1 },
    block: { sort_order: 1 },
    completion: null,
    ...extra,
  };
}

describe("compareWorkoutItemsBySchedule", () => {
  it("uses canonical scheduled chronology before program order", () => {
    const laterProgramDay = item("day-2", {
      day: { id: "day-2", day_index: 2 },
      week: { week_index: 1 },
      scheduledDate: "2026-08-20",
    });
    const movedEarlierDay = item("day-1", {
      day: { id: "day-1", day_index: 1 },
      week: { week_index: 2 },
      scheduledDate: "2026-08-18",
      scheduleSource: "moved",
    });

    expect([laterProgramDay, movedEarlierDay].sort(compareWorkoutItemsBySchedule).map((row) => row.day.id))
      .toEqual(["day-1", "day-2"]);
  });

  it("uses scheduled time and order index for same-day sessions", () => {
    const second = item("second", { scheduledDate: "2026-08-20", scheduledTime: "18:00", scheduleOrderIndex: 1 });
    const first = item("first", { scheduledDate: "2026-08-20", scheduledTime: "08:00", scheduleOrderIndex: 0 });

    expect([second, first].sort(compareWorkoutItemsBySchedule).map((row) => row.day.id))
      .toEqual(["first", "second"]);
  });

  it("keeps unscheduled placeholders after dated workouts and falls back to program order", () => {
    const unscheduledLater = item("unscheduled-later", {
      day: { id: "unscheduled-later", day_index: 2 },
      week: { week_index: 1 },
      block: { sort_order: 1 },
    });
    const scheduled = item("scheduled", { scheduledDate: "2026-08-20" });
    const unscheduledFirst = item("unscheduled-first", {
      day: { id: "unscheduled-first", day_index: 1 },
      week: { week_index: 1 },
      block: { sort_order: 1 },
    });

    expect([unscheduledLater, scheduled, unscheduledFirst].sort(compareWorkoutItemsBySchedule).map((row) => row.day.id))
      .toEqual(["scheduled", "unscheduled-first", "unscheduled-later"]);
  });
});
