import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const timer = readFileSync("src/components/workout-day/WorkoutTimer.tsx", "utf8");
const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
const completion = readFileSync("src/lib/workout-completion.functions.ts", "utf8");

describe("workout timer lifecycle", () => {
  it("uses a sessionStorage runtime id so app switching does not look like a close", () => {
    expect(timer).toContain('const RUNTIME_KEY = "workout-runtime-id"');
    expect(timer).toContain("window.sessionStorage.getItem(RUNTIME_KEY)");
    expect(timer).toContain("s.runtimeId !== currentRuntime");
    expect(timer).toContain("App switching/backgrounding does NOT change runtimeId");
  });

  it("freezes an old runtime at its last known alive instant after a true relaunch", () => {
    expect(timer).toContain("lastSeenAt");
    expect(timer).toContain("stoppedAt");
    expect(timer).toContain("carriedMs");
    expect(timer).toContain("Freeze the old segment at its last known alive instant");
  });

  it("resumes the same unfinished workout without counting closed-app time", () => {
    expect(timer).toContain("if (existing.stoppedAt != null)");
    expect(timer).toContain("carriedMs: Math.max(0, Number(existing.carriedMs) || 0)");
    expect(timer).toContain("stoppedAt: null");
  });

  it("keeps the runtime alive across visibility/focus/pagehide events", () => {
    expect(logger).toContain("touchWorkoutSession(dayId)");
    expect(logger).toContain('window.addEventListener("pagehide", touch)');
    expect(logger).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(logger).toContain("5_000");
  });

  it("shows a live workout clock in the normal logger and fullscreen status bar", () => {
    expect(logger).toContain("Workout time");
    expect(logger).toContain("<WorkoutTimer");
    expect(logger).toContain("sessionTimer={");
  });

  it("persists the exact local wall-clock seconds instead of relying on server started_at", () => {
    expect(logger).toContain("sessionDurationSeconds(dayId)");
    expect(logger).toContain("sessionElapsedSeconds: sessionSeconds");
    expect(completion).toContain("sessionElapsedSeconds: z.number().int().nonnegative()");
    expect(completion).toContain("? data.sessionElapsedSeconds");
  });
});
