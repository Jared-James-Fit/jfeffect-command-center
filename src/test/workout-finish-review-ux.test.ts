import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
const review = readFileSync("src/components/workout/shared/workout-review-editor.tsx", "utf8");
const workouts = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
const listCard = readFileSync("src/components/workout-list-card.tsx", "utf8");
const completionFns = readFileSync("src/lib/workout-completion.functions.ts", "utf8");

describe("workout finish review UX", () => {
  it("uses the quick review as the final action for a fully logged workout", () => {
    expect(logger).toContain("Review to Finish");
    expect(logger).toContain("setQuickFinishReviewOpen(true)");
    expect(logger).toContain('handleFinishWorkout("automatic", false)');
    expect(logger).toContain("The workout remains amber/in-progress until that review");
  });

  it("waits for parent finalization before claiming the workout is complete", () => {
    expect(review).toContain("await onSaved?.()");
    expect(review).toContain('toast.success(res?.edited ? "Review updated." : "Workout complete.")');
  });

  it("surfaces 100%-logged but unreviewed workouts as amber review-to-finish", () => {
    expect(workouts).toContain('label: "Review to finish"');
    expect(workouts).toContain('label: "Finish Review"');
    expect(listCard).toContain('label: "Review to finish"');
    expect(listCard).toContain("Finish review");
  });

  it("creates a completion shell when review is the final tap", () => {
    expect(completionFns).toContain('completion_source: "review_to_finish"');
    expect(completionFns).toContain('writer.from("pl_day_completions").select("id")');
    expect(completionFns).toContain('Could not prepare workout completion for review');
  });
});
