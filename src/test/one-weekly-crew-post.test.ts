import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20270205090000_one_weekly_crew_post.sql");
const coach = read("src/components/community/coach-weekly-posts.tsx");
const hub = read("src/components/community/admin-community-hub.tsx");
const queries = read("src/lib/community.queries.ts");
const fn = (name: string) => sql.slice(sql.indexOf(`FUNCTION public.${name}`), sql.indexOf("$$;", sql.indexOf(`FUNCTION public.${name}`)));

describe("one weekly crew post", () => {
  it("Wins always runs; the Recap posts on its own only while it's switched on", () => {
    const pub = fn("community_publish_series");
    expect(pub).toContain("IF _series IS NULL AND v_series <> 'wednesday_wins'");
    expect(pub).toContain("RETURN jsonb_build_object('status', 'off');");
    // with no Recap the week before, Wins carries the week's numbers card
    expect(pub).toContain("WHERE r.series_key = 'sunday_recap:' || to_char(date_trunc('week', v_local)::date - 1, 'IYYY-\"W\"IW'))");
    expect(pub).toContain("THEN NULL ELSE v_comp->'stats' END;");
    expect(fn("community_series_set_on")).toContain("'saturday_spirit', 'sunday_recap') THEN");
  });

  it("the series go out on Winnipeg's real clock, never a bare AT TIME ZONE", () => {
    expect(fn("community_publish_series")).toContain("public.instant_to_local(coalesce(_at, now()), 'America/Winnipeg')");
    expect(sql.replace(/--.*$/gm, "")).not.toContain("AT TIME ZONE");
    expect(fn("community_next_post")).toContain("public.local_to_instant(v_day + v_time, tz)");
  });

  it("the coach's Next follows the week: the picture on its days, never the Recap or a series that's off", () => {
    const next = fn("community_next_post");
    expect(next).toContain("public.community_coach_post_day(v_day) IS NULL");
    expect(next).toContain("r.series_key = 'daily_visual:' || v_day::text");
    expect(next).toContain("(v_series = 'wednesday_wins' OR v_series = ANY (coalesce(v_settings.series_on, '{}'::text[])))");
    expect(hub).toContain('if (p.next.series === "daily_visual") return { title: "Next: Daily picture"');
  });

  it("this week's extra coach posts are archived only while nobody but staff engaged with them", () => {
    const archive = sql.slice(sql.indexOf("WITH extra(id) AS"), sql.indexOf("CREATE OR REPLACE FUNCTION public.community_next_post"));
    expect([...archive.matchAll(/'[0-9a-f-]{36}'::uuid/g)]).toHaveLength(10);
    expect(archive).toContain("SET archived_at = now()");
    expect(archive).not.toMatch(/DELETE FROM/);
    expect(archive).toContain("AND p.series IN ('lesson', 'daily_visual', 'try_it_thursday', 'finish_strong_friday')");
    for (const t of ["community_reactions", "community_comments", "community_saves", "community_reposts"])
      expect(archive).toContain(`NOT EXISTS (SELECT 1 FROM public.${t}`);
  });

  it("the Recap is a switch on Crew → Posts, with Post now kept", () => {
    expect(queries).toContain('export type SwitchedSeries = LibrarySeries | Extract<CommunitySeries, "sunday_recap">;');
    expect(coach).toContain('const isSwitched = (s: DailySeries): s is SwitchedSeries => isLibrary(s) || s === "sunday_recap";');
    expect(coach).toContain("{isSwitched(series) ? (");
    expect(coach).toContain("Off: Wednesday Wins carries the week's numbers. Post a recap by hand when a week's worth one.");
    expect(coach).toContain('{(series === "sunday_recap" ? !done && !!recapNow : library && !done && next) && (');
  });
});
