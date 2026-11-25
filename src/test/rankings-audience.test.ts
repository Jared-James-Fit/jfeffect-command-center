import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUDIENCE_OPTIONS,
  DEFAULT_AUDIENCE,
  audienceLabel,
  audienceStorageKey,
  onAudience,
  ownAudience,
  parseAudience,
} from "@/lib/rankings-audience";

const read = (p: string) => readFileSync(p, "utf8");
const sql = read("supabase/migrations/20270527101500_league_hall_audience.sql");
const code = sql.replace(/--.*$/gm, "");

describe("the audience (JF Effect Athletes / Community)", () => {
  it("defaults to JF Effect Athletes and names both options", () => {
    expect(DEFAULT_AUDIENCE).toBe("coaching");
    expect(AUDIENCE_OPTIONS).toEqual([["coaching", "JF Effect Athletes"], ["community", "Community"]]);
    expect(audienceLabel("community")).toBe("Community");
  });

  it("reads only the two known values", () => {
    expect(parseAudience("coaching")).toBe("coaching");
    expect(parseAudience("community")).toBe("community");
    expect(parseAudience("everyone")).toBeNull();
    expect(parseAudience(null)).toBeNull();
  });

  it("is remembered per person", () => {
    expect(audienceStorageKey("u1")).not.toBe(audienceStorageKey("u2"));
    expect(audienceStorageKey(null)).toBe("jf-rankings-audience:anon");
  });

  it("only coaching clients can be on JF Effect Athletes; everyone is on Community", () => {
    expect(onAudience("coaching", "coaching")).toBe(true);
    expect(onAudience("coaching", "self_serve")).toBe(false);
    expect(onAudience("community", "self_serve")).toBe(true);
    expect(onAudience("community", "coaching")).toBe(true);
  });

  it("the Monday card speaks of the board you chose, else the one you're on", () => {
    expect(ownAudience("community", "coaching")).toBe("community");
    expect(ownAudience("coaching", "self_serve")).toBe("coaching");
    expect(ownAudience(null, "self_serve")).toBe("community");
    expect(ownAudience(null, "coaching")).toBe("coaching");
    expect(ownAudience(null, null)).toBe("coaching");
  });
});

describe("the database: an audience argument on every board, Community by default", () => {
  it("defines who is on JF Effect Athletes from the account, never a list", () => {
    expect(code).toContain("c.service_tier = 'coaching'");
    expect(code).toContain("coalesce(c.archived, false) = false");
    expect(code).toContain("c.archived_at is null");
    expect(code).toContain("not in ('Archived', 'Deactivated', 'Deleted')");
    expect(code).not.toMatch(/create table/i);
    // anything that isn't 'coaching' reads as everyone, so an older app sees the board it always did
    expect(code).toContain("select _audience is distinct from 'coaching'");
  });

  it.each([
    ["get_performance_league", "_month date default null, _as_user uuid default null, _audience text default 'community'", "(date, uuid, text)"],
    ["get_strength_board_all", "_as_user uuid default null, _audience text default 'community'", "(uuid, text)"],
    ["get_strength_board_meets", "_as_user uuid default null, _audience text default 'community'", "(uuid, text)"],
  ])("%s takes _audience last, with the old signature dropped and the grants kept", (name, args, sig) => {
    expect(code).toContain(`function public.${name}(${args})`);
    expect(code).toContain(`revoke all on function public.${name}${sig} from public, anon;`);
    expect(code).toContain(`grant execute on function public.${name}${sig} to authenticated`);
  });

  it("the roster, movement and Monday card take it too", () => {
    expect(code).toContain("get_strength_board_roster(_as_user uuid DEFAULT NULL::uuid, _audience text DEFAULT 'community')");
    expect(code).toContain("get_league_week_movement(_as_user uuid DEFAULT NULL, _audience text DEFAULT 'community')");
    expect(code).toContain("get_league_week_spotlight(_as_user uuid DEFAULT NULL, _audience text DEFAULT 'community')");
    // the old one-argument functions are dropped, so a call without the new argument isn't ambiguous
    expect(code).toContain("DROP FUNCTION IF EXISTS public.get_league_week_movement(uuid);");
    expect(code).toContain("DROP FUNCTION IF EXISTS public.get_league_week_spotlight(uuid);");
    expect(code).toContain("drop function if exists public.get_performance_league(date, uuid);");
  });

  it("the League is re-ranked among the audience in league_month_scores' own order; scoring is untouched", () => {
    expect(code).not.toMatch(/function public\.league_month_scores/i);
    expect(code).toContain("from public.league_month_scores(_month, now()) x");
    expect(code).toContain("row_number() over (partition by (x.qualified and x.rank is not null) order by x.rank)");
    expect(code).toContain("s.arank");
  });

  it("movement and the Monday card read the one weekly snapshot, filtered and renumbered (no second job)", () => {
    expect(code).toContain("function public.league_week_audience_rows(_week date, _audience text)");
    expect(code).toContain("order by s.rank, s.client_id");
    expect(code).toContain("FROM public.league_week_audience_rows(w, _audience) s");
    // every read of the snapshots in the Monday card goes through the audience rows
    const spot = code.slice(code.indexOf("FUNCTION public.get_league_week_spotlight("));
    expect(spot).toContain("league_week_audience_rows(prev, _audience)");
    expect(spot.match(/league_week_snapshots s/g)?.length).toBe(1); // the "is this Monday taken?" check
    expect(code).not.toContain("cron.schedule");
    expect(code).not.toMatch(/create table/i);
  });

  it("the Hall filters its candidates before anything is ranked, so ranks and counts are among the audience", () => {
    expect(code).toContain("public.league_in_audience(substr(u.person, 3)::uuid, _audience)");
    expect(code).toContain("where public.league_audience_is_all(_audience)\n      or l.athlete_id in (");
    expect(code).toContain("where public.league_audience_is_all(_audience) or public.league_in_audience(c.id, _audience)");
    expect(code).toContain("where a.client_id is null and public.league_audience_is_all(_audience)");
  });

  it("the helpers are closed to signed-out users and to the app", () => {
    expect(code).toContain("revoke all on function public.league_in_audience(uuid, text) from public, anon, authenticated;");
    expect(code).toContain("revoke all on function public.league_week_audience_rows(date, text) from public, anon, authenticated;");
  });
});

