import { describe, expect, it } from "vitest";
import {
  normalizeCommittedDays,
  planCommittedRealign,
  todayInTimeZone,
  type RealignDay,
  type RealignInstance,
} from "@/lib/committed-schedule-realign";

// 2026-10-05 is a Monday.
const block = { id: "b1", start_date: "2026-10-05", week_duration_days: 7 };
const week = (n: number, id = `w${n}`) => ({ id, week_index: n, block_id: "b1" });
const day = (id: string, weekId: string, idx: number, date: string | null, extra: Partial<RealignDay> = {}): RealignDay => ({
  id, week_id: weekId, day_index: idx, scheduled_date: date,
  schedule_source: "auto", schedule_locked: false, ...extra,
});

const base = {
  blocks: [block],
  weeks: [week(1), week(2)],
  instances: [] as RealignInstance[],
  touchedDayIds: new Set<string>(),
  todayISO: "2026-10-05",
  role: "client" as const,
  includePinned: true,
};

describe("planCommittedRealign", () => {
  it("moves future workouts onto the new committed weekdays in day order", () => {
    // Was Mon/Wed/Fri, client now trains Tue/Thu/Sat.
    const days = [
      day("d1", "w1", 1, "2026-10-05"), day("d2", "w1", 2, "2026-10-07"), day("d3", "w1", 3, "2026-10-09"),
      day("d4", "w2", 1, "2026-10-12"), day("d5", "w2", 2, "2026-10-14"), day("d6", "w2", 3, "2026-10-16"),
    ];
    const plan = planCommittedRealign({ ...base, days, committed: ["Tuesday", "Thursday", "Saturday"] });
    expect(plan.moves.map((m) => [m.dayId, m.next])).toEqual([
      ["d1", "2026-10-06"], ["d2", "2026-10-08"], ["d3", "2026-10-10"],
      ["d4", "2026-10-13"], ["d5", "2026-10-15"], ["d6", "2026-10-17"],
    ]);
    expect(plan.unplaced).toBe(0);
  });

  it("is idempotent: already-aligned workouts produce no moves", () => {
    const days = [
      day("d1", "w1", 1, "2026-10-06"), day("d2", "w1", 2, "2026-10-08"), day("d3", "w1", 3, "2026-10-10"),
    ];
    const plan = planCommittedRealign({ ...base, days, committed: ["Tuesday", "Thursday", "Saturday"] });
    expect(plan.moves).toEqual([]);
  });

  it("never moves past, started or completed workouts, and keeps their slot", () => {
    const days = [
      day("d1", "w1", 1, "2026-10-05"), // past (today is Wed)
      day("d2", "w1", 2, "2026-10-07"), // completed
      day("d3", "w1", 3, "2026-10-09"), // future, movable
    ];
    const plan = planCommittedRealign({
      ...base, days, todayISO: "2026-10-07",
      touchedDayIds: new Set(["d2"]), committed: ["Tuesday", "Thursday", "Saturday"],
    });
    // d1/d2 consume Tue + Thu; d3 takes the remaining slot (Saturday).
    expect(plan.moves.map((m) => [m.dayId, m.next])).toEqual([["d3", "2026-10-10"]]);
  });

  it("never schedules a workout before today", () => {
    const days = [day("d1", "w1", 1, "2026-10-12")];
    const plan = planCommittedRealign({
      ...base, days, weeks: [week(1)], todayISO: "2026-10-08", committed: ["Monday", "Tuesday"],
    });
    // This week's Mon/Tue are already past → week 1 can't take it, nothing is moved backwards.
    expect(plan.moves.every((m) => m.next >= "2026-10-08")).toBe(true);
  });

  it("uses the scheduled-workout instance date, not a stale pl_days date", () => {
    const days = [day("d1", "w1", 1, "2026-10-06")]; // stale mirror already on Tue
    const plan = planCommittedRealign({
      ...base, days, weeks: [week(1)],
      instances: [{ id: "i1", source_day_id: "d1", scheduled_date: "2026-10-09", schedule_source: "program" }],
      committed: ["Tuesday"],
    });
    expect(plan.moves).toEqual([
      { dayId: "d1", prev: "2026-10-09", next: "2026-10-06", prevSource: "program", wasPinned: false },
    ]);
  });

  it("protects coach-locked workouts from clients but not from coaches", () => {
    const days = [day("d1", "w1", 1, "2026-10-09", { schedule_locked: true })];
    const asClient = planCommittedRealign({ ...base, days, weeks: [week(1)], committed: ["Tuesday"] });
    expect(asClient.moves).toEqual([]);
    expect(asClient.pendingPinned).toBe(1);
    const asCoach = planCommittedRealign({ ...base, days, weeks: [week(1)], committed: ["Tuesday"], role: "coach" });
    expect(asCoach.moves.map((m) => m.next)).toEqual(["2026-10-06"]);
  });

  it("only moves manual placements when includePinned is set", () => {
    const days = [day("d1", "w1", 1, "2026-10-09", { schedule_source: "manual" })];
    const without = planCommittedRealign({ ...base, days, weeks: [week(1)], committed: ["Tuesday"], includePinned: false });
    expect(without.moves).toEqual([]);
    const withPinned = planCommittedRealign({ ...base, days, weeks: [week(1)], committed: ["Tuesday"] });
    expect(withPinned.moves).toHaveLength(1);
  });

  it("re-dates upcoming Draft blocks too, not just the active one", () => {
    const days = [day("a1", "w1", 1, "2026-10-05"), day("b1", "x1", 1, "2026-11-02")];
    const plan = planCommittedRealign({
      ...base, days,
      blocks: [block, { id: "b2", start_date: "2026-11-02", week_duration_days: 7 }],
      weeks: [week(1), { id: "x1", week_index: 1, block_id: "b2" }],
      committed: ["Wednesday"],
    });
    expect(plan.moves.map((m) => [m.dayId, m.next])).toEqual([["a1", "2026-10-07"], ["b1", "2026-11-04"]]);
  });

  it("reports workouts that can't fit instead of silently ignoring them", () => {
    const days = [
      day("d1", "w1", 1, "2026-10-05"), day("d2", "w1", 2, "2026-10-07"), day("d3", "w1", 3, "2026-10-09"),
    ];
    const plan = planCommittedRealign({ ...base, days, weeks: [week(1)], committed: ["Tuesday", "Thursday"] });
    expect(plan.moves.map((m) => m.next)).toEqual(["2026-10-06", "2026-10-08"]);
    expect(plan.unplaced).toBe(1);
  });

  it("does nothing with no committed days", () => {
    const plan = planCommittedRealign({ ...base, days: [day("d1", "w1", 1, "2026-10-05")], committed: [] });
    expect(plan).toEqual({ moves: [], pendingPinned: 0, unplaced: 0 });
  });
});

describe("normalizeCommittedDays", () => {
  it("keeps only valid weekday names, de-duplicated, in calendar order", () => {
    expect(normalizeCommittedDays(["Friday", "Mon", "Monday", "Monday", "Wednesday"])).toEqual([
      "Monday", "Wednesday", "Friday",
    ]);
    expect(normalizeCommittedDays(null)).toEqual([]);
  });
});

describe("todayInTimeZone", () => {
  it("uses the client's calendar date, not the server's", () => {
    // 2026-10-06 03:00 UTC is still Oct 5 evening in Winnipeg (UTC-5).
    const now = new Date("2026-10-06T03:00:00Z");
    expect(todayInTimeZone("America/Winnipeg", now)).toBe("2026-10-05");
    expect(todayInTimeZone("Pacific/Auckland", now)).toBe("2026-10-06");
  });

  it("falls back safely for a missing or invalid timezone", () => {
    expect(todayInTimeZone(null, new Date("2026-10-06T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayInTimeZone("Not/AZone", new Date("2026-10-06T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
