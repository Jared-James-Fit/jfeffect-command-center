import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const timer = readFileSync("src/components/workout-day/WorkoutTimer.tsx", "utf8");
const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
const completion = readFileSync("src/lib/workout-completion.functions.ts", "utf8");

describe("workout timer lifecycle", () => {
  it("uses an in-memory runtime id instead of sessionStorage for true relaunch detection", () => {
    expect(timer).toContain("const PAGE_RUNTIME_ID");
    expect(timer).not.toContain("window.sessionStorage");
    expect(timer).toContain("session.runtimeId === PAGE_RUNTIME_ID");
    expect(timer).toContain("some mobile browsers restore sessionStorage");
  });

  it("treats backgrounding as a candidate close, not an actual stop", () => {
    expect(timer).toContain("backgroundedAt");
    expect(timer).toContain("markWorkoutSessionBackgrounded");
    expect(timer).toContain("markWorkoutSessionForegrounded");
    expect(timer).toContain("the entire background gap counts");
  });

  it("freezes only when a new runtime proves the previous runtime ended", () => {
    expect(timer).toContain("A new JS runtime proves the previous app/page runtime ended");
    expect(timer).toContain("session.backgroundedAt");
    expect(timer).toContain("stoppedAt: cutoff");
    expect(timer).toContain("carriedMs");
  });

  it("resumes the same unfinished workout without counting closed-app time", () => {
    expect(timer).toContain("if (existing.stoppedAt != null)");
    expect(timer).toContain("carriedMs: Math.max(0, existing.carriedMs || 0)");
    expect(timer).toContain("stoppedAt: null");
  });

  it("owns lifecycle globally so navigation away from the workout keeps timing", () => {
    expect(appShell).toContain("markActiveWorkoutSessionBackgrounded");
    expect(appShell).toContain("markActiveWorkoutSessionForegrounded");
    expect(appShell).toContain('window.addEventListener("pagehide", background)');
    expect(appShell).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(appShell).toContain("Capacitor.isNativePlatform()");
    expect(appShell).toContain('App.addListener("appStateChange"');
  });

  it("does not expose a manual pause control on the workout wall-clock", () => {
    expect(timer).not.toContain("Pause workout session");
    expect(timer).not.toContain("Resume workout session");
  });

  it("shows a live workout clock in the normal logger and fullscreen status bar", () => {
    expect(logger).toContain("Workout time");
    expect(logger).toContain("<WorkoutTimer");
    expect(logger).toContain("sessionTimer={");
  });

  it("persists exact local wall-clock seconds instead of relying on server started_at", () => {
    expect(logger).toContain("sessionDurationSeconds(dayId)");
    expect(logger).toContain("sessionElapsedSeconds: sessionSeconds");
    expect(completion).toContain("sessionElapsedSeconds: z.number().int().nonnegative()");
    expect(completion).toContain("? data.sessionElapsedSeconds");
  });
});
