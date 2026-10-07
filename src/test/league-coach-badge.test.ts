import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The coach trains as a client too. Clients should see which athlete in the league is the coach. The
 * database says who (the community's own coach rule), the app only draws the badge. Source-level checks:
 * the app has no DOM test environment, and the real answer was checked against production data.
 */
const read = (path: string) => readFileSync(path, "utf8");

const sql = read("supabase/migrations/20261008170000_league_coach_badge.sql");
const card = read("src/components/portal/athlete-level-card.tsx");
const recap = read("src/components/portal/league-recap.tsx");
const story = read("src/lib/recap-story-card.ts");

/** The text of one function in the migration, from its create to the next one. */
const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const next = sql.indexOf("create or replace function", start + 10);
  return sql.slice(start, next === -1 ? undefined : next);
};

describe("the database says who the coach is", () => {
  it.each(["get_monthly_athlete_rankings", "get_performance_league", "get_athlete_public_profile"])(
    "%s returns is_coach, last, using the community's rule",
    (name) => {
      const body = fn(name);
      expect(body).toMatch(/is_coach boolean\)\s+language sql/);
      expect(body).toMatch(/public\.community_is_coach\((s|c)\.user_id\)/);
    },
  );

  it("adds it to the recap's podium and rivals", () => {
    const body = fn("get_league_month_recap");
    expect(body).toContain("'is_coach', public.community_is_coach(b.user_id)");
    expect(body).toContain("'is_coach', public.community_is_coach(r.user_id)");
  });

  it("uses the one existing rule instead of a second list of coaches", () => {
    expect(sql).not.toMatch(/create table|alter table/i);
    const code = sql.replace(/--.*$/gm, "");
    expect(code.match(/public\.community_is_coach\(/g)?.length).toBe(5);
  });

  it("keeps every function closed to signed-out users", () => {
    for (const sig of [
      "get_monthly_athlete_rankings(integer, uuid)",
      "get_performance_league(date, uuid)",
      "get_athlete_public_profile(uuid)",
      "get_league_month_recap(date, uuid)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${sig} from public, anon;`);
      expect(sql).toContain(`grant execute on function public.${sig} to authenticated, service_role;`);
    }
  });
});

describe("clients see the badge", () => {
  it("on the home podium, the league podium and rows, and the athlete profile", () => {
    expect(card).toContain('import { CoachTag } from "@/components/portal/coach-tag"');
    expect(card.match(/<CoachTag/g)?.length).toBe(4);
    expect(card).toMatch(/r\.is_coach && <div className="mt-0\.5 flex justify-center"><CoachTag \/><\/div>/);
    expect(card).toContain("p.is_coach && <CoachTag />");
  });

  it("on the month recap, and in the shareable recap image", () => {
    expect(recap.match(/<CoachTag onDark/g)?.length).toBe(2);
    expect(story).toContain('p.is_coach ? " · Coach" : ""');
  });

  it("reads the flag the database sent, and never works it out from a name", () => {
    expect(card).not.toMatch(/display_name\s*(===|==|\.includes)/);
    expect(recap).not.toMatch(/display_name\s*(===|==|\.includes)/);
  });
});
