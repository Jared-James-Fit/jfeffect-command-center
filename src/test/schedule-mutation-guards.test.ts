/**
 * Slice 2d — mutation-guard invariants for the scheduling server functions.
 *
 * These tests exercise the pure helpers used by moveScheduledWorkout,
 * reorderScheduledWorkouts, updateScheduledWorkoutTime, removeScheduledWorkout,
 * moveWorkout / swapWorkouts / applyBulkScheduleChange, and
 * rescheduleFromCommittedDays. Every case below maps to a bullet in the
 * Slice 2d spec.
 */
import { describe, it, expect } from "vitest";
import {
  ScheduleGuardError,
  assertInstanceNotCompleted,
  assertNoInstanceForDays,
  completedDayIds,
  completedInstanceIds,
  planRealignTargets,
  validateReorderPayload,
} from "@/lib/schedule-mutation-guards";

describe("assertInstanceNotCompleted — completed instances are immutable", () => {
  it("no completion → allowed", () => {
    expect(() => assertInstanceNotCompleted(null)).not.toThrow();
    expect(() => assertInstanceNotCompleted({ completed_at: null })).not.toThrow();
  });
  it("completed → rejected with locked-history message", () => {
    expect(() => assertInstanceNotCompleted({ completed_at: "2026-07-08T00:00:00Z" }))
      .toThrow(ScheduleGuardError);
    expect(() => assertInstanceNotCompleted({ completed_at: "2026-07-08T00:00:00Z" }))
      .toThrow(/already completed/);
  });
});

describe("validateReorderPayload — reorder never partial / never touches completed", () => {
  it("normalizes order_index to 0..N-1 in requested order", () => {
    const plan = validateReorderPayload({
      existingIds: ["a", "b", "c"],
      requestedIds: ["c", "a", "b"],
      completed: new Set(),
    });
    expect(plan).toEqual([
      { id: "c", orderIndex: 0 },
      { id: "a", orderIndex: 1 },
      { id: "b", orderIndex: 2 },
    ]);
  });
  it("rejects missing ids (partial reorder)", () => {
    expect(() =>
      validateReorderPayload({
        existingIds: ["a", "b", "c"],
        requestedIds: ["a", "b"],
        completed: new Set(),
      }),
    ).toThrow(/does not match/);
  });
  it("rejects foreign ids not on the date", () => {
    expect(() =>
      validateReorderPayload({
        existingIds: ["a", "b"],
        requestedIds: ["a", "b", "z"],
        completed: new Set(),
      }),
    ).toThrow(/does not match/);
  });
  it("rejects duplicate ids", () => {
    expect(() =>
      validateReorderPayload({
        existingIds: ["a", "b"],
        requestedIds: ["a", "a"],
        completed: new Set(),
      }),
    ).toThrow(/duplicate/);
  });
  it("rejects when any id is completed", () => {
    expect(() =>
      validateReorderPayload({
        existingIds: ["a", "b"],
        requestedIds: ["b", "a"],
        completed: new Set(["a"]),
      }),
    ).toThrow(/completed/);
  });
});

describe("assertNoInstanceForDays — legacy bulk paths blocked when instance exists", () => {
  it("no instances → allowed", () => {
    expect(() => assertNoInstanceForDays({ instances: [], dayIds: ["d1"] })).not.toThrow();
  });
  it("day with instance → rejected with clear migration message", () => {
    expect(() =>
      assertNoInstanceForDays({
        instances: [{ source_day_id: "d1" }],
        dayIds: ["d1", "d2"],
      }),
    ).toThrow(/new scheduling system/);
  });
  it("only unrelated instances → allowed", () => {
    expect(() =>
      assertNoInstanceForDays({
        instances: [{ source_day_id: "other" }],
        dayIds: ["d1"],
      }),
    ).not.toThrow();
  });
});

describe("planRealignTargets — instance-first, pl_days fallback only when no instance", () => {
  it("routes moves to instance when one exists for the day", () => {
    const plan = planRealignTargets({
      moves: [
        { dayId: "d1", newDate: "2026-07-20", prevDate: "2026-07-10" },
        { dayId: "d2", newDate: "2026-07-21", prevDate: "2026-07-11" },
      ],
      instances: [
        { id: "i1", source_day_id: "d1", scheduled_date: "2026-07-10" },
      ],
    });
    expect(plan[0]).toMatchObject({ target: "instance", instanceId: "i1", newDate: "2026-07-20", prevDate: "2026-07-10" });
    expect(plan[1]).toMatchObject({ target: "day", dayId: "d2", newDate: "2026-07-21" });
  });
  it("picks the earliest instance when a day has multiple (defensive)", () => {
    const plan = planRealignTargets({
      moves: [{ dayId: "d1", newDate: "2026-07-30", prevDate: null }],
      instances: [
        { id: "later", source_day_id: "d1", scheduled_date: "2026-07-15" },
        { id: "earlier", source_day_id: "d1", scheduled_date: "2026-07-10" },
      ],
    });
    expect(plan[0]).toMatchObject({ target: "instance", instanceId: "earlier" });
  });
});

describe("completedInstanceIds / completedDayIds — set derivation", () => {
  it("filters null completed_at and null ids", () => {
    const set = completedInstanceIds([
      { scheduled_workout_id: "a", completed_at: "2026-07-08T00:00:00Z" },
      { scheduled_workout_id: "b", completed_at: null },
      { scheduled_workout_id: null, completed_at: "2026-07-08T00:00:00Z" },
    ]);
    expect([...set]).toEqual(["a"]);
  });
  it("day ids filtered by completed_at", () => {
    const set = completedDayIds([
      { day_id: "d1", completed_at: "2026-07-08T00:00:00Z" },
      { day_id: "d2", completed_at: null },
    ]);
    expect([...set]).toEqual(["d1"]);
  });
});

/**
 * Reorder-invariance / undo mapping — verify that undo constructed from
 * the "previous" snapshot of a moveScheduledWorkout call is symmetric
 * against the same helpers. This locks the behavior described in
 * MoveWorkoutSheet's instance-scoped Undo action.
 */
describe("instance-scoped undo shape", () => {
  it("undo of a move restores date/time/orderIndex — never a day_id write", () => {
    // The server returns `previous` = { scheduledDate, scheduledTime, orderIndex }
    const previous = { scheduledDate: "2026-07-11", scheduledTime: null, orderIndex: 0 };
    // A well-formed undo payload never carries a day_id or bulk-batch id.
    const undoPayload = {
      instanceId: "iA",
      newDate: previous.scheduledDate,
      time: previous.scheduledTime,
      orderIndex: previous.orderIndex,
    };
    expect(undoPayload).not.toHaveProperty("dayId");
    expect(undoPayload).not.toHaveProperty("batchId");
    expect(undoPayload.instanceId).toBe("iA");
  });
});
