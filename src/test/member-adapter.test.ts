/**
 * Unit tests for the member workout adapter.
 *
 * These mock both the `member-plans.functions` server-fn wrappers and the
 * `supabase` client so the adapter can run in plain node without network.
 * The focus is on the parts most likely to silently regress:
 *   - capabilities are the locked-down member set
 *   - dayId encoding round-trips through reschedule
 *   - reschedule fan-out respects each scope
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------ mocks --- */

const rescheduleDay = vi.fn(async (_args: any) => ({}) as any);
const getEnrollmentSchedule = vi.fn(async (_args: any) => ({ schedule: [] as any[] }));
const logSet = vi.fn(async (_args: any) => ({}) as any);
const completeWorkout = vi.fn(async (_args: any) => ({}) as any);
const uncompleteWorkout = vi.fn(async (_args: any) => ({}) as any);

vi.mock("@/lib/member-plans.functions", () => ({
  rescheduleDay: (args: any) => rescheduleDay(args),
  getEnrollmentSchedule: (args: any) => getEnrollmentSchedule(args),
  logSet: (args: any) => logSet(args),
  completeWorkout: (args: any) => completeWorkout(args),
  uncompleteWorkout: (args: any) => uncompleteWorkout(args),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      throw new Error("supabase.from() called from a test that should not touch the DB");
    },
  },
}));

import { createMemberAdapter } from "@/lib/workout-context/member-adapter";

const ref = {
  kind: "member" as const,
  userId: "user-1",
  ownerId: "user-1",
  enrollmentId: "enr-1",
};

beforeEach(() => {
  rescheduleDay.mockClear();
  getEnrollmentSchedule.mockClear();
  logSet.mockClear();
  completeWorkout.mockClear();
  uncompleteWorkout.mockClear();
});

/* --------------------------------------------------------- capabilities --- */

describe("member adapter capabilities", () => {
  it("locks down coach-only writes", () => {
    const a = createMemberAdapter(ref);
    expect(a.capabilities).toMatchObject({
      canEditTemplate: false,
      canEditOwnLogs: true,
      canReschedule: true,
      canSubstituteExercise: false,
      canSeeCoachNotes: false,
      canSeeCoachIntel: false,
      canLeaveCoachFeedback: false,
      canSeeAdminNotes: false,
      canAssignPrograms: false,
    });
  });

  it("rejects construction without an enrollmentId", () => {
    expect(() =>
      createMemberAdapter({ ...ref, enrollmentId: undefined as any }),
    ).toThrow(/enrollmentId/);
  });
});

/* ---------------------------------------------------------- dayId codec --- */

describe("member adapter dayId encoding", () => {
  it("forwards (week, day) to rescheduleDay for this_workout_only", async () => {
    const a = createMemberAdapter(ref);
    await a.reschedule({
      dayId: "3:2",
      newDate: "2026-07-01",
      scope: "this_workout_only",
    });
    expect(rescheduleDay).toHaveBeenCalledTimes(1);
    expect(rescheduleDay).toHaveBeenCalledWith({
      data: {
        enrollmentId: "enr-1",
        weekIndex: 3,
        dayIndex: 2,
        scheduledDate: "2026-07-01",
      },
    });
    expect(getEnrollmentSchedule).not.toHaveBeenCalled();
  });

  it("rejects malformed dayId", async () => {
    const a = createMemberAdapter(ref);
    await expect(
      a.reschedule({ dayId: "nope", newDate: "2026-07-01", scope: "this_workout_only" }),
    ).rejects.toThrow(/invalid dayId/);
  });
});

/* ---------------------------------------------------- reschedule fan-out --- */

const SCHEDULE = [
  { week: 1, day: 1, date: "2026-06-15" },
  { week: 1, day: 2, date: "2026-06-17" },
  { week: 1, day: 3, date: "2026-06-19" },
  { week: 2, day: 1, date: "2026-06-22" },
  { week: 2, day: 2, date: "2026-06-24" },
  { week: 2, day: 3, date: "2026-06-26" },
];

