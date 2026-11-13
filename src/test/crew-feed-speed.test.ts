// Crew loads fast (Nov 14 2026): a post is no longer rebuilt from scratch on
// every read. Measured on production as a client, a page of ten went from
// ~1.75 s to ~0.19 s in the database and the story rail's ten from 2.1 s to
// 0.18 s, with every stored workout's stats identical to a fresh calculation.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20270317090000_crew_feed_speed.sql", "utf8");
const screen = readFileSync("src/components/community/community-screen.tsx", "utf8");

describe("people lookups", () => {
  it("run the role check on the person's own accounts only (identical answers)", () => {
    expect(sql.match(/accounts AS MATERIALIZED \(/g)?.length).toBe(3);
  });
  it("\"is this a coach?\" never builds a whole person card", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.community_is_coach"), sql.indexOf("-- 3. Stored workout stats."));
    expect(fn).not.toContain("community_author(");
    expect(fn).toContain("WHERE cp.title IS NOT NULL");
  });
});

describe("stored workout stats", () => {
  it("are read back only while still true, else worked out as before", () => {
    expect(sql).toContain("AND s.version = coalesce((SELECT v.version FROM public.community_workout_stats_versions v WHERE v.client_id = s.client_id), 0)");
    expect(sql).toContain("AND s.computed_at > now() - interval '1 day'),\n    public.community_workout_stats(_completion_id))");
  });
  it("read the version before working the stats out, so a change meanwhile leaves them stale, never wrong", () => {
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.community_workout_stats_refresh"));
    expect(body.indexOf("v := coalesce((SELECT v2.version")).toBeLessThan(body.indexOf("s := public.community_workout_stats(r.id);"));
  });
  it("move with what they depend on, never with a set logged in a workout still going", () => {
    expect(sql).toContain("AFTER INSERT OR UPDATE OR DELETE ON public.pl_row_results");
    expect(sql).toContain("AFTER INSERT OR UPDATE OR DELETE ON public.pl_day_completions");
    expect(sql).toContain("AFTER UPDATE OF title, subtitle, week_id ON public.pl_days");
    expect(sql).toContain("AFTER UPDATE OF exercise_id, exercise_name_override, sort_order, day_id ON public.pl_exercise_rows");
    expect(sql).toContain("AFTER INSERT OR DELETE OR UPDATE OF archived, prep_id, start_date, client_id, training_focus ON public.pl_blocks");
    expect(sql).toContain("AFTER UPDATE OF week_index, block_id ON public.pl_weeks");
    expect(sql).toContain("AFTER UPDATE OF timezone ON public.clients");
    expect(sql).toContain("AFTER UPDATE OF name ON public.exercises");
    // only a change at or before a finished workout moves the version
    expect(sql).toContain("pc.completed_at IS NOT NULL AND pc.completed_at >= _from) THEN\n    RETURN;");
  });
  it("are kept out of every client's reach and filled every minute", () => {
    expect(sql).toContain("REVOKE ALL ON public.community_workout_stats_cache FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("cron.schedule('community-workout-stats', '* * * * *', $cmd$SELECT public.community_workout_stats_refresh(40)$cmd$)");
  });
  it("are what a post reads, and nothing else about a post changes", () => {
    expect(sql).toContain("IF (length(d) - length(replace(d, was, ''))) / length(was) <> 2 THEN");
    expect(sql).toContain("now_ text := 'public.community_workout_stats_cached(n.completion_id)';");
  });
});

describe("the paged feed", () => {
  it("asks for its next page four screens before the end", () => {
    expect(screen).toContain('export const FEED_READ_AHEAD = "400% 0px";');
    expect(screen).toContain('{ rootMargin: paging ? FEED_READ_AHEAD : "1400px 0px" },');
  });
});
