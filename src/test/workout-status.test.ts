import { describe, expect, it } from "vitest";
import { getWorkoutStatus } from "@/lib/workout-status";

const TODAY = new Date("2026-08-17T12:00:00Z");

function item(overrides: Record<string, unknown> = {}) {
  return {
    day: { id: "day-1", scheduled_date: "2026-08-17" },
    scheduledDate: "2026-08-17",
    scheduledWorkoutId: "instance-1",
    completion: null,
    logged_sets_count: 0,
    ...overrides,
  } as any;
}

describe("workout lifecycle status", () => {
  it("keeps a legitimately started draft resumable without marking it complete", () => {
    const status = getWorkoutStatus(
      item({
        completion: {
          id: "draft-1",
          started_at: "2026-08-17T12:00:00Z",
          in_progress_at: "2026-08-17T12:00:00Z",
          completed_at: null,
        },
      }),
      TODAY,
    );

    expect(status.status).toBe("in_progress");
    expect(status.label).toBe("In Progress");
  });

  it("does not treat an empty completion row as an in-progress workout", () => {
    const status = getWorkoutStatus(
      item({
        completion: {
          id: "empty-draft-1",
          started_at: null,
          in_progress_at: null,
          completed_at: null,
        },
        logged_sets_count: 0,
      }),
      TODAY,
    );

    expect(status.status).toBe("today");
    expect(status.label).toBe("Today");
  });

  it("shows In Progress after meaningful logged activity without completing the workout", () => {
    const status = getWorkoutStatus(
      item({
        completion: { id: "draft-1", completed_at: null },
        logged_sets_count: 1,
      }),
      TODAY,
    );

    expect(status.status).toBe("in_progress");
    expect(status.label).toBe("In Progress");
  });

  it("shows Completed only when an explicit completed_at timestamp exists", () => {
    const status = getWorkoutStatus(
      item({
        completion: { id: "finished-1", completed_at: "2026-08-17T12:15:00Z" },
        logged_sets_count: 0,
      }),
      TODAY,
    );

    expect(status.status).toBe("completed_today");
  });
});
