import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  adherenceTarget,
  boostTag,
  daysLeftInMonth,
  heroState,
  isFinalWeek,
  leagueToday,
  projectedRank,
  threatCount,
  type LeagueRow,
} from "@/lib/league-boost";

const row = (o: Partial<LeagueRow>): LeagueRow => ({
  client_id: Math.random().toString(36).slice(2),
  display_name: "A",
  avatar_url: null,
  rank: 1,
  is_me: false,
  qualified: true,
  bodyweight_value: 150,
  bodyweight_unit: "lb",
  total_points: 100,
  workout_points: 60,
  logging_points: 20,
  bodyweight_points: 10,
  improvement_points: 10,
  match_points: 0,
  workouts_completed: 6,
  fully_logged: 4,
  boost_status: "out",
  needed_workouts: 0,
  projected_total: null,
  eligible_workouts: null,
  completed_eligible: null,
  adherence_pct: null,
  open_workouts: null,
  match_target: null,
  projected_match: null,
  month_start: "2026-10-01",
  final_week_start: "2026-10-25",
  is_final_week: true,
  month_closed: false,
  finalized: false,
  ...o,
});

describe("leaderboard boost tags", () => {
  it("keeps labels short and honest", () => {
    expect(boostTag({ boost_status: "ready", needed_workouts: 0 })).toBe("🔥 BOOST READY");
    expect(boostTag({ boost_status: "chasing", needed_workouts: 1 })).toBe("🔥 1 WORKOUT LEFT");
    expect(boostTag({ boost_status: "chasing", needed_workouts: 2 })).toBe("🔥 2 WORKOUTS LEFT");
    expect(boostTag({ boost_status: "chasing", needed_workouts: 5 })).toBe("🔥 IN THE RACE");
    expect(boostTag({ boost_status: "out", needed_workouts: 3 })).toBeNull();
    expect(boostTag({ boost_status: "none", needed_workouts: 0 })).toBeNull();
  });
});

describe("final-week hero", () => {
  it("escalates as the athlete gets closer", () => {
    expect(heroState({ boost_status: "chasing", needed_workouts: 3 })).toMatchObject({ tone: "hype", headline: "3 workouts to go" });
    expect(heroState({ boost_status: "chasing", needed_workouts: 2 })).toMatchObject({ headline: "2 WORKOUTS LEFT", sub: "Finish them → Unlock the boost" });
    expect(heroState({ boost_status: "chasing", needed_workouts: 1 })).toMatchObject({ headline: "ONE WORKOUT LEFT", sub: "Finish it → Workout Points Match unlocked" });
    expect(heroState({ boost_status: "ready", needed_workouts: 0 })).toMatchObject({ tone: "win", eyebrow: "🔥 BOOST UNLOCKED", sub: "Workout Points Match secured" });
  });

  it("never hypes an athlete who can no longer qualify", () => {
    for (const status of ["out", "none"] as const) {
      const s = heroState({ boost_status: status, needed_workouts: 4 });
      expect(s.tone).toBe("neutral");
      expect(`${s.eyebrow} ${s.headline} ${s.sub}`).not.toMatch(/unlock|left|to go|🔥/i);
      expect(s.headline).toBe("90% monthly adherence required");
    }
  });
});

