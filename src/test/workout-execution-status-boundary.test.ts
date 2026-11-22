import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const executionViewSource = readFileSync(
  resolve(process.cwd(), "src/components/workout-day/WorkoutDayView.tsx"),
  "utf8",
);
const recoverySheetSource = readFileSync(
  resolve(process.cwd(), "src/components/workout-status-sheet.tsx"),
  "utf8",
);

describe("workout execution status boundary", () => {
  it("keeps the normal execution view free of the manual Client POV status override", () => {
    expect(executionViewSource).not.toContain("Set workout status");
    expect(executionViewSource).not.toContain(
      "Changes the client's progress for this workout. Visible only to admins/coaches in POV mode.",
    );
  });

  it("preserves the separate recovery status-management sheet outside workout execution", () => {
    expect(recoverySheetSource).toContain("Set Workout Status");
    expect(recoverySheetSource).toContain('side="bottom"');
  });

  it("keeps the normal finish-workout completion path in the execution view", () => {
    // Finish Workout is still the one shared handler; it also serves the automatic
    // finish, so it takes how it was finished (manual by default) and whether to
    // open the review after
    expect(executionViewSource).toMatch(
      /async function handleFinishWorkout\(\s*completionMethod: "manual" \| "automatic" = "manual",\s*openReviewAfterFinish = true,\s*\): Promise<boolean> \{/,
    );
    expect(executionViewSource).toContain("await completeWorkoutSrv({");
    expect(executionViewSource).toContain("await handleFinishWorkout();");
  });
});
