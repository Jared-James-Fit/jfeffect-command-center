import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dayScheduledDate } from "@/lib/workout-today";
import { mergeScheduledInstances } from "@/lib/scheduled-instances-merge";
import { getWorkoutStatus } from "@/lib/workout-status";

const iso = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

const block = { id: "b1", start_date: "2026-08-03" } as any;
const week = { id: "w1", week_index: 1, training_days: null } as any;

describe("workout schedule source of truth", () => {
  it("1. canonical instance date beats a conflicting pl_days.scheduled_date", () => {
    const d = dayScheduledDate({
      day: { id: "d1", day_index: 1, scheduled_date: "2026-08-05" },
      week,
      block,
      completion: null,
      scheduledDate: "2026-08-11",
    } as any);
    expect(iso(d)).toBe("2026-08-11");
  });

  it("2. canonical instance date beats committed cadence derivation", () => {
    const item = {
      day: { id: "d1", day_index: 1, scheduled_date: null },
      week,
      block,
      completion: null,
      scheduledDate: "2026-08-13",
    } as any;
    // Committed cadence would place day 1 on Monday 2026-08-03.
    expect(iso(dayScheduledDate({ ...item, scheduledDate: null }, ["monday", "wednesday", "friday"]))).toBe("2026-08-03");
    expect(iso(dayScheduledDate(item, ["monday", "wednesday", "friday"]))).toBe("2026-08-13");
  });

  it("3. each instance keeps the prescription from its own source_day_id", () => {
    const items = [
      { day: { id: "dayA", title: "Squat Day", scheduled_date: "2026-08-05" }, week, block, completion: null },
      { day: { id: "dayB", title: "Bench Day", scheduled_date: "2026-08-06" }, week, block, completion: null },
    ] as any[];
    const merged = mergeScheduledInstances({
      items,
      instances: [
        { id: "i1", client_id: "c", source_day_id: "dayB", scheduled_date: "2026-08-05", scheduled_time: null, order_index: 0, schedule_source: "moved" },
        { id: "i2", client_id: "c", source_day_id: "dayA", scheduled_date: "2026-08-06", scheduled_time: null, order_index: 0, schedule_source: "moved" },
      ],
      completions: [],
    });
    const byTitle = new Map(merged.map((m: any) => [m.day.title, m]));
    expect(byTitle.get("Bench Day")!.scheduledDate).toBe("2026-08-05");
    expect(byTitle.get("Bench Day")!.scheduledWorkoutId).toBe("i1");
    expect(byTitle.get("Squat Day")!.scheduledDate).toBe("2026-08-06");
    expect(byTitle.get("Squat Day")!.scheduledWorkoutId).toBe("i2");
    // Date resolution follows the instance, never the stale pl_days value.
    expect(iso(dayScheduledDate(byTitle.get("Squat Day") as any))).toBe("2026-08-06");
  });

  it("4. selected week header follows the selected instance", () => {
    const source = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
    expect(source).toContain("const selectedItems = byDate.get(toLocalISO(selectedDate)) ?? [];");
    expect(source).toContain("const selectedHeaderItem = selectedPrimaryItems[0] ?? null;");
    expect(source).toContain("const headerItem = selectedHeaderItem ?? fallbackHeaderItem;");
  });

  it("5. an untouched instance never shows Continue Workout", () => {
    const now = new Date("2026-08-11T10:00:00");
    const status = getWorkoutStatus(
      {
        day: { id: "dayA", day_index: 1, scheduled_date: "2026-08-05" },
        week,
        block,
        scheduledWorkoutId: "i1",
        scheduledDate: "2026-08-11",
        logged_sets_count: 0,
        completion: { id: "c1", started_at: null, in_progress_at: null, completed_at: null },
      } as any,
      now,
    );
    expect(status.status).not.toBe("in_progress");
    expect(status.status).toBe("today");
    expect(iso(status.scheduled)).toBe("2026-08-11");
  });

  it("legacy days with no instance still fall back to derived cadence", () => {
    const d = dayScheduledDate(
      { day: { id: "d9", day_index: 2, scheduled_date: null }, week, block, completion: null } as any,
      ["monday", "wednesday", "friday"],
    );
    expect(iso(d)).toBe("2026-08-05");
  });
});
