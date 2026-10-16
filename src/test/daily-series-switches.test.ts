import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261209090000_daily_series_alongside_lessons.sql");
const coach = read("src/components/community/coach-weekly-posts.tsx");
const queries = read("src/lib/community.queries.ts");
const LIBRARY = ["monday_motivation", "tuesday_tips", "try_it_thursday", "finish_strong_friday", "saturday_spirit"];

describe("the five daily series, back on the coach's switches", () => {
  it("are off until the coach turns one on, and only the five can be", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS series_on text[] NOT NULL DEFAULT '{}'");
    expect(sql).toContain(`series_on <@ ARRAY[${LIBRARY.map((s) => `'${s}'`).join(", ")}]::text[]`);
    const setOn = sql.slice(sql.indexOf("FUNCTION public.community_series_set_on"), sql.indexOf("GRANT EXECUTE ON FUNCTION public.community_series_set_on"));
    expect(setOn).toContain("IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed'");
    expect(setOn).toContain("RAISE EXCEPTION 'Unknown series'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_series_set_on(text, boolean) FROM PUBLIC, anon;");
  });

  it("the daily job posts a series the coach turned on, alongside the lesson; the rest stay lesson days", () => {
    const pub = sql.slice(sql.indexOf("FUNCTION public.community_publish_series"), sql.indexOf("-- Tuesday's lesson"));
    const load = pub.indexOf("SELECT * INTO v_settings FROM public.community_series_settings WHERE id;");
    const gate = pub.indexOf("RETURN jsonb_build_object('status', 'lesson_day')");
    expect(load).toBeGreaterThan(0);
    expect(load).toBeLessThan(gate); // the switch is read before deciding it's a lesson-only day
    expect(pub).toContain("AND NOT (v_series = ANY (coalesce(v_settings.series_on, '{}'::text[]))) THEN");
    // Tuesday Tips is as it was: the crew's numbers when they hold, else a tip
    expect(pub).toContain("v_comp := public.community_compose_observation(v_author);");
    // still once a week per series, inside its window
    expect(pub).toContain("v_key := v_series || ':' || to_char(v_local, 'IYYY-\"W\"IW');");
    expect(pub).toContain("RETURN jsonb_build_object('status', 'outside_window');");
  });

  it("Tuesday's lesson leaves the crew's numbers to Tuesday Tips when it's on, and never fails on a taken slot", () => {
    const patch = sql.slice(sql.indexOf("-- Tuesday's lesson"), sql.indexOf("-- ...and the planner"));
    expect(patch).toContain("AND NOT (''tuesday_tips'' = ANY (coalesce(v_settings.series_on, ''{}''::text[])))");
    expect(patch).toContain("AND NOT EXISTS (SELECT 1 FROM public.community_series_runs x WHERE x.series_key = ''tuesday_tips:''");
    expect(patch).toContain("RAISE EXCEPTION 'community_lesson_post: Tuesday anchor not found'");
    const planner = sql.slice(sql.indexOf("-- ...and the planner"), sql.indexOf("-- The coach screen"));
    expect(planner).toContain("'observation'', CASE WHEN NOT (''tuesday_tips'' = ANY");
  });

  it("the coach screen gets the switches and the holidays coming up", () => {
    const ov = sql.slice(sql.indexOf("FUNCTION public.community_series_overview"));
    expect(ov).toContain("'series_on', to_jsonb(coalesce(v_settings.series_on, '{}'::text[]))");
    expect(ov).toContain("'holidays', coalesce((");
    expect(ov).toContain("'posted', EXISTS (SELECT 1 FROM public.community_series_runs r");
    expect(ov).toContain("WHERE r.series_key = 'holiday:' || h.key || ':' || extract(year FROM h.d)::int))");
  });

  it("each of the five has a switch that flips at once, and Wins and Recap stay always on", () => {
    expect(queries).toContain('db.rpc("community_series_set_on", { _series: a.series, _on: a.on })');
    expect(queries).toContain('if (a.kind !== "series_on") return undefined;');
    expect(queries).toContain('if (a.kind === "series_on") qc.invalidateQueries({ queryKey: ["community-lessons"] });');
    expect(coach).toContain("const isLibrary = (s: DailySeries): s is LibrarySeries => !(s === \"wednesday_wins\" || s === \"sunday_recap\");");
    expect(coach).toContain("onCheckedChange={(v) => flip(series, v)}");
    expect(coach).toContain("always on · ${SOURCE[series]}");
    for (const s of LIBRARY) expect(coach).toContain(`${s}: "`);
    expect(coach).toContain("data-coach-holidays");
  });
});