function calledFor(week: number, day: number, date: string) {
  return {
    data: {
      enrollmentId: "enr-1",
      weekIndex: week,
      dayIndex: day,
      scheduledDate: date,
    },
  };
}

describe("member adapter reschedule fan-out", () => {
  beforeEach(() => {
    getEnrollmentSchedule.mockResolvedValue({ schedule: SCHEDULE });
  });

  it("this_week_only shifts every day in the target week by the same delta", async () => {
    const a = createMemberAdapter(ref);
    await a.reschedule({ dayId: "1:2", newDate: "2026-06-18", scope: "this_week_only" });
    expect(rescheduleDay).toHaveBeenCalledTimes(3);
    expect(rescheduleDay).toHaveBeenNthCalledWith(1, calledFor(1, 1, "2026-06-16"));
    expect(rescheduleDay).toHaveBeenNthCalledWith(2, calledFor(1, 2, "2026-06-18"));
    expect(rescheduleDay).toHaveBeenNthCalledWith(3, calledFor(1, 3, "2026-06-20"));
  });

  it("all_future_weeks shifts only the same day-slot from the target week onward", async () => {
    const a = createMemberAdapter(ref);
    await a.reschedule({ dayId: "1:2", newDate: "2026-06-18", scope: "all_future_weeks" });
    expect(rescheduleDay).toHaveBeenCalledTimes(2);
    expect(rescheduleDay).toHaveBeenNthCalledWith(1, calledFor(1, 2, "2026-06-18"));
    expect(rescheduleDay).toHaveBeenNthCalledWith(2, calledFor(2, 2, "2026-06-25"));
  });

  it("entire_schedule shifts every day by the same delta", async () => {
    const a = createMemberAdapter(ref);
    await a.reschedule({ dayId: "2:1", newDate: "2026-06-21", scope: "entire_schedule" });
    expect(rescheduleDay).toHaveBeenCalledTimes(SCHEDULE.length);
    const dates = rescheduleDay.mock.calls.map((c: any) => c[0].data.scheduledDate);
    expect(dates).toEqual([
      "2026-06-14",
      "2026-06-16",
      "2026-06-18",
      "2026-06-21",
      "2026-06-23",
      "2026-06-25",
    ]);
  });

  it("delta of 0 is a no-op (no rescheduleDay calls)", async () => {
    const a = createMemberAdapter(ref);
    await a.reschedule({ dayId: "1:1", newDate: "2026-06-15", scope: "entire_schedule" });
    expect(rescheduleDay).not.toHaveBeenCalled();
  });

  it("throws when the target day is missing from the resolved schedule", async () => {
    const a = createMemberAdapter(ref);
    await expect(
      a.reschedule({ dayId: "9:9", newDate: "2026-06-30", scope: "this_week_only" }),
    ).rejects.toThrow(/not in schedule/);
  });
});

/* ------------------------------------------------------------ logSet --- */

describe("member adapter logSet", () => {
  it("decodes the rowId index and forwards numeric payload", async () => {
    const a = createMemberAdapter(ref);
    await a.logSet({
      dayId: "2:3",
      rowId: "ex:4",
      setIndex: 1,
      reps: 8,
      loadLb: 135,
      rpe: 8,
      rir: null,
      notes: "felt strong",
    });
    expect(logSet).toHaveBeenCalledWith({
      data: {
        enrollmentId: "enr-1",
        weekIndex: 2,
        dayIndex: 3,
        exerciseIndex: 4,
        setIndex: 1,
        reps: 8,
        load_lb: 135,
        rpe: 8,
        rir: null,
        notes: "felt strong",
      },
    });
  });

  it("rejects a malformed rowId", async () => {
    const a = createMemberAdapter(ref);
    await expect(
      a.logSet({ dayId: "1:1", rowId: "row-uuid", setIndex: 0 }),
    ).rejects.toThrow(/rowId must be/);
  });
});
