import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
const picker = readFileSync("src/components/workout-day/workout-add-exercise.tsx", "utf8");
const actions = readFileSync("src/lib/quick-swap.functions.ts", "utf8");

describe("live workout structure editing", () => {
  it("lets a coaching client add an exercise from the logger", () => {
    expect(logger).toContain("<WorkoutAddExercise");
    expect(logger).toContain("addExerciseToWorkout");
    expect(logger).toContain("rowIndex + 1");
    expect(logger).toContain("ordered.splice(target, 0, created.rowId)");
    expect(logger).toContain("subtle");
    expect(picker).toContain("Search exercises…");
    expect(picker).toContain("Add it here without leaving the workout.");
    expect(actions).toContain("export const addExerciseToWorkout");
  });

  it("lets exercises move up or down without leaving the workout", () => {
    expect(logger).toContain("Move exercise up");
    expect(logger).toContain("Move exercise down");
    expect(logger).toContain("reorderWorkoutExercises");
    expect(logger).toContain("moveExerciseTo");
    expect(logger).toContain("Move to position");
    expect(actions).toContain("orderedRowIds");
  });

  it("does not mutate membership snapshot structure through client-plan actions", () => {
    expect(logger).toContain('adapter?.kind !== "member"');
  });
  it("keeps exercise insertion subtle and collapses secondary card actions", () => {
    expect(picker).toContain('aria-label="Add exercise here"');
    expect(picker).not.toContain('>\n            Add\n');
    expect(logger).toContain("More options for");
    expect(logger).toContain("<MoreHorizontal");
    expect(logger).toContain("<DropdownMenuSeparator");
    expect(logger).toContain("Move to position");
    expect(logger).not.toContain('title="Change exercise order"');
  });

});