describe("threat warning", () => {
  const me = row({ is_me: true, rank: 1, total_points: 145, boost_status: "out" });

  it("counts only athletes behind me who can still catch or pass me", () => {
    const rows = [
      me,
      row({ rank: 2, total_points: 125, boost_status: "chasing", needed_workouts: 1, projected_total: 150 }), // passes
      row({ rank: 3, total_points: 118, boost_status: "ready", projected_total: 145 }), // ties = catch
      row({ rank: 4, total_points: 105, boost_status: "chasing", needed_workouts: 2, projected_total: 140 }), // falls short
      row({ rank: 5, total_points: 100, boost_status: "out", projected_total: null }), // can't move
    ];
    expect(threatCount(rows, me)).toBe(2);
  });

  it("compares against my own best case when I can still boost", () => {
    const meChasing = row({ is_me: true, rank: 1, total_points: 145, boost_status: "chasing", needed_workouts: 1, projected_total: 170 });
    const rows = [meChasing, row({ rank: 2, total_points: 125, boost_status: "chasing", needed_workouts: 1, projected_total: 160 })];
    expect(threatCount(rows, meChasing)).toBe(0);
  });

  it("shows nothing outside the final week, off the board, or with no real threat", () => {
    const rows = [me, row({ rank: 2, total_points: 125, boost_status: "chasing", needed_workouts: 1, projected_total: 150 })];
    expect(threatCount(rows, { ...me, is_final_week: false })).toBe(0);
    expect(threatCount(rows, { ...me, qualified: false, rank: null })).toBe(0);
    expect(threatCount([me], me)).toBe(0);
    expect(threatCount(rows, undefined)).toBe(0);
  });

  it("ignores athletes ranked above me", () => {
    const meMid = row({ is_me: true, rank: 3, total_points: 100 });
    const rows = [row({ rank: 1, total_points: 200, boost_status: "chasing", needed_workouts: 1, projected_total: 230 }), meMid];
    expect(threatCount(rows, meMid)).toBe(0);
  });
});

describe("projected rank", () => {
  it("places my projected total against current totals", () => {
    const me = row({ is_me: true, rank: 4, total_points: 115, boost_status: "chasing", needed_workouts: 1, projected_total: 145 });
    const rows = [row({ rank: 1, total_points: 160 }), row({ rank: 2, total_points: 140 }), row({ rank: 3, total_points: 130 }), me];
    expect(projectedRank(rows, me)).toBe(2);
    expect(projectedRank(rows, { ...me, boost_status: "out", projected_total: null })).toBeNull();
  });
});

describe("90% target", () => {
  it.each([[12, 11], [10, 9], [8, 8], [6, 6], [20, 18], [9, 9], [11, 10], [1, 1]])("%i prescribed → %i needed", (eligible, target) => {
    expect(adherenceTarget(eligible)).toBe(target);
    expect(target / eligible).toBeGreaterThanOrEqual(0.9);
    expect((target - 1) / eligible).toBeLessThan(0.9);
  });
});

describe("final week + league timezone (America/Winnipeg)", () => {
  it.each([
    ["2026-10-24T23:59:00-05:00", false],
    ["2026-10-25T00:00:00-05:00", true],
    ["2026-10-31T23:59:00-05:00", true],
    ["2026-11-01T03:00:00Z", true], // still Oct 31 evening in Winnipeg
    ["2026-11-01T06:00:00Z", false], // Nov 1 in Winnipeg: reset
    ["2026-02-22T12:00:00-06:00", true], // 28-day month: last 7 days start on the 22nd
    ["2026-02-21T12:00:00-06:00", false],
    ["2028-02-23T12:00:00-06:00", true], // leap year
    ["2026-09-24T12:00:00-05:00", true], // 30-day month
    ["2026-09-23T12:00:00-05:00", false],
  ])("%s → %s", (iso, expected) => {
    expect(isFinalWeek(new Date(iso))).toBe(expected);
  });

  it("counts days left including today", () => {
    expect(daysLeftInMonth(new Date("2026-10-31T12:00:00-05:00"))).toBe(1);
    expect(daysLeftInMonth(new Date("2026-10-25T12:00:00-05:00"))).toBe(7);
    expect(leagueToday(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10-31");
  });
});

describe("database rules match the client copy", () => {
  const sql = readFileSync("supabase/migrations/20261003180000_performance_league_final_week_boost.sql", "utf8");
  it("uses 90%, Winnipeg time, the 6-workout minimum and never-negative awards", () => {
    expect(sql).toContain("(x.eligible_workouts * 9 + 9) / 10");
    expect(sql).toContain("'America/Winnipeg'");
    expect(sql).toContain("select 6 $$");
    expect(sql).toContain("check (match_points >= 0)");
    expect(sql).toContain("primary key (client_id, league_month)");
  });
});
