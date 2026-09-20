import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/messenger-checkins.functions.ts", "utf8");

describe("messenger check-in coaching context", () => {
  it("uses the scheduled check-in period instead of a rolling seven-day completion count", () => {
    expect(source).not.toContain("completed_workouts_last_7d");
    expect(source).toContain("checkin_period_start");
    expect(source).toContain("checkin_period_end");
    expect(source).toContain("planned_workouts_this_checkin_period");
    expect(source).toContain("completed_workouts_this_checkin_period");
    expect(source).toContain("workout_adherence_this_checkin_period");
    expect(source).toContain("isoWeekMonday(periodEnd)");
  });

  it("uses canonical scheduled workouts first with a legacy program-day fallback", () => {
    expect(source).toContain('.from("pl_scheduled_workouts")');
    expect(source).toContain('scheduleSource: "canonical" | "legacy"');
    expect(source).toContain('.from("pl_days")');
    expect(source).toContain('scheduleSource = "legacy"');
  });

  it("prevents ratings and latest-vs-average weight from being misread by AI", () => {
    expect(source).toContain("A training_rating of 5 means the client rated training 5/5; it does NOT mean five workouts.");
    expect(source).toContain("bodyweight_latest versus bodyweight_7d_average is not a trend.");
    expect(source).toContain("Never infer a workout count from a 1–5 rating");
  });

  it("passes the recurring task due date into the snapshot builder", () => {
    expect(source).toContain("dueLocalDate: occurrence?.due_local_date ?? null");
    expect(source).toContain("clientTz: occurrence?.client_tz ?? null");
  });
});
