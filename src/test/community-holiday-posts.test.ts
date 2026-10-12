import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { extraHoliday, extraScene } from "@/lib/community";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261114090000_community_holiday_posts.sql");
const holidays = [
  ...sql.matchAll(
    /^\('([a-z_]+)', '((?:[^']|'')*)', .*?'(\/community\/holidays\/[a-z_]+\.jpg)',\n'((?:[^']|'')*)'\)/gms,
  ),
].map((m) => ({
  key: m[1],
  image: m[3],
  body: m[4].replace(/''/g, "'"),
}));

describe("holiday posts", () => {
  it("once a year per holiday, 9 am to 9 pm Winnipeg, same pause switch and author as the daily posts", () => {
    expect(sql).toContain("v_key := 'holiday:' || h.key || ':' || v_year;");
    expect(sql).toContain(
      "IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;",
    );
    expect(sql).toContain("IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN");
    expect(sql).toContain("v_local::time < time '09:00' OR v_local::time >= time '21:00'");
    expect(sql).toContain(
      "PERFORM cron.schedule('community-holiday-posts', '*/15 * * * *', 'select public.community_publish_holiday();');",
    );
  });

  it("the picture reaches the app as series_extra", () => {
    expect(sql).toContain(
      "'tuesday_tips', 'try_it_thursday', 'saturday_spirit', 'holiday') THEN n.series_data END,",
    );
    expect(
      extraHoliday({
        holiday: "thanksgiving",
        name: "Thanksgiving",
        image: "/community/holidays/thanksgiving.jpg",
      }),
    ).toEqual({ name: "Thanksgiving", image: "/community/holidays/thanksgiving.jpg" });
    expect(
      extraHoliday({ holiday: "x", name: "X", image: "https://evil.example/x.jpg" }),
    ).toBeNull();
    expect(extraHoliday({ holiday: "x", name: "X", image: "/../x.jpg" })).toBeNull();
    expect(extraHoliday({ holiday: "x", name: "X" })).toBeNull();
    expect(extraHoliday({ scene: "iceberg" })).toBeNull();
    expect(extraScene({ holiday: "x", name: "X", image: "/a.jpg" })).toBeNull();
  });

  it("ten holidays, each with its photo in the app", () => {
    expect(holidays.map((h) => h.key)).toEqual([
      "new_year",
      "valentines",
      "easter",
      "mothers_day",
      "fathers_day",
      "canada_day",
      "labour_day",
      "thanksgiving",
      "halloween",
      "christmas",
    ]);
    for (const h of holidays) expect(existsSync(`public${h.image}`), h.image).toBe(true);
  });

  it("sounds like the coach: thanks, then one thing to do today, none of the banned words", () => {
    const banned = [
      "navigating",
      "it's clear that",
      "solid win",
      "momentum",
      "journey",
      "dial in",
      "keep it up",
      "significantly",
      "ensure",
      "crucial",
      "optimal",
      "prioritize",
      "—",
      ";",
    ];
    for (const h of holidays) {
      expect(h.body, h.key).toContain("one thing for today:");
      expect(h.body.length, h.key).toBeLessThanOrEqual(1200);
      for (const w of banned) expect(h.body.toLowerCase(), `${h.key}: ${w}`).not.toContain(w);
    }
  });
});
