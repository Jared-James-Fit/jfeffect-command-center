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

  it("a coach-placed workout moves when the client asks (it's their schedule); an automatic re-plan keeps it", () => {
    const days = [day("d1", "w1", 1, "2026-10-09", { schedule_locked: true, schedule_source: "manual" })];
    // the client changes their training days and moves them all
    const asClient = planCommittedRealign({ ...base, days, weeks: [week(1)], committed: ["Tuesday"] });
    expect(asClient.moves.map((m) => m.next)).toEqual(["2026-10-06"]);
    expect(asClient.pendingPinned).toBe(0);
    const asCoach = planCommittedRealign({ ...base, days, weeks: [week(1)], committed: ["Tuesday"], role: "coach" });
    expect(asCoach.moves.map((m) => m.next)).toEqual(["2026-10-06"]);
    // automatic (a new program, Cleo): hand-placed dates stay put
    const auto = planCommittedRealign({ ...base, days, weeks: [week(1)], committed: ["Tuesday"], includePinned: false });
    expect(auto.moves).toEqual([]);
    expect(auto.pendingPinned).toBe(1);
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

describe("optional sessions go around the core workouts", () => {
  // Week of Mon 2026-10-05 – Sun 2026-10-11; today is Monday.
  const one = { ...base, weeks: [week(1)] };
  const opt = { is_optional: true };

  it("an optional day in the middle of the week never takes a core workout's training day", () => {
    // Elite Powerlifting: Day 3 is the optional recovery day, Day 4 the main SBD day.
    const days = [
      day("d1", "w1", 1, "2026-10-05"), day("d2", "w1", 2, "2026-10-07"),
      day("d3", "w1", 3, "2026-10-08", opt), day("d4", "w1", 4, "2026-10-10"),
    ];
    const plan = planCommittedRealign({ ...one, days, committed: ["Monday", "Wednesday", "Friday"] });
    const at = Object.fromEntries(plan.moves.map((m) => [m.dayId, m.next]));
    expect(at.d4).toBe("2026-10-09"); // the SBD day gets Friday
    // the recovery day goes on a free day, not a training day
    expect(["2026-10-05", "2026-10-07", "2026-10-09"]).not.toContain(at.d3 ?? "2026-10-08");
    expect(plan.unplaced).toBe(0);
  });

  it("extras spread over the week's free days, and stay put on a re-run", () => {
    // Distance Builder for a 3-day runner: easy, quality, long + an easy and a recovery run.
    const days = [
      day("d1", "w1", 1, "2026-10-05"), day("d2", "w1", 2, "2026-10-06"), day("d3", "w1", 3, "2026-10-08"),
      day("d4", "w1", 4, "2026-10-09", opt), day("d5", "w1", 5, "2026-10-11", opt),
    ];
    const committed = ["Monday", "Wednesday", "Saturday"] as const;
    const plan = planCommittedRealign({ ...one, days, committed: [...committed] });
    const at = Object.fromEntries(plan.moves.map((m) => [m.dayId, m.next]));
    expect([at.d1 ?? "2026-10-05", at.d2, at.d3]).toEqual(["2026-10-05", "2026-10-07", "2026-10-10"]);
    // free: Tue, Thu, Fri, Sun. Fri and Sun are already free and kept
    expect(at.d4).toBeUndefined();
    expect(at.d5).toBeUndefined();
    expect(plan.unplaced).toBe(0);

    const after = days.map((d) => ({ ...d, scheduled_date: at[d.id] ?? d.scheduled_date }));
    expect(planCommittedRealign({ ...one, days: after, committed: [...committed] }).moves).toEqual([]);
  });

  it("extras sitting on a training day move to free days, evenly", () => {
    const days = [
      day("d1", "w1", 1, "2026-10-05"), day("d2", "w1", 2, "2026-10-07"), day("d3", "w1", 3, "2026-10-10"),
      day("d4", "w1", 4, "2026-10-07", opt), day("d5", "w1", 5, "2026-10-10", opt),
    ];
    const plan = planCommittedRealign({ ...one, days, committed: ["Monday", "Wednesday", "Saturday"] });
    const at = Object.fromEntries(plan.moves.map((m) => [m.dayId, m.next]));
    // free: Tue 6, Thu 8, Fri 9, Sun 11 → Thu and Sun
    expect([at.d4, at.d5]).toEqual(["2026-10-08", "2026-10-11"]);
  });

  it("someone training more days than the core workouts gets the extras on training days", () => {
    const days = [
      day("d1", "w1", 1, null), day("d2", "w1", 2, null), day("d3", "w1", 3, null),
      day("d4", "w1", 4, null, opt), day("d5", "w1", 5, null, opt),
    ];
    const plan = planCommittedRealign({ ...one, days, committed: ["Monday", "Tuesday", "Wednesday", "Friday", "Saturday"] });
    expect(plan.moves.map((m) => [m.dayId, m.next])).toEqual([
      ["d1", "2026-10-05"], ["d2", "2026-10-06"], ["d3", "2026-10-07"], ["d4", "2026-10-09"], ["d5", "2026-10-10"],
    ]);
  });

  it("a week without optional days places exactly as before", () => {
    const days = [day("d1", "w1", 1, null), day("d2", "w1", 2, null), day("d3", "w1", 3, null), day("d4", "w1", 4, null)];
    const plan = planCommittedRealign({ ...one, days, committed: ["Monday", "Wednesday", "Friday"] });
    expect(plan.moves.map((m) => m.next)).toEqual(["2026-10-05", "2026-10-07", "2026-10-09"]);
    expect(plan.unplaced).toBe(1);
  });
});
