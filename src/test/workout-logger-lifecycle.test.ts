import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loggerSource = () =>
  readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

describe("workout logger lifecycle", () => {
  it("does not start a workout from a mount effect", () => {
    const source = loggerSource();

    expect(source).toContain("Opening or previewing a workout is read-only.");
    expect(source).not.toContain("Auto-track: started_at on first mount");
    expect(source).not.toContain("const startedRef = useRef(false);");
  });

  it("starts lifecycle state only from meaningful action or explicit finish", () => {
    const source = loggerSource();
    const startCalls = source.match(/await startWorkoutSrv\(\{ data: startData/g) ?? [];

    // One call is markInProgress() after actual logging; the other guarantees
    // a completion row immediately before the explicit Finish Workout action.
    expect(startCalls).toHaveLength(2);
    expect(source).toContain("const markInProgress = async () => {");
    expect(source).toContain("beginSessionOnAction();\n    markInProgress();");
    expect(source).toContain('completionMethod: "manual" | "automatic" = "manual"');
  });

  it("keeps the final completion write inside the shared finish handler", () => {
    const source = loggerSource();

    expect(source).toContain("await completeWorkoutSrv({");
    expect(source).toContain('completionMethod: "manual" | "automatic" = "manual"');
    expect(source).toContain("completed_at: nowIso,");
  });

  it("opens the quick review before final completion once every prescribed set is confirmed", () => {
    const source = loggerSource();

    expect(source).toContain("const autoFinishReady = useMemo(() => {");
    expect(source).toContain("summary.requiredSets > 0 && summary.loggedSets >= summary.requiredSets");
    expect(source).toContain("setQuickFinishReviewOpen(true)");
    expect(source).toContain('handleFinishWorkout("automatic", false)');
    expect(source).not.toContain('void handleFinishWorkout("automatic")');
  });

  it("does not auto-finish previews, coach POV, errored, or offline workouts", () => {
    const source = loggerSource();

    expect(source).toContain("readonly ||");
    expect(source).toContain("isImpersonating ||");
    expect(source).toContain("workoutBodyError ||");
    expect(source).toContain('navigator.onLine === false');
  });
});