describe("Rankings: the switch and the wiring", () => {
  const hub = read("src/components/community/league-hub.tsx");
  const level = read("src/components/portal/athlete-level-card.tsx");
  const strength = read("src/components/portal/strength-board.tsx");
  const perf = read("src/lib/use-performance-league.ts");
  const week = read("src/lib/league-week.queries.ts");

  it("is a compact second switch under the board switch, neutral and in sentence case", () => {
    expect(hub.indexOf("<AudienceSwitch")).toBeGreaterThan(hub.indexOf('role="tablist" aria-label="Leaderboard"'));
    const sw = hub.slice(hub.indexOf("export function AudienceSwitch"), hub.indexOf("export function RankingsHub"));
    expect(sw).not.toContain("text-primary");
    expect(sw).not.toContain("bg-primary");
    expect(sw).not.toContain("uppercase");
  });

  it("is remembered per person and the default is JF Effect Athletes", () => {
    expect(hub).toContain("const { audience, setAudience } = useRankingsAudience();");
    const hook = read("src/lib/use-rankings-audience.ts");
    expect(hook).toContain("usePortalUserId()");
    expect(hook).toContain("audience: stored ?? DEFAULT_AUDIENCE");
  });

  it("every board and query follows the audience, each cached on its own", () => {
    expect(perf).toContain('queryKey: ["athlete-rankings-monthly-view", view, viewerId, audience]');
    expect(perf).toContain("_audience: audience");
    expect(week).toContain('queryKey: ["league-week-spotlight", viewerId, audience]');
    expect(week).toContain('queryKey: ["league-week-movement", viewerId, audience]');
    expect(strength).toContain('queryKey: ["strength-board", "all", viewerId, audience]');
    expect(strength).toContain('queryKey: ["strength-board", "meets", viewerId, audience]');
    expect(strength).toContain('queryKey: ["strength-board", "roster", viewerId, audience]');
    expect(level).toContain("useLeagueWeekBaseline(audience)");
    expect(level).toContain("useLeagueWeek(!!clientId, audience)");
    expect(level).toContain('usePerformanceLeague("previous", audience)');
    expect(hub).toContain("audience={audience} />");
  });

  it("old callers keep the board they had (Community is every hook's default)", () => {
    expect(perf).toContain('audience: RankingsAudience = "community"');
    expect(strength).toContain('export function useStrengthBoard(audience: RankingsAudience = "community")');
    expect(strength).toContain('export function useMeetBoard(audience: RankingsAudience = "community")');
  });

  it("a member on JF Effect Athletes gets no 'you', a note saying where they rank, and no 'log a lift' nudge", () => {
    expect(level).toContain("data-league-not-on-board");
    expect(level).toContain("You rank in Community.");
    expect(strength).toContain("This board is for coaching clients. You rank in Community.");
  });

  it("the Monday card in the feed is about the board you chose, else the one you're on", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("useLeagueWeek(weekOn, ownAudience(storedAudience, weekTier))");
  });
});
