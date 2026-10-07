import { describe, expect, it } from "vitest";
import { summarizeTrainingTimes, formatClock, bucketFor } from "@/lib/nutrition-targets/training-pattern";
import { classifyTrainingTime, effectiveTrainingTime, mealPlanUserPrompt } from "@/lib/nutrition-ai-prompts";

const TZ = "America/Winnipeg"; // CDT = UTC-5 in Sept/Oct
// Weekday sessions starting 5:05pm–6:50pm local, like a real evening lifter.
const EVENING = [
  "2026-09-21T22:19:00Z", "2026-09-22T22:15:00Z", "2026-09-24T23:09:00Z", "2026-09-25T22:05:00Z",
  "2026-09-28T23:04:00Z", "2026-09-29T23:33:00Z", "2026-10-01T22:28:00Z", "2026-10-02T23:15:00Z",
];

describe("summarizeTrainingTimes", () => {
  it("finds a consistent evening lifter in their own time zone", () => {
    const p = summarizeTrainingTimes(EVENING, TZ)!;
    expect(p.sessions).toBe(8);
    expect(p.bucket).toBe("evening");
    expect(p.label).toBe("Evening (5–8pm)");
    expect(p.confident).toBe(true);
    expect(p.summary).toContain("usually starts around");
  });

  it("counts one session per local day (double-completions don't skew it)", () => {
    // 6pm and 9pm on the same local day (the 9pm one is the next UTC day).
    const p = summarizeTrainingTimes(["2026-09-16T23:00:00Z", "2026-09-17T02:00:00Z"], TZ)!;
    expect(p.sessions).toBe(1);
    expect(p.typicalStart).toBe("6:00pm");
  });

  it("is not confident with too few or scattered sessions", () => {
    expect(summarizeTrainingTimes(["2026-10-05T22:31:00Z"], TZ)!.confident).toBe(false);
    const scattered = ["2026-09-14T12:00:00Z", "2026-09-15T17:00:00Z", "2026-09-16T23:00:00Z", "2026-09-18T15:00:00Z", "2026-09-19T20:00:00Z"];
    expect(summarizeTrainingTimes(scattered, TZ)!.confident).toBe(false);
    expect(summarizeTrainingTimes([], TZ)).toBeNull();
  });

  it("flags weekends that start far from weekdays", () => {
    const p = summarizeTrainingTimes([
      "2026-09-14T23:00:00Z", "2026-09-15T23:10:00Z", "2026-09-16T23:05:00Z", "2026-09-17T23:00:00Z",
      "2026-09-19T14:00:00Z", "2026-09-20T14:30:00Z",
    ], TZ)!;
    expect(p.weekend?.label).toBe("Morning (8–11am)");
    expect(p.summary).toContain("Weekends usually around");
  });

  it("formats and buckets clock times", () => {
    expect(formatClock(0)).toBe("12:00am");
    expect(formatClock(18 * 60 + 3)).toBe("6:03pm");
    expect(bucketFor(7 * 60 + 59)).toBe("early");
    expect(bucketFor(20 * 60)).toBe("night");
  });
});

describe("logged workouts in the meal-plan prompt", () => {
  const history = summarizeTrainingTimes(EVENING, TZ)!;
  const ask = (value: string) => [{ label: "What time do you usually train?", value }];

  it("fills in for 'It varies' / blank answers", () => {
    expect(effectiveTrainingTime("It varies", history)).toEqual({ time: "Evening (5–8pm)", fromHistory: true });
    expect(effectiveTrainingTime("", history).fromHistory).toBe(true);
    const p = mealPlanUserPrompt(ask("It varies"), "T", null, null, history);
    expect(p).toContain("Logged workouts (last 8 weeks)");
    expect(p).toContain("TRAINING TIME RULE: Trains in the evening");
    expect(p).toContain("Based on their logged workout times");
  });

  it("keeps a specific form answer and flags a mismatch", () => {
    const p = mealPlanUserPrompt(ask("Morning (8–11am)"), "T", null, null, history);
    expect(p).toContain("TRAINING TIME RULE: Trains in the morning");
    expect(p).toContain("the form answer is newer, so follow the form");
    expect(mealPlanUserPrompt(ask("Evening (5–8pm)"), "T", null, null, history)).not.toContain("form answer is newer");
  });

  it("ignores an unconfident pattern", () => {
    const thin = summarizeTrainingTimes(["2026-10-05T22:31:00Z"], TZ)!;
    expect(effectiveTrainingTime("It varies", thin).fromHistory).toBe(false);
  });

  it("every form option classifies to its own bucket", () => {
    expect(
      ["Early morning (before 8am)", "Morning (8–11am)", "Midday (11am–2pm)", "Afternoon (2–5pm)", "Evening (5–8pm)", "Night (after 8pm)", "It varies", ""].map(classifyTrainingTime),
    ).toEqual(["early", "morning", "midday", "afternoon", "evening", "night", "varies", "none"]);
  });
});
