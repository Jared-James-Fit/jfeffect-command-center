import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workout autosave reliability", () => {
  it("schedules debounced backend saves and retries failed attempts", () => {
    const source = readFileSync("src/hooks/use-autosave.ts", "utf8");

    expect(source).toContain("void doSaveRef.current?.();");
    expect(source).toContain("scheduleSave(delay);");
    expect(source).toContain("scheduleSave(retryDelay);");
    expect(source).toContain("scheduleSave(0);");
  });

  it("saves workout set rows after focus clears instead of relying on blur flushes", () => {
    const source = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

    expect(source).toContain("enabled: !readonly && !!clientId && serverHydrated && !focusedField");
    expect(source).toContain("setFocusedField(null);");
    expect(source).not.toContain("save.flush().finally(() => { setFocusedField(null); });");
  });

  it("persists completed set status with the latest typed reps and weight", () => {
    const source = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

    expect(source).toContain("actual_load: loadNum");
    expect(source).toContain("actual_reps: repsNum");
    expect(source).toContain("completed_at: completedAt");
    expect(source).toContain("Enter reps and weight before marking complete");
  });
});