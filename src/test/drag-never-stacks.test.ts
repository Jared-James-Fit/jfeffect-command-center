import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { movedToLabel, workoutsAlreadyOn, type MoveTarget } from "@/lib/workout-move";
import type { WorkoutItem } from "@/lib/workout-today";

const read = (p: string) => readFileSync(p, "utf8");
const experience = read("src/components/workouts/WorkoutsExperience.tsx");
const shell = read("src/components/schedule/ScheduleManagerShell.tsx");
const hook = read("src/lib/use-move-workout.ts");

const day = (id: string, date: string, extra: Partial<WorkoutItem> = {}) =>
  ({ day: { id, scheduled_date: date }, scheduledDate: date, scheduledWorkoutId: null, ...extra }) as unknown as WorkoutItem;

// Devin's week (Nov 16–22 2026): Wednesday's pull day dragged onto Saturday,
// which already had the bench volume day.
const pull: MoveTarget = { scheduledWorkoutId: null, dayId: "pull-wed", fromDate: "2026-11-18" };

describe("a drag never stacks two workouts on a day by itself", () => {
  it("names what's already on the drop day, never the dragged workout", () => {
    const saturday = [day("bench-sat", "2026-11-21")];
    expect(workoutsAlreadyOn(saturday, pull).map((it) => it.day.id)).toEqual(["bench-sat"]);
    expect(workoutsAlreadyOn([], pull)).toEqual([]);
    expect(workoutsAlreadyOn(null, pull)).toEqual([]);
    // the dragged workout itself is never "already there"
    expect(workoutsAlreadyOn([day("pull-wed", "2026-11-18")], pull)).toEqual([]);
  });

  it("matches a scheduled instance by its own id", () => {
    const target: MoveTarget = { scheduledWorkoutId: "inst-1", dayId: "d1", fromDate: "2026-11-18" };
    const items = [
      day("d1", "2026-11-21", { scheduledWorkoutId: "inst-2" } as any),
      day("d1", "2026-11-18", { scheduledWorkoutId: "inst-1" } as any),
    ];
    expect(workoutsAlreadyOn(items, target).map((it) => it.scheduledWorkoutId)).toEqual(["inst-2"]);
  });

  it("says where it went, on that calendar day", () => {
    expect(movedToLabel("2026-11-21")).toBe("Moved to Sat, Nov 21");
    expect(movedToLabel("2026-11-18")).toBe("Moved to Wed, Nov 18");
    expect(movedToLabel("bad")).toBe("Workout moved");
  });

  it("the Workouts calendar asks before dropping onto a day with a workout", () => {
    expect(experience).toContain("workoutsAlreadyOn(byDate.get(iso), active.target)");
    expect(experience).toContain("setDropAsk({ target: active.target, iso });");
    expect(experience).toContain("initialTargetDate={dropAskDates.to}");
    // a free day still moves at once, said with Undo
    expect(experience).toContain("moveWithUndo({ target: active.target, newDate: iso });");
    expect(experience).not.toContain("moveWorkoutMutation.mutate(");
  });

  it("the Move workouts page does the same for scheduled instances", () => {
    expect(shell).toMatch(/row\.id !== target\.instanceId && String\(row\.scheduled_date/);
    expect(shell).toContain("if (instance && !completion?.completed_at && !taken) {");
    expect(shell).toContain("setMoveInitialDate(targetDate);");
  });

  it("every drag's move is said with Undo", () => {
    expect(hook).toContain("export function useMoveWithUndo(");
    expect(hook).toContain("toast.success(movedToLabel(vars.newDate)");
    expect(hook).toContain('label: "Undo"');
    expect(hook).toContain("undoFn({ data: { batchId: res.batchId } })");
  });
});
