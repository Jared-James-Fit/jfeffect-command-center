import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LEAGUE_COMMUNITY_POINTS, LEAGUE_COMMUNITY_WEEKLY_CAP, LEAGUE_RECORD_CAP, LEAGUE_RECORDS_START, LEAGUE_RULES, formatLeaguePoints, leaguePointsFromEncoded } from "@/lib/league-points";

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
    expect(LEAGUE_RULES.map((r) => r.points)).toEqual([10, 5, 5, 10, 5, 3, 15]);
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

describe("training-record points (from Oct 2026)", () => {
  const sql = readFileSync("supabase/migrations/20261004180000_league_record_points.sql", "utf8");
  const rules = Object.fromEntries(LEAGUE_RULES.map((r) => [r.key, r.points]));

  it("UI rules match the database: ATPR +10, PROGRAM PR +5, BLOCK PR +3, capped per month", () => {
    expect(rules).toMatchObject({ atpr: 10, program_pr: 5, block_pr: 3 });
    expect(sql).toContain(`least(${LEAGUE_RECORD_CAP}, sum(case rl.tier when 3 then 10 when 2 then 5 when 1 then 3 else 0 end))`);
    expect(sql).toContain(`select date '${LEAGUE_RECORDS_START}'`);
  });

  it("scores each lift once per month at its best tier, from completed workouts only", () => {
    expect(sql).toContain("group by c.client_id, r.exercise_key");
    expect(sql).toMatch(/case when bool_or\(r\.is_atpr\) then 3 when bool_or\(r\.is_program_pr\) then 2 when bool_or\(r\.is_block_pr\) then 1/);
    expect(sql).toContain("r.completed and r.workout_at >= f.start_at");
  });

  it("keeps finalized months on the old rule", () => {
    expect(sql).toContain("else coalesce(i.improved_exercises,0) * 5 end record_or_improvement_points");
  });

  it("returns record counts for the leaderboard badges", () => {
    expect(sql).toMatch(/atpr_lifts integer, program_pr_lifts integer, block_pr_lifts integer, last_record_at timestamptz/);
  });
});

describe("community post points (from Oct 2026)", () => {
  const sql = readFileSync("supabase/migrations/20261012110000_league_community_post_points.sql", "utf8");
  const rules = Object.fromEntries(LEAGUE_RULES.map((r) => [r.key, r.points]));

  it("UI rule matches the database: +15 a post, capped per week", () => {
    expect(rules.community).toBe(LEAGUE_COMMUNITY_POINTS);
    expect(sql).toContain(`x.community_posts * ${LEAGUE_COMMUNITY_POINTS} community_points`);
    expect(sql).toContain(`sum(least(${LEAGUE_COMMUNITY_WEEKLY_CAP}, w.n))::int community_posts`);
    expect(sql).toContain(`'points', ${LEAGUE_COMMUNITY_POINTS}`);
    expect(sql).toContain(`'week_cap', ${LEAGUE_COMMUNITY_WEEKLY_CAP}`);
  });

  it("adds community points to the total and keeps the league columns additive", () => {
    expect(sql).toContain("bo.improvement_points + bo.community_points base_total");
    expect(sql).toMatch(/is_coach boolean, community_posts integer, community_points integer\)/);
  });

  it("only pays for visible posts of finished, recent workouts, once per day", () => {
    expect(sql).toContain("'community_post:' || _day::text");
    expect(sql).toContain("cp.visibility = 'community'");
    expect(sql).toContain("cp.archived_at is null");
    expect(sql).toContain("pc.completed_at is not null");
    expect(sql).toContain("pc.completed_at >= cp.created_at - interval '7 days'");
    // deleting / archiving / hiding takes the event back
    expect(sql).toContain("delete from public.athlete_xp_events where client_id = _client and source_key = k");
  });
});
