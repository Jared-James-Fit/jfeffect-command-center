import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");

const scheduleShell = read("src/components/schedule/ScheduleManagerShell.tsx");
const scheduleCalendar = read("src/components/schedule/ScheduleCalendar.tsx");
const workoutsExperience = read("src/components/workouts/WorkoutsExperience.tsx");
const moveHook = read("src/lib/use-move-workout.ts");

describe("coach calendar drag/drop boundary", () => {
  it("routes exact scheduled instances through the shared optimistic move hook", () => {
    expect(scheduleShell).toContain("const optimisticMove = useMoveWorkout(clientId);");
    expect(scheduleShell).toContain("scheduledWorkoutId: target.instanceId");
    expect(scheduleShell).toContain('newDate: format(targetDate, "yyyy-MM-dd")');
    expect(scheduleShell).not.toContain("moveScheduledWorkout(");
  });

  it("optimistically patches the client schedule cache and restores it on failure", () => {
    expect(moveHook).toContain('["client-schedule", clientId]');
    expect(moveHook).toContain("applyOptimisticScheduleInstanceMove");
    expect(moveHook).toContain("scheduleSnapshots");
    expect(moveHook).toContain("ctx?.scheduleSnapshots");
  });

  it("allows the existing client self calendar and a specific coach client calendar to drag", () => {
    expect(workoutsExperience).toContain('mode === "self" || mode === "coach"');
    expect(scheduleShell).toContain("canEdit={!locked}");
  });

  it("keeps completed workouts non-draggable and prevents a drag from opening the move sheet", () => {
    expect(scheduleCalendar).toContain("draggable={canEdit && !chip.comp?.completed_at}");
    expect(scheduleCalendar).toContain("suppressNextSelectRef.current");
  });

  it("invalidates only schedule-derived query keys after a coach move", () => {
    expect(scheduleShell).toContain("scheduleQueryKeys(clientId)");
    expect(scheduleShell).not.toContain(
      "onSuccess: () => {\n      void queryClient.invalidateQueries();",
    );
  });
});
