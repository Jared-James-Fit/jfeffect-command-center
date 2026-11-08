import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pictureDaysLabel } from "@/lib/daily-visuals";

const sql = readFileSync("supabase/migrations/20270211090000_athlete_insights.sql", "utf8");
const card = readFileSync("src/components/community/daily-pictures-card.tsx", "utf8");
const fn = (name: string) => sql.slice(sql.indexOf(`FUNCTION public.${name}(`), sql.indexOf("$$;", sql.indexOf(`FUNCTION public.${name}(`)));

describe("Athlete Insights: the coach picks the days, 3 a week by default", () => {
  it("stores the weekdays, Friday to Sunday by default, and plans only on a picked day nothing else takes", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS daily_visuals_days int[] NOT NULL DEFAULT '{5,6,7}';");
    expect(sql).toContain("CHECK (daily_visuals_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]");
    const plan = fn("community_daily_visuals_plan");
    expect(plan).toContain("WHERE extract(isodow FROM d)::int = ANY (v_on)");
    expect(plan).toContain("AND public.community_coach_post_day(d::date) IS NULL");
    // nobody's targeted by gender any more
    expect(plan).toContain("public.community_daily_theme(d::date), 'everyone',");
  });

  it("changing the days drops untouched placeholders, skips made ones (never deletes them) and plans the new ones", () => {
    const set = fn("community_daily_visuals_set_days");
    expect(set).toContain("IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed'");
    expect(set).toContain("IF cardinality(v_days) = 0 THEN RAISE EXCEPTION 'Pick at least one day (or switch them off)'; END IF;");
    expect(set).toContain("AND v.status = 'planned' AND v.picture IS NULL AND v.ai_line IS NULL AND v.coach_line IS NULL");
    expect(set).toContain("SET status = 'skipped', regen = NULL, candidate = NULL, error = 'Not an Athlete Insights day any more'");
    expect(set).toContain("PERFORM public.community_daily_visuals_plan(v_today, 7);");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.community_daily_visuals_set_days(int[]) TO authenticated;");
  });

  it("the coach's Next and the card's week count only picked days", () => {
    expect(sql).toContain("AND v_dow = ANY (public.community_insight_days())");
    expect(sql).toContain("CASE WHEN extract(isodow FROM d)::int = ANY (v_on) THEN NULL ELSE 'off' END");
    // Fri Nov 6 to Thu Nov 12 with Fri, Sat and Sun picked
    const week = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((day, i) => ({
      day,
      post: [null, null, null, "lesson", "tuesday_tips", "wednesday_wins", "lesson"][i],
    }));
    expect(pictureDaysLabel(week)).toBe("Fri, Sat and Sun");
    // a free day that isn't picked isn't a picture day
    expect(pictureDaysLabel(week.map((w) => (w.day === "2026-11-07" ? { ...w, post: "off" } : w)))).toBe("Fri and Sun");
  });
});

describe("Athlete Insights: move a post, publish it now", () => {
  it("moves only a post that isn't out, to today or later, onto a free day, and marks the day it left", () => {
    const move = fn("community_daily_visual_move");
    expect(move).toContain("IF r.status = 'posted' OR r.post_id IS NOT NULL THEN RAISE EXCEPTION 'It''s already out'; END IF;");
    expect(move).toContain("IF _day IS NULL OR _day < v_today THEN RAISE EXCEPTION 'Pick today or a day ahead'; END IF;");
    expect(move).toContain("RAISE EXCEPTION 'Another Athlete Insight is on that day';");
    expect(move).toContain("RAISE EXCEPTION 'Something else goes out that day (%): one coach post a day'");
    // the verse stays with Sunday's post
    expect(move).toContain("verse_ref = CASE WHEN extract(isodow FROM _day) = 7 THEN v.verse_ref END,");
    expect(move).toContain("'Moved to ' || to_char(_day, 'Dy Mon FMDD')");
    expect(card).toContain('db.rpc("community_daily_visual_move", { _id: d!.id, _day: day })');
  });

  it("Publish now works on any post that's ready and not out, and counts as the coach's OK", () => {
    expect(sql).toContain("IF r.day < v_today THEN RAISE EXCEPTION 'That day has passed: move it to today or a day ahead'; END IF;");
    expect(sql).toContain("UPDATE public.community_daily_visuals SET approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, auth.uid()) WHERE id = r.id;");
    expect(card).toContain('run("post", "Published")');
  });
});

describe("Athlete Insights: the coach's card", () => {
  it("is named Athlete Insights, with the days, each post's image, topic, caption, date and status, and its checks", () => {
    expect(card).toContain('<div className="text-[16px] font-semibold">Athlete Insights</div>');
    expect(card).not.toMatch(/Daily pictures/);
    expect(card).toContain("data-insight-days");
    expect(card).toContain('aria-label="Athlete Insights on"');
    for (const part of ["data-daily-about", "data-daily-quality", "data-daily-regenerate", "data-daily-schedule"]) expect(card, part).toContain(part);
    // a new image keeps the caption, a new caption keeps the image
    expect(card).toContain('run("picture", "A new image is being made. The caption stays."');
    expect(card).toContain('run("caption", "A new caption is being written. The image stays.")');
    expect(card).toContain("Edit caption");
    // no style references: a photo isn't matched to a 2D frame
    expect(card).not.toContain("StyleReferences");
  });

  it("the rest of the app calls it Athlete Insights too", () => {
    expect(readFileSync("src/lib/posts-schedule.ts", "utf8")).toContain('insight: "Athlete Insight",');
    expect(readFileSync("src/components/community/posts-schedule.tsx", "utf8")).toContain('title="Athlete Insights"');
    expect(readFileSync("src/lib/post-scores.ts", "utf8")).toContain('daily_visual: "Athlete Insights",');
  });
});

describe("Athlete Insights in the anime house style", () => {
  const anime = readFileSync("supabase/migrations/20270212090000_athlete_insights_anime.sql", "utf8");
  it("only the two live posts the coach named and the ones still to come get the new look, captions kept", () => {
    expect(anime).toContain("SET regen = 'picture', regen_reason = 'restyle'");
    expect(anime).toContain("AND coalesce(v.concept->>'look', '') <> 'anime_v1'");
    expect(anime).toContain("(v.status = 'posted' AND v.day IN ('2026-11-06', '2026-11-07')");
    expect(anime).toContain("p.archived_at IS NULL");
    expect(anime).toContain("OR (v.status = 'ready' AND v.post_id IS NULL AND v.day >= public.instant_to_local(now(), 'America/Winnipeg')::date)");
    // no other table or column changes
    expect(anime).not.toMatch(/ALTER TABLE|CREATE OR REPLACE FUNCTION|DELETE FROM/);
  });
});
