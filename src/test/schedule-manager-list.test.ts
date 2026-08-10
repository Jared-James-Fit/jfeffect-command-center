import { describe, expect, it } from "vitest";
import { buildScheduleManagerRows } from "@/components/schedule/ScheduleManagerList";

const TODAY = "2026-08-10";

const day = (id: string, over: Partial<any> = {}) => ({
  id,
  day_index: 1,
  title: "Bench Volume",
  scheduled_date: null,
  week_id: "w1",
  ...over,
});

describe("buildScheduleManagerRows", () => {
  it("marks a day with no instance and no scheduled_date as missing", () => {
    const { rows, total, scheduledCount, missingCount } = buildScheduleManagerRows({
      days: [day("d1")],
      scheduledInstances: [],
      completions: [],
      todayISO: TODAY,
    });
    expect(total).toBe(1);
    expect(scheduledCount).toBe(0);
    expect(missingCount).toBe(1);
    expect(rows[0].status).toBe("missing");
    expect(rows[0].date).toBeNull();
    expect(rows[0].instanceId).toBeNull();
  });

  it("uses the instance date as the source of truth and does not double-emit the legacy date", () => {
    const { rows, scheduledCount, missingCount } = buildScheduleManagerRows({
      days: [day("d1", { scheduled_date: "2026-08-12" })],
      scheduledInstances: [
        { id: "i1", source_day_id: "d1", scheduled_date: "2026-08-14", scheduled_time: null, order_index: 0 },
      ],
      completions: [],
      todayISO: TODAY,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-08-14");
    expect(rows[0].instanceId).toBe("i1");
    expect(rows[0].status).toBe("scheduled");
    expect(scheduledCount).toBe(1);
    expect(missingCount).toBe(0);
  });

  it("falls back to the legacy scheduled_date when no instance exists", () => {
    const { rows } = buildScheduleManagerRows({
      days: [day("d1", { scheduled_date: "2026-08-09" })],
      scheduledInstances: [],
      completions: [],
      todayISO: TODAY,
    });
    expect(rows[0].date).toBe("2026-08-09");
    expect(rows[0].instanceId).toBeNull();
    expect(rows[0].status).toBe("past_due"); // before today, not completed
  });

  it("marks a workout with completed_at as completed (locked)", () => {
    const { rows } = buildScheduleManagerRows({
      days: [day("d1", { scheduled_date: "2026-08-09" })],
      scheduledInstances: [],
      completions: [{ id: "c1", day_id: "d1", scheduled_workout_id: null, completed_at: "2026-08-09T20:00:00Z" }],
      todayISO: TODAY,
    });
    expect(rows[0].status).toBe("completed");
  });

  it("does not falsely lock a 0%-logged workout that only has start markers", () => {
    const { rows } = buildScheduleManagerRows({
      days: [day("d1", { scheduled_date: "2026-08-11" })],
      scheduledInstances: [],
      completions: [
        { id: "c1", day_id: "d1", scheduled_workout_id: null, completed_at: null, in_progress_at: "2026-08-10T01:00:00Z" },
      ],
      todayISO: TODAY,
    });
    // In progress — reschedulable through the move sheet, NOT completed.
    expect(rows[0].status).toBe("in_progress");
  });

  it("links completions instance-first and keeps legacy completions on legacy rows", () => {
    const { rows } = buildScheduleManagerRows({
      days: [day("d1"), day("d2", { scheduled_date: "2026-08-12" })],
      scheduledInstances: [
        { id: "i1", source_day_id: "d1", scheduled_date: "2026-08-13", scheduled_time: null, order_index: 0 },
      ],
      completions: [
        { id: "c1", day_id: "d1", scheduled_workout_id: "i1", completed_at: "2026-08-13T20:00:00Z" },
        { id: "c2", day_id: "d2", scheduled_workout_id: null, completed_at: null, started_at: "2026-08-10T01:00:00Z" },
      ],
      todayISO: TODAY,
    });
    const r1 = rows.find((r) => r.dayId === "d1")!;
    const r2 = rows.find((r) => r.dayId === "d2")!;
    expect(r1.status).toBe("completed");
    expect(r2.status).toBe("in_progress");
  });

  it("emits one row per instance when a day has multiple copies", () => {
    const { rows, total } = buildScheduleManagerRows({
      days: [day("d1")],
      scheduledInstances: [
        { id: "i2", source_day_id: "d1", scheduled_date: "2026-08-15", scheduled_time: null, order_index: 1 },
        { id: "i1", source_day_id: "d1", scheduled_date: "2026-08-12", scheduled_time: null, order_index: 0 },
      ],
      completions: [],
      todayISO: TODAY,
    });
    expect(total).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].instanceId).toBe("i1"); // sorted by date then order_index
    expect(rows[0].copyIndex).toBe(1);
    expect(rows[1].copyIndex).toBe(2);
  });
});