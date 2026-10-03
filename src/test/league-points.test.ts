import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LEAGUE_RULES, formatLeaguePoints, leaguePointsFromEncoded } from "@/lib/league-points";

describe("league point display", () => {
  it.each([
    [55, "55"],
    [0, "0"],
    [7.5, "7.5"],
    [18.75, "19"], // old 6.25-based totals snap to the nearest half
    [18.8, "19"],
    [21.25, "21.5"],
    [21.3, "21.5"],
    [53.8, "54"],
    [12.25, "12.5"],
    [1250, "1,250"],
    [-0.1, "0"],
    [NaN, "0"],
    [null, "0"],
  ])("%s → %s", (input, expected) => {
    expect(formatLeaguePoints(input as number)).toBe(expected);
  });

  it("never shows quarters or other decimals for any value", () => {
    for (let i = 0; i <= 4000; i++) {
      const out = formatLeaguePoints(i / 40);
      expect(out).toMatch(/^[\d,]+(\.5)?$/);
    }
  });

  it("decodes the RPC's ×1000 encoding", () => {
    expect(leaguePointsFromEncoded(55000)).toBe(55);
    expect(leaguePointsFromEncoded("5000")).toBe(5);
    expect(leaguePointsFromEncoded(null)).toBe(0);
  });
});

describe("league rules stay in sync", () => {
  const sql = readFileSync("supabase/migrations/20261003170000_performance_league_simple_points.sql", "utf8");
  const ui = readFileSync("src/components/portal/athlete-level-card.tsx", "utf8");

  it("uses the simple point values everywhere", () => {
    expect(LEAGUE_RULES.map((r) => r.points)).toEqual([10, 5, 5, 5]);
    expect(sql).toContain("a.workouts_completed*10 workout_points");
    expect(sql).toContain("a.fully_logged*5 logging_points");
    expect(sql).toContain("a.bw_logs*5 bodyweight_points");
    expect(sql).toContain("a.improved_exercises*5 performance_points");
    for (const old of ["6.25", "2.5", "62.5", "bonus_points"]) expect(sql).not.toContain(old);
  });

  it("counts each award once (deduped workouts, one bodyweight per day)", () => {
    expect(sql).toContain("count(distinct e.source_id) filter(where e.event_type='workout_completed'");
    expect(sql).toContain("count(distinct e.source_id) filter(where e.event_type='workout_fully_logged'");
    expect(sql).toMatch(/count\(distinct \(e\.occurred_at at time zone 'UTC'\)::date\) filter\(where e\.event_type='bodyweight'/);
  });

  it("formats every league number through the shared formatter", () => {
    expect(ui).not.toMatch(/leagueScore\([^)]*\)\.toFixed/);
    expect(ui).not.toMatch(/\.xp \?\? 0\)\.toFixed/);
    expect(ui).not.toMatch(/strength_score \?\? 0\)\.toFixed/);
    expect(ui).not.toMatch(/gap\.toFixed/);
    expect(ui).not.toContain("6.25");
  });
});
