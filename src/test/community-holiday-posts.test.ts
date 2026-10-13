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

  it("short, in the coach's texting voice, and the whole caption shows in the feed", () => {
    const short = read("supabase/migrations/20261117090000_community_holiday_posts_short.sql");
    const bodies = [...short.matchAll(/^  \('([a-z_]+)',\n'((?:[^']|'')*)'\)/gm)].map((m) => ({
      key: m[1],
      body: m[2].replace(/''/g, "'"),
    }));
    expect(bodies.map((b) => b.key).sort()).toEqual(holidays.map((h) => h.key).sort());
    expect(short).toContain("CHECK (char_length(body) <= 160)");
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
      "real talk",
      "one thing for today",
      "—",
      ";",
    ];
    for (const b of bodies) {
      expect(b.body.length, b.key).toBeLessThanOrEqual(160);
      // a happy-holiday + thanks line, then the one thing to do today
      expect(b.body.split("\n\n").length, b.key).toBe(2);
      // mostly lowercase, like a text (capitals only to stress a word)
      expect(b.body.replace(/ONE/g, ""), b.key).toBe(b.body.replace(/ONE/g, "").toLowerCase());
      for (const w of banned) expect(b.body.toLowerCase(), `${b.key}: ${w}`).not.toContain(w);
    }
    // never cut off with "more" in the feed
    expect(read("src/components/community/post-card.tsx")).toContain(
      'clamp && post.series !== "holiday" && "line-clamp-[8]"',
    );
  });
});
