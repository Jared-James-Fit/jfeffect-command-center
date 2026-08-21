/**
 * Regression cover for the calendar reschedule QA matrix (items A–S).
 *
 * Pure move semantics live in workout-move-dnd.test.ts; this file locks the
 * surface wiring: which calendars can drag, that touch sensors are enabled,
 * that a drag never opens the card, and that nothing broad is invalidated.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyOptimisticMove,
  applyOptimisticScheduleInstanceMove,
  canDragRescheduleItem,
  moveTargetFromItem,
  reconcileMovedDate,
  scheduleQueryKeys,
} from "@/lib/workout-move";
import type { WorkoutItem } from "@/lib/workout-today";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const experience = read("src/components/workouts/WorkoutsExperience.tsx");
const cellDnd = read("src/components/workouts/calendar-day-dnd.tsx");
const scheduleCalendar = read("src/components/schedule/ScheduleCalendar.tsx");
const scheduleShell = read("src/components/schedule/ScheduleManagerShell.tsx");
const moveSheet = read("src/components/schedule/MoveWorkoutSheet.tsx");
const moveHook = read("src/lib/use-move-workout.ts");

function item(over: Partial<WorkoutItem> & { id: string; date: string }): WorkoutItem {
  return {
    day: { id: `day-${over.id}`, day_index: 1, title: `W ${over.id}`, scheduled_date: over.date },
    week: { id: "w1", week_index: 1 },
    block: { id: "b1", status: "Active" },
    completion: null,
    scheduledWorkoutId: `inst-${over.id}`,
    scheduledDate: over.date,
    ...over,
  } as WorkoutItem;
}

describe("calendar reschedule surfaces", () => {
  it("A+B: coach week and month views share one dnd provider and cell", () => {
    expect(experience).toContain("<CalendarDndProvider dnd={dnd}>");
    // Both WeekStrip and MonthGrid cells go through the shared cell wrapper.
    expect(experience.match(/<CalendarDayCell /g)?.length).toBe(2);
  });

  it("C+D: the same component serves the client self portal calendar", () => {
    expect(experience).toContain('mode === "self" || mode === "coach"');
    expect(experience).toContain("const moveWorkoutMutation = useMoveWorkout(clientId);");
  });

  it("E: touch sensors are enabled for iPhone/iPad on both calendar stacks", () => {
    expect(cellDnd).toContain("TouchSensor");
    expect(cellDnd).toContain("PointerSensor");
    expect(cellDnd).toContain("CALENDAR_TOUCH_ACTIVATION");
    // press-and-hold so vertical scrolling still works
    expect(cellDnd).toMatch(/delay:\s*\d+/);
    expect(cellDnd).not.toContain("onDragStart: (e: React.DragEvent)");
    expect(scheduleCalendar).toContain("useSensor(TouchSensor");
  });

  it("F: completed workouts cannot be dragged in either coach or client view", () => {
    const done = item({ id: "d", date: "2026-08-20", completion: { completed_at: "x" } } as any);
    expect(canDragRescheduleItem(done)).toBe(false);
    expect(scheduleCalendar).toContain("draggable={canEdit && !chip.comp?.completed_at}");
    expect(cellDnd).toContain("dnd.canDragItem(item)");
  });

  it("G: a finished drag never also clicks/opens the card", () => {
    expect(cellDnd).toContain("onClickCapture");
    expect(cellDnd).toContain("suppressClickRef");
    expect(scheduleCalendar).toContain("suppressNextSelectRef.current");
  });

  it("H+I+J: instance id, source day and original date survive a move", () => {
    const A = item({ id: "a", date: "2026-08-24" });
    const moved = applyOptimisticMove([A], moveTargetFromItem(A, "2026-08-24")!, "2026-08-27")[0];
    expect(moved.scheduledWorkoutId).toBe("inst-a");
    expect(moved.day).toBe(A.day);

    const cache = applyOptimisticScheduleInstanceMove(
      { scheduledInstances: [{ id: "inst-a", source_day_id: "day-a", scheduled_date: "2026-08-24", original_date: "2026-08-24" }] },
      "inst-a",
      "2026-08-27",
    )!;
    expect(cache.scheduledInstances![0].source_day_id).toBe("day-a");
    expect(cache.scheduledInstances![0].original_date).toBe("2026-08-24");
  });

  it("K+L: logs untouched and a destination that already has a workout keeps both", () => {
    const A = item({ id: "a", date: "2026-08-24", logged_sets_count: 9 } as any);
    const B = item({ id: "b", date: "2026-08-26" });
    const next = applyOptimisticMove([A, B], moveTargetFromItem(A, "2026-08-24")!, "2026-08-26");
    expect(next.length).toBe(2);
    expect(next.find((i) => i.scheduledWorkoutId === "inst-b")).toBe(B);
    expect((next[0] as any).logged_sets_count).toBe(9);
  });

  it("M+N: optimistic patch on mutate, snapshot rollback on failure", () => {
    expect(moveHook).toContain("onMutate:");
    expect(moveHook).toContain("applyOptimisticMove");
    expect(moveHook).toContain("onError:");
    expect(moveHook).toContain("qc.setQueryData(key, data)");
  });

  it("O+P: a stale echo of the old date does not flash back; server truth wins after", () => {
    expect(reconcileMovedDate("2026-08-24", "2026-08-27", true)).toBe("2026-08-27");
    expect(reconcileMovedDate("2026-08-27", "2026-08-27", true)).toBe("2026-08-27");
    expect(reconcileMovedDate("2026-08-24", null, false)).toBe("2026-08-24");
  });

  it("Q: the reschedule sheet renders before move context resolves", () => {
    expect(moveSheet).toContain("enabled: !!dayId && open");
    expect(moveSheet).toContain("staleTime: 60_000");
    expect(moveSheet).not.toMatch(/if \(ctxQuery\.isLoading\) return null/);
  });

  it("R: schedule-only invalidation everywhere in the reschedule path", () => {
    expect(moveHook).toContain("scheduleQueryKeys(clientId)");
    expect(moveHook).not.toContain("qc.invalidateQueries()");
    expect(moveSheet).not.toContain("queryClient.invalidateQueries();");
    expect(moveSheet).toContain("invalidateScheduleOnly");
    expect(scheduleShell).toContain("scheduleQueryKeys(clientId)");
    const keys = scheduleQueryKeys("c1").map((k) => String(k[0]));
    expect(keys.some((k) => k.includes("analytics") || k.includes("exercise"))).toBe(false);
  });

  it("S: no lifecycle mutation is triggered by opening, selecting or dragging", () => {
    expect(cellDnd).not.toMatch(/startWorkout|completeWorkout|in_progress_at/);
    expect(moveHook).not.toMatch(/completed_at|started_at/);
  });
});
