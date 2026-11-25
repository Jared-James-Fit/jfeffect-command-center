import { describe, it, expect } from "vitest";
import { buildWeekSplit, splitLine, splitStatus } from "@/lib/workouts/week-split";
import type { WorkoutItem } from "@/lib/workout-today";

const NOW = new Date(2026, 10, 25, 11, 0); // Wed Nov 25, 11 AM
const TODAY = new Date(2026, 10, 25);
const MON = new Date(2026, 10, 23);

const item = (date: string, extra: Partial<WorkoutItem> & { title?: string } = {}): WorkoutItem => ({
  day: { id: `d-${date}`, title: extra.title ?? "Day 1", day_index: 1 },
  week: {},
  block: {},
  completion: null,
  scheduledDate: date,
  scheduledWorkoutId: `i-${date}`,
  ...extra,
} as any);

describe("week split", () => {
  it("rows Monday to Sunday: done with how long, rest days, today with a suggested time and estimate", () => {
    const done = item("2026-11-23", {
      display_title: "Deadlift & Squat",
      completion: { completed_at: "2026-11-23T19:00:00Z", has_feedback: true, logging_percentage: 100 },
    } as any);
    const today = item("2026-11-25", { display_title: "Squat & Bench" } as any);
    const byDate = new Map([["2026-11-23", [done]], ["2026-11-25", [today]]]);
    const week = buildWeekSplit({
      weekStart: MON,
      byDate,
      today: TODAY,
      now: NOW,
      durationOf: () => ({ minutes: 102, kind: "measured" }),
      predictionOf: () => ({ minutes: 95, low: 85, high: 105, basis: "personal", sessions: 5 }),
      timeOf: () => ({ kind: "suggested", startMin: 12 * 60 + 30 }),
    });
    expect(week.rows).toHaveLength(7);
    expect(week.rows[0].entries[0]).toMatchObject({ title: "Deadlift & Squat", status: "completed", done: true, line: "Completed · 1h 42m" });
    expect(week.rows[1].entries).toHaveLength(0); // rest day
    expect(week.rows[2].isToday).toBe(true);
    expect(week.rows[2].entries[0].line).toBe("Suggested 12:30 PM · Est. 1h 35m");
    expect(week).toMatchObject({ planned: 2, done: 1 });
  });

  it("never missed because a suggested time passed, only once the day is over", () => {
    const today = item("2026-11-25");
    expect(splitStatus(today, new Date(2026, 10, 25, 23, 0))).toBe("today");
    expect(splitStatus(item("2026-11-24"), NOW)).toBe("missed");
  });

  it("partial, in progress, review, rescheduled, optional skipped", () => {
    expect(splitStatus(item("2026-11-23", { completion: { completed_at: "2026-11-23T19:00:00Z", logging_percentage: 60 } } as any), NOW)).toBe("partial");
    expect(splitStatus(item("2026-11-25", { logged_sets_count: 3 }), NOW)).toBe("in_progress");
    expect(splitStatus(item("2026-11-23", { completion: { completed_at: "2026-11-23T19:00:00Z", has_feedback: false } } as any), NOW)).toBe("review");
    expect(splitStatus(item("2026-11-27", { scheduleSource: "moved" } as any), NOW)).toBe("rescheduled");
    expect(splitStatus(item("2026-11-24", { day: { id: "x", is_optional: true } } as any), NOW)).toBe("skipped");
  });

  it("never shows an estimate as how long it took; a reconstructed one is approximate", () => {
    expect(splitLine({ status: "completed", duration: { minutes: 80, kind: "estimated" } })).toBe("Completed");
    expect(splitLine({ status: "completed", duration: { minutes: 100, kind: "reconstructed" } })).toBe("Completed · ~1h 40m");
    expect(splitLine({ status: "upcoming", time: { kind: "confirmed", startMin: 18 * 60, clash: true }, prediction: { minutes: 60, low: 55, high: 65, basis: "estimate", sessions: 0 } }))
      .toBe("6:00 PM · Clashes · Est. 1h");
    expect(splitLine({ status: "today", time: { kind: "none" } })).toBe("No open time");
    expect(splitLine({ status: "in_progress", progress: { done: 8, total: 18 } })).toBe("In progress · 8 of 18 sets");
  });
});
