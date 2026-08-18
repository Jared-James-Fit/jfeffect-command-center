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
  it("keeps an opened or started draft out of Completed until completed_at is explicit", () => {
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

    expect(status.status).toBe("today");
    expect(status.label).not.toMatch(/completed/i);
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
