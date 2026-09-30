import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dayView = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
const recap = readFileSync("src/components/workout-submission-summary.tsx", "utf8");

describe("workout mobile navigation and recap UX", () => {
  it("uses the current PageHeader back control instead of the legacy floating back pill", () => {
    expect(dayView).toContain("backTo={navigation.backTo}");
    expect(dayView).toContain('backLabel="Workouts"');
    expect(dayView).not.toContain("pointer-events-none fixed inset-x-0");
    expect(dayView).not.toContain("bottom-nav-clearance");
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
