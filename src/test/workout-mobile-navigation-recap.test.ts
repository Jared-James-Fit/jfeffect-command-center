import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dayView = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
const recap = readFileSync("src/components/workout-submission-summary.tsx", "utf8");

describe("workout mobile navigation and recap UX", () => {
  it("uses the current PageHeader back control instead of the legacy floating back pill", () => {
    expect(dayView).toContain("backTo={navigation.backTo}");
    expect(dayView).toContain('backLabel="Workouts"');
    expect(dayView).not.toContain("pointer-events-none fixed inset-x-0");
    // the legacy pill floated a fixed distance above the tab bar; the page's own bottom
    // padding clearing the tab bar (--bottom-nav-clearance, AGENTS.md's tab-bar rule) is not it
    expect(dayView).not.toMatch(/bottom: "calc\(var\(--bottom-nav-clearance/);
    expect(dayView).not.toContain('aria-label="Back to workouts"');
    expect(dayView).not.toContain("onClick={() => navigate({ to: navigation.backTo })}");
  });

  it("keeps completed detail state completed even when logging metadata is partial", () => {
    // One finished-workout card (status, review, View score) at the top of the log.
    const finished = readFileSync("src/components/workout/shared/completed-workout-actions.tsx", "utf8");
    expect(finished).toContain('{hasReview ? "Completed" : "Completed · review pending"}');
    expect(finished).not.toContain('? "Incomplete"');
    expect(dayView).not.toContain('? "Incomplete"');
  });

  it("keeps the workout recap compact and scannable on mobile", () => {
    // one bounded sheet (the redesign of Sep 25-27 2026 replaced the 88svh card)
    expect(recap).toContain('style={{ height: "min(96dvh, 820px)", maxHeight: "96dvh" }}');
    // the score up top, then one two-column grid of the stats that have data
    expect(recap).toContain('<span className="text-5xl font-bold leading-none text-primary">{displayScore}</span>');
    expect(recap).toMatch(/data-score-help>\s*Workout score\s/);
    expect(recap).toContain('<div className="grid grid-cols-2 divide-x divide-y divide-border/70">');
    expect(recap).toContain('label="Sets"');
    expect(recap).toContain('label="Duration"');
    expect(recap).toContain('label="Avg RPE"');
    expect(recap).toContain("<TonnageStat records={records} unit={displayUnit} />");
    // one score on the recap: no second recovery estimate beside it (Nov 14 2026, AGENTS.md)
    expect(recap).not.toContain('label="Est. recovery"');
    expect(recap).not.toContain('label="Recovery"');
    expect(recap).toContain("Back to workout");
  });
});
