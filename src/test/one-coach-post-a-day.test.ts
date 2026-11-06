import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pictureDaysLabel } from "@/lib/daily-visuals";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20270204090000_one_coach_post_a_day.sql");
const card = read("src/components/community/daily-pictures-card.tsx");
const series = read("src/components/community/coach-weekly-posts.tsx");

/** A week from a Friday, as the overview gives it: what else goes out each day (null = the picture). */
const week = (posts: (string | null)[]) =>
  posts.map((post, i) => ({ day: `2026-11-${String(6 + i).padStart(2, "0")}`, post }));

describe("one coach post a day", () => {
  it("the picture takes only the days nothing else does, Sunday always (the verse)", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.community_coach_post_day"), sql.indexOf("REVOKE ALL ON FUNCTION public.community_coach_post_day"));
    // Sunday first, before any lesson, series or holiday can take it
    expect(fn.indexOf("WHEN d.n = 7 THEN NULL")).toBeLessThan(fn.indexOf("'lesson'"));
    // a lesson wherever one is planned, or a lesson day not planned yet; a skipped lesson frees the day
    expect(fn).toContain("l.status IN ('planned', 'approved', 'posted')");
    expect(fn).toContain("public.community_lesson_track(_day) IS NOT NULL");
    expect(fn).toContain("WHEN d.n = 3 THEN 'wednesday_wins'");
    for (const s of ["monday_motivation", "tuesday_tips", "try_it_thursday", "finish_strong_friday", "saturday_spirit"])
      expect(fn).toContain(`'${s}' = ANY (s.series_on)`);
    expect(fn).toContain("public.community_holiday_date(h.key, extract(year FROM _day)::int) = _day");
    // the planner never makes a picture for a taken day
    expect(sql).toContain("WHERE public.community_coach_post_day(d::date) IS NULL");
  });

  it("switches off the series that doubled up a day, keeping their libraries", () => {
    expect(sql).toContain("WHERE s NOT IN ('monday_motivation', 'try_it_thursday', 'finish_strong_friday', 'saturday_spirit')");
    expect(sql).not.toMatch(/DELETE FROM public\.community_series_items/);
  });

  it("a picture already made for a taken day is skipped, never deleted; only untouched placeholders go", () => {
    const del = sql.slice(sql.indexOf("DELETE FROM public.community_daily_visuals"), sql.indexOf("UPDATE public.community_daily_visuals v"));
    for (const untouched of ["v.picture IS NULL", "v.ai_line IS NULL", "v.coach_line IS NULL", "v.candidate IS NULL", "v.concept IS NULL", "v.post_id IS NULL"])
      expect(del).toContain(untouched);
    expect(del).toContain("NOT EXISTS (SELECT 1 FROM public.community_daily_visual_versions x WHERE x.visual_id = v.id)");
    expect(sql).toContain("SET status = 'skipped', updated_at = now()");
  });

  it("the coach's card says which days pictures go out", () => {
    expect(sql).toContain("'week', (SELECT jsonb_agg(jsonb_build_object('day', d::date, 'post', public.community_coach_post_day(d::date)) ORDER BY d)");
    expect(card).toContain("data-daily-picture-days");
    expect(card).toContain("pictureDaysLabel(data.week)");
    expect(card).not.toContain("Every morning at 7");
    expect(series).toContain("One coach post a day · Winnipeg time");
    expect(series).not.toContain("alongside that day's lesson");
  });

  it("names the picture days Monday first", () => {
    // Fri Nov 6 to Thu Nov 12: picture Fri, Sat, Sun; lesson, tip, Wins, lesson
    expect(pictureDaysLabel(week([null, null, null, "lesson", "tuesday_tips", "wednesday_wins", "lesson"]))).toBe("Fri, Sat and Sun");
    // starting midweek still reads Monday first
    expect(
      pictureDaysLabel([
        { day: "2026-11-11", post: "wednesday_wins" },
        { day: "2026-11-15", post: null },
        { day: "2026-11-16", post: null },
      ]),
    ).toBe("Mon and Sun");
    expect(pictureDaysLabel([{ day: "2026-11-08", post: null }])).toBe("Sun");
    expect(pictureDaysLabel(week(["holiday", "lesson"]))).toBeNull();
    expect(pictureDaysLabel(undefined)).toBeNull();
  });
});
