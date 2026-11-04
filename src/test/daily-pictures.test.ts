import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DAILY_THEMES,
  DAILY_THEME_KEYS,
  FAITH_VERSES,
  LONG_LINE_MAX,
  SHORT_LINE_MAX,
  audienceForDay,
  dailyCaption,
  dailyLineProblems,
  dailyPicturePrompt,
  dailyWriterPrompt,
  learnDailyVisuals,
  learningsText,
  nextChoices,
  parseDailyWriter,
  pickVerse,
  themeForDow,
  visualScore,
  type VisualStat,
} from "@/lib/daily-visuals";
import { workOrder, type DailyRow } from "@/lib/daily-visuals.server";

const sql = readFileSync("supabase/migrations/20270124090000_daily_pictures.sql", "utf8");

const stat = (o: Partial<VisualStat>): VisualStat => ({
  day: "2026-11-01",
  theme: "courage",
  audience: "men",
  style: "photo",
  line: "start before youre ready",
  viewers: 6,
  likers: 1,
  commenters: 0,
  savers: 0,
  reached: 4,
  stopped: 3,
  median_ms: 4000,
  ...o,
});

describe("one theme a day, women and men in turn", () => {
  it("Monday courage … Sunday feelings & rest, the same order as the database", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(themeForDow)).toEqual([
      "courage",
      "patience",
      "your_circle",
      "self_reflection",
      "encouragement",
      "self_love",
      "emotional",
    ]);
    expect(sql).toContain(
      "(ARRAY['courage', 'patience', 'your_circle', 'self_reflection', 'encouragement', 'self_love', 'emotional'])[extract(isodow FROM _day)::int]",
    );
    for (const k of DAILY_THEME_KEYS) {
      expect(DAILY_THEMES[k].shots.women.length, k).toBeGreaterThanOrEqual(3);
      expect(DAILY_THEMES[k].shots.men.length, k).toBeGreaterThanOrEqual(3);
    }
  });

  it("the picture speaks to women one day and men the next, so each weekday swaps every week", () => {
    expect(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map(audienceForDay)).toEqual([
      "women",
      "men",
      "women",
      "men",
    ]);
    // next Monday is the other one
    expect(audienceForDay("2026-11-09")).toBe("men");
    expect(sql).toContain(
      "CASE WHEN (((_day - date '2026-01-05') % 2) + 2) % 2 = 0 THEN 'men' ELSE 'women' END",
    );
  });

  it("Sunday is the weekly faith post", () => {
    expect(DAILY_THEMES.emotional.dow).toBe(7);
    expect(sql).toContain("extract(isodow FROM d) = 7");
  });
});

describe("the faith post's verse is the Bible's words, never a model's", () => {
  it("a fixed list of King James verses, each once", () => {
    expect(FAITH_VERSES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(FAITH_VERSES.map((v) => v.ref)).size).toBe(FAITH_VERSES.length);
    expect(FAITH_VERSES.find((v) => v.ref === "Psalm 46:10")?.text).toBe(
      "Be still, and know that I am God",
    );
    expect(FAITH_VERSES.find((v) => v.ref === "Matthew 11:28")?.text).toBe(
      "Come unto me, all ye that labour and are heavy laden, and I will give you rest.",
    );
  });

  it("goes through every verse before one comes back", () => {
    const used: string[] = [];
    for (let i = 0; i < FAITH_VERSES.length; i++) used.push(pickVerse(used).ref);
    expect(new Set(used).size).toBe(FAITH_VERSES.length);
    // the next is the one used longest ago
    expect(pickVerse(used).ref).toBe(used[0]);
  });

  it("sits under his line with where it's from, the same in the app and the database", () => {
    expect(dailyCaption("rest is part of it 🙏", FAITH_VERSES[0])).toBe(
      "rest is part of it 🙏\n\n“Be still, and know that I am God” Psalm 46:10",
    );
    expect(dailyCaption("start scared")).toBe("start scared");
    expect(sql).toContain(
      "THEN E'\\n\\n' || '“' || btrim(r.verse_text) || '” ' || r.verse_ref ELSE '' END",
    );
  });

  it("the writer is told never to write one, and a line that mentions a verse is refused", () => {
    expect(dailyLineProblems("Psalm 46:10 says be still", 70)).toContain(
      "mentions a verse (the app adds it)",
    );
    expect(
      dailyWriterPrompt({
        theme: "emotional",
        audience: "women",
        style: "photo",
        maxChars: 70,
        faith: true,
        learnings: "",
        best: [],
        worst: [],
        recentLines: [],
        recentShots: [],
      }),
    ).toContain("SUNDAY: a Bible verse goes under your line");
  });
});

