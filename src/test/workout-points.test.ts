import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("post-workout points summary", () => {
  const sql = readFileSync("supabase/migrations/20261004240000_workout_points_summary.sql", "utf8");
  const card = readFileSync("src/components/records/workout-points-card.tsx", "utf8");

  it("uses the league's values: +10 completed, +5 fully logged, records 10/5/3 capped at 40", () => {
    expect(sql).toContain("completed_pts := 10;");
    expect(sql).toContain("logged_pts := 5;");
    expect(sql).toContain("CASE t.tier WHEN 3 THEN 10 WHEN 2 THEN 5 WHEN 1 THEN 3 ELSE 0 END");
    expect(sql).toContain("record_pts := least(upgrade_total, greatest(0, 40 - earlier_total));");
  });

  it("only credits the upgrade over records already earned on that lift this month", () => {
    expect(sql).toMatch(/- CASE coalesce\(bw\.tier, 0\) WHEN 3 THEN 10/);
    expect(sql).toContain("m.workout_at < comp.completed_at");
  });

  it("counts both rep and weight records, and Logging Level points from the DB-awarded events", () => {
    expect(sql).toContain("public.client_load_records(_client_id)");
    expect(sql).toContain("FROM public.athlete_xp_events e");
    expect(sql).toContain("f.completion_id = comp.id");
  });

  it("card lines always add up to the league total", () => {
    expect(card).toContain('{ label: "Records", n: league.records }');
    expect(card).not.toMatch(/n: r\.points/);
  });
});
