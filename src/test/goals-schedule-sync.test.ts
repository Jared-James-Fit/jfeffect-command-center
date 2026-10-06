import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDITABLE_GOALS_FIELDS, goalsScheduleFromCommitted } from "@/lib/client-goals/schema";

const read = (path: string) => readFileSync(path, "utf8");

describe("goalsScheduleFromCommitted", () => {
  it("copies the committed days into the goals answers, in week order", () => {
    expect(
      goalsScheduleFromCommitted({
        committed_training_frequency: 4,
        committed_training_days: ["Friday", "Monday", "Thursday", "Tuesday"],
      }),
    ).toEqual({ training_days_per_week: 4, available_weekdays: ["mon", "tue", "thu", "fri"] });
  });

  it("is null until the client has a committed schedule", () => {
    expect(goalsScheduleFromCommitted(null)).toBeNull();
    expect(goalsScheduleFromCommitted({ committed_training_frequency: null, committed_training_days: [] })).toBeNull();
  });

  it("ignores anything that isn't a weekday", () => {
    expect(
      goalsScheduleFromCommitted({ committed_training_frequency: 2, committed_training_days: ["Saturday", "Someday", "Sunday"] }),
    ).toEqual({ training_days_per_week: 2, available_weekdays: ["sat", "sun"] });
  });
});

describe("one home for training days", () => {
  it("never lets the Goals form write the schedule answers itself", () => {
    expect(EDITABLE_GOALS_FIELDS).not.toContain("training_days_per_week");
    expect(EDITABLE_GOALS_FIELDS).not.toContain("available_weekdays");
  });

  it("asks the training days in onboarding through the committed schedule", () => {
    const flow = read("src/components/client-goals/GoalsSetupFlow.tsx");
    const step = flow.slice(flow.indexOf("function AvailabilityStep"));
    expect(step.slice(0, step.indexOf("/* ---------- Step 3"))).toContain("<TrainingScheduleCard");
  });

  it("syncs the goals answers whenever either side is saved", () => {
    const schedule = read("src/lib/schedule-bulk.functions.ts");
    const save = schedule.slice(schedule.indexOf("export const saveCommittedSchedule"));
    expect(save).toContain("goalsScheduleFromCommitted(");
    expect(save).toMatch(/from\("client_goals_setup"\)\s*\.update\(goalsSchedule\)/);

    const goals = read("src/lib/client-goals/goals.functions.ts");
    expect(goals.slice(goals.indexOf("export const saveGoalsSetupFn"))).toContain("goalsScheduleFromCommitted(committed)");
  });
});