describe("the words: one short line in his voice", () => {
  it("passes a short real line and refuses hashtags, quotes, long lines and his never-say words", () => {
    expect(
      dailyLineProblems("you dont have to feel ready. you just have to start 💪", SHORT_LINE_MAX),
    ).toEqual([]);
    expect(dailyLineProblems("trust the journey #mindset", SHORT_LINE_MAX)).toEqual(
      expect.arrayContaining(["has a hashtag", 'says "journey"']),
    );
    expect(dailyLineProblems('"be patient" - someone', SHORT_LINE_MAX)).toContain("has a quote");
    expect(dailyLineProblems("x".repeat(SHORT_LINE_MAX + 1), SHORT_LINE_MAX)[0]).toContain(
      "characters",
    );
  });

  it("reads the writer's JSON, fenced or not", () => {
    expect(
      parseDailyWriter(
        '```json\n{"line": "slow is still moving", "picture": "a woman watering a plant"}\n```',
      ),
    ).toEqual({ line: "slow is still moving", picture: "a woman watering a plant" });
    expect(parseDailyWriter("no json here")).toBeNull();
  });

  it("the picture: the look, the person, the scene, no words in it, 4:5", () => {
    const p = dailyPicturePrompt({
      theme: "patience",
      audience: "women",
      style: "photo",
      shot: "a woman watering a plant on a windowsill",
      faith: false,
    });
    expect(p).toContain("The person is a woman");
    expect(p).toContain("a woman watering a plant on a windowsill");
    expect(p).toContain("Vertical 4:5 portrait framing");
    expect(p).toContain("Absolutely no text");
    expect(p).toContain("never posing or looking at the camera");
    expect(
      dailyPicturePrompt({
        theme: "emotional",
        audience: "men",
        style: "illustration",
        shot: "x",
        faith: true,
      }),
    ).toContain("any Bible stays closed");
  });
});

describe("it learns what the crew likes", () => {
  it("starts on clean photos and short lines until there's enough to tell", () => {
    const l = learnDailyVisuals([]);
    expect(nextChoices(l, () => 0.9)).toMatchObject({ style: "photo", maxChars: SHORT_LINE_MAX });
    expect(learningsText(l)).toContain("Not enough posted yet");
  });

  it("goes with what's doing better once both sides have posts, and still tries the other sometimes", () => {
    const liked = (o: Partial<VisualStat>) => stat({ likers: 4, commenters: 1, ...o });
    const flat = (o: Partial<VisualStat>) => stat({ likers: 0, stopped: 1, ...o });
    const stats = [
      ...[1, 2, 3].map((i) =>
        liked({ day: `2026-10-0${i}`, line: "x".repeat(100), style: "illustration" }),
      ),
      ...[4, 5, 6].map((i) => flat({ day: `2026-10-0${i}`, line: "short one", style: "photo" })),
    ];
    const l = learnDailyVisuals(stats);
    expect(nextChoices(l, () => 0.9)).toMatchObject({
      style: "illustration",
      maxChars: LONG_LINE_MAX,
    });
    // exploring: the other look / length
    expect(nextChoices(l, () => 0.01)).toMatchObject({ style: "photo", maxChars: SHORT_LINE_MAX });
    expect(learningsText(l)).toContain("Longer lines are doing");
    expect(learningsText(l)).toContain("Drawings are doing");
    expect(l.best[0].likers).toBe(4);
  });

  it("a comment or a save counts more than a like, and stopping on it counts", () => {
    expect(visualScore(stat({ likers: 0, commenters: 1 }))).toBeGreaterThan(
      visualScore(stat({ likers: 1 })),
    );
    expect(visualScore(stat({ stopped: 4, reached: 4 }))).toBeGreaterThan(
      visualScore(stat({ stopped: 0, reached: 4 })),
    );
  });
});

describe("the background writer and the 7 am post", () => {
  it("does today and the days ahead first, then fills in the days just missed", () => {
    const row = (day: string) => ({ day }) as DailyRow;
    expect(
      workOrder(
        [row("2026-11-02"), row("2026-11-05"), row("2026-11-04"), row("2026-11-03")],
        "2026-11-04",
      ).map((r) => r.day),
    ).toEqual(["2026-11-04", "2026-11-05", "2026-11-03", "2026-11-02"]);
  });

  it("posts today's at 7 (Winnipeg) once it's ready, wakes the writer only when there's work, and the coach steers it", () => {
    expect(sql).toContain("'daily_visual'])));");
    expect(sql).toContain("IF v_local::time < time '07:00' OR v_local::time >= time '21:00'");
    expect(sql).toContain(
      "v.day BETWEEN v_today - 3 AND v_today + 2 AND v.status = 'planned' AND v.attempts < 4",
    );
    expect(sql).toContain(
      "$cmd$select public.community_publish_daily_visual(); select public.community_daily_visuals_kick(false);$cmd$",
    );
    // a missed day goes in at 7 am on its own day
    expect(sql).toContain("public.local_to_instant(_day + time '07:00', 'America/Winnipeg')");
    // the coach's own words win, and posting stops with the rest of the coach posts
    expect(sql).toContain("btrim(coalesce(nullif(btrim(r.coach_line), ''), r.ai_line))");
    expect(sql).toContain(
      "IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;",
    );
    // staff only, the coaches never counted in what it learns from
    expect(sql).toContain(
      'CREATE POLICY "Staff read daily pictures" ON public.community_daily_visuals',
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.community_daily_visual_stats(int) FROM PUBLIC, anon, authenticated;",
    );
    expect(sql).toContain(
      "WITH staff AS (SELECT s AS user_id FROM public.community_staff_people() s WHERE s IS NOT NULL)",
    );
  });

  it("the hook is in the route tree and the coach sees the week in Crew → Posts", () => {
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain(
      "'/api/public/hooks/daily-visuals-tick'",
    );
    expect(readFileSync("src/components/community/coach-weekly-posts.tsx", "utf8")).toContain(
      "<DailyPicturesCard />",
    );
  });
});
