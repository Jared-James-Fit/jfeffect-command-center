import { describe, it, expect } from "vitest";
import {
  applyOptimisticMove,
  canDragRescheduleItem,
  moveTargetFromItem,
  reconcileMovedDate,
  scheduleQueryKeys,
  isCompletedItem,
} from "@/lib/workout-move";
import type { WorkoutItem } from "@/lib/workout-today";

function item(over: Partial<WorkoutItem> & { id: string; date: string }): WorkoutItem {
  return {
    day: { id: `day-${over.id}`, day_index: 1, title: `W ${over.id}`, scheduled_date: over.date },
    week: { id: "w1", week_index: 1 },
    block: { id: "b1", status: "Active" },
    completion: null,
    scheduledWorkoutId: `inst-${over.id}`,
    scheduledDate: over.date,
    scheduleOrderIndex: 0,
    ...over,
  } as WorkoutItem;
}

const A = item({ id: "a", date: "2026-08-24" });
const B = item({ id: "b", date: "2026-08-26" });
const C = item({ id: "c", date: "2026-08-26" });

describe("drag/drop reschedule", () => {
  it("A: moves the exact instance to the destination date, identity preserved", () => {
    const target = moveTargetFromItem(A, "2026-08-24")!;
    const next = applyOptimisticMove([A, B], target, "2026-08-27");
    const moved = next.find((i) => i.scheduledWorkoutId === "inst-a")!;
    expect(moved.scheduledDate).toBe("2026-08-27");
    expect(moved.scheduledWorkoutId).toBe(A.scheduledWorkoutId);
    expect(moved.day).toBe(A.day); // same source_day_id object — not cloned
    expect(moved.completion).toBe(A.completion);
    expect(next.length).toBe(2);
  });

  it("B: moving back restores the original date with the same instance", () => {
    const t = moveTargetFromItem(A, "2026-08-24")!;
    const forward = applyOptimisticMove([A, B], t, "2026-08-27");
    const back = applyOptimisticMove(forward, t, "2026-08-24");
    expect(back.find((i) => i.scheduledWorkoutId === "inst-a")!.scheduledDate).toBe("2026-08-24");
  });

  it("D/E: optimistic patch is pure, so rollback is a snapshot restore", () => {
    const before = [A, B];
    const next = applyOptimisticMove(before, moveTargetFromItem(A, "2026-08-24")!, "2026-09-01");
    expect(before[0].scheduledDate).toBe("2026-08-24"); // original untouched
    expect(next).not.toBe(before);
  });

  it("F: other workouts on the destination date are untouched", () => {
    const next = applyOptimisticMove([A, B, C], moveTargetFromItem(A, "2026-08-24")!, "2026-08-26");
    expect(next.filter((i) => i.scheduledDate === "2026-08-26").map((i) => i.scheduledWorkoutId))
      .toEqual(["inst-a", "inst-b", "inst-c"].sort((x, y) => (x === "inst-a" ? 1 : -1)).sort());
    expect(next.find((i) => i.scheduledWorkoutId === "inst-b")).toBe(B);
    expect(next.find((i) => i.scheduledWorkoutId === "inst-c")).toBe(C);
  });

  it("G: completed workouts cannot be drag-rescheduled", () => {
    const done = item({ id: "d", date: "2026-08-20", completion: { completed_at: "2026-08-20T10:00:00Z" } } as any);
    expect(isCompletedItem(done)).toBe(true);
    expect(canDragRescheduleItem(done)).toBe(false);
    expect(canDragRescheduleItem(A)).toBe(true);
  });

  it("I: never creates a duplicate instance", () => {
    const next = applyOptimisticMove([A, B], moveTargetFromItem(A, "2026-08-24")!, "2026-08-26");
    const ids = next.map((i) => i.scheduledWorkoutId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(2);
  });

  it("J: only scheduledDate changes — logs / prescriptions / completion identical", () => {
    const withLogs = item({ id: "e", date: "2026-08-25", logged_sets_count: 12 } as any);
    const next = applyOptimisticMove([withLogs], moveTargetFromItem(withLogs, "2026-08-25")!, "2026-08-28")[0];
    expect(next.logged_sets_count).toBe(12);
    expect(next.week).toBe(withLogs.week);
    expect(next.block).toBe(withLogs.block);
    expect(next.day).toBe(withLogs.day);
  });

  it("K: cache invalidation is scoped to schedule keys only", () => {
    const keys = scheduleQueryKeys("client-1").map((k) => k[0]);
    expect(keys).toContain("my-workouts");
    expect(keys).toContain("scheduled-workouts");
    expect(keys.some((k) => String(k).startsWith("training-analytics"))).toBe(false);
    expect(keys.some((k) => String(k).startsWith("pl-"))).toBe(false);
  });

  it("realtime echo of the old date does not flash the card back", () => {
    expect(reconcileMovedDate("2026-08-24", "2026-08-27", true)).toBe("2026-08-27");
    expect(reconcileMovedDate("2026-08-27", "2026-08-27", true)).toBe("2026-08-27");
    expect(reconcileMovedDate("2026-08-24", "2026-08-27", false)).toBe("2026-08-24");
  });

  it("legacy (no instance) items move by day id and patch pl_days date", () => {
    const legacy = { ...item({ id: "l", date: "2026-08-24" }), scheduledWorkoutId: null } as WorkoutItem;
    const t = moveTargetFromItem(legacy, "2026-08-24")!;
    expect(t.scheduledWorkoutId).toBeNull();
    const moved = applyOptimisticMove([legacy], t, "2026-08-29")[0];
    expect(moved.scheduledDate).toBe("2026-08-29");
    expect(moved.day.scheduled_date).toBe("2026-08-29");
  });
});
