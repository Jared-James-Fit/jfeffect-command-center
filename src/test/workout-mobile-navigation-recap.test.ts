import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dayView = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
const recap = readFileSync("src/components/workout-submission-summary.tsx", "utf8");

describe("workout mobile navigation and recap UX", () => {
  it("keeps a mobile back-to-workouts control reachable while scrolling", () => {
    expect(dayView).toContain("Back to workouts");
    expect(dayView).toContain("bottom-nav-clearance");
    expect(dayView).toContain("pointer-events-none fixed inset-x-0");
    expect(dayView).toContain("navigate({ to: navigation.backTo })");
  });

  it("keeps completed detail state completed even when logging metadata is partial", () => {
    expect(dayView).toContain('{reviewSubmitted ? "Completed" : "Completed · Review pending"}');
    expect(dayView).not.toContain('? "Incomplete"');
  });

  it("keeps the workout recap compact and scannable on mobile", () => {
    expect(recap).toContain("max-h-[88svh]");
    expect(recap).toContain("grid grid-cols-2 gap-2");
    expect(recap).toContain('label="Workout score"');
    expect(recap).toContain('label="Est. recovery"');
    expect(recap).toContain('label="Volume"');
    expect(recap).toContain('label="Duration"');
    expect(recap).toContain("Back to workout");
  });
});
