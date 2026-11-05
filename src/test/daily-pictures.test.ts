import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DAILY_FORMATS,
  DAILY_STYLES,
  DAILY_STYLE_KEYS,
  DAILY_THEMES,
  DAILY_THEME_KEYS,
  FAITH_VERSES,
  JF_LOOK,
  REVIEW_BARS,
  audienceForDay,
  captionProblems,
  captionSimilarity,
  conceptPrompt,
  dailyCaption,
  learnDailyVisuals,
  learningsText,
  parseCaption,
  parseConcept,
  parseReview,
  pickChoices,
  pickVerse,
  picturePrompt,
  repeatsNearby,
  reviewScore,
  reviewVerdict,
  themeForDow,
  typographyProblems,
  visualScore,
  type Review,
  type VisualStat,
} from "@/lib/daily-visuals";
import { isDue, makerFor, workOrder } from "@/lib/daily-visuals.server";

const first = readFileSync("supabase/migrations/20270124090000_daily_pictures.sql", "utf8");
const sql = readFileSync("supabase/migrations/20270125090000_daily_pictures_rebuild.sql", "utf8");
const server = readFileSync("src/lib/daily-visuals.server.ts", "utf8");

const stat = (o: Partial<VisualStat>): VisualStat => ({
  day: "2026-11-01",
  theme: "courage",
  audience: "men",
  style: "cinematic_photo",
  format: "observation",
  topic: "confidence",
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

const review = (o: Partial<Review> = {}): Review => ({
  text_seen: "",
  defects: [],
  scores: { relatable: 5, original: 4, writing: 4, audience_fit: 4, aesthetic: 5, storytelling: 4, match: 5, engaging: 4 },
  fix_image: "",
  fix_caption: "",
  ...o,
});

describe("the week: a lens a day, women, men and everyone in turn", () => {
  it("Monday courage … Sunday feelings & rest, the same order as the database", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(themeForDow)).toEqual(["courage", "patience", "your_circle", "self_reflection", "encouragement", "self_love", "emotional"]);
    expect(first).toContain("(ARRAY['courage', 'patience', 'your_circle', 'self_reflection', 'encouragement', 'self_love', 'emotional'])[extract(isodow FROM _day)::int]");
    for (const k of DAILY_THEME_KEYS) expect(DAILY_THEMES[k].topics.length, k).toBeGreaterThanOrEqual(3);
  });

  it("speaks to women, men, then everyone, so each weekday changes every week (the same in SQL)", () => {
    expect(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map(audienceForDay)).toEqual(["men", "everyone", "women", "men"]);
    // next Monday is someone else
    expect(audienceForDay("2026-11-09")).toBe("everyone");
    expect(sql).toContain("SELECT (ARRAY['women', 'men', 'everyone'])[((((_day - date '2026-01-05') % 3) + 3) % 3) + 1]");
  });

  it("twelve art styles and six caption forms, each with its own look and length", () => {
    expect(DAILY_STYLE_KEYS).toHaveLength(12);
    for (const k of DAILY_STYLE_KEYS) expect(sql, k).toContain(`'${k}'`);
    expect(Object.keys(DAILY_FORMATS)).toEqual(["one_liner", "observation", "short_story", "humor", "scenario", "encouragement"]);
    expect(DAILY_FORMATS.one_liner.max).toBeLessThan(DAILY_FORMATS.short_story.max);
  });
});

describe("the faith post's verse is the Bible's words, never a model's", () => {
  it("a fixed list of King James verses, each once", () => {
    expect(FAITH_VERSES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(FAITH_VERSES.map((v) => v.ref)).size).toBe(FAITH_VERSES.length);
    expect(FAITH_VERSES.find((v) => v.ref === "Psalm 46:10")?.text).toBe("Be still, and know that I am God");
    expect(FAITH_VERSES.find((v) => v.ref === "Matthew 11:28")?.text).toBe("Come unto me, all ye that labour and are heavy laden, and I will give you rest.");
  });

  it("goes through every verse before one comes back", () => {
    const used: string[] = [];
    for (let i = 0; i < FAITH_VERSES.length; i++) used.push(pickVerse(used).ref);
    expect(new Set(used).size).toBe(FAITH_VERSES.length);
    expect(pickVerse(used).ref).toBe(used[0]);
  });

  it("sits under the caption with where it's from, the same in the app and the database", () => {
    expect(dailyCaption("rest is part of it", FAITH_VERSES[0])).toBe("rest is part of it\n\n“Be still, and know that I am God” Psalm 46:10");
    expect(sql).toContain("THEN E'\\n\\n' || '“' || btrim(_verse_text) || '” ' || _verse_ref ELSE '' END");
    // the writer never writes one: a caption that names a verse is refused
    expect(captionProblems("psalm 46:10 says be still. so be still today and rest well", { format: "observation" })).toContain("mentions a verse (the app adds it)");
  });
});

describe("captions: relatable, plain, his voice, never a rerun", () => {
  const good = "you know that moment in the car before the gym\nwhen you almost drive home instead\n\nthat moment is the whole workout. the rest is just walking in";

  it("passes a real moment told plainly", () => {
    expect(captionProblems(good, { format: "scenario" })).toEqual([]);
  });

  it("refuses slogans, hashtags, tags, quotes, too many emojis and the wrong length for its form", () => {
    const p = captionProblems("trust the process #grind 💪🔥 @marc said “go”", { format: "one_liner" });
    expect(p).toEqual(expect.arrayContaining(['says "trust the process" (a slogan)', "has a hashtag", "tags someone", "has quotation marks", "more than one emoji"]));
    expect(captionProblems(good, { format: "one_liner" })[0]).toContain("a one line is 130 at most");
    expect(captionProblems("start", { format: "short_story" })[0]).toContain("needs 140 or more");
  });

  it("never comes back close to a recent post, or opens like the days around it", () => {
    const recent = ["you know that moment in the car before the gym when you nearly turn around"];
    expect(captionSimilarity(good, recent[0])).toBeGreaterThan(0.3);
    expect(captionProblems(good, { format: "scenario", recent })[0]).toContain("too close to a recent post");
    expect(captionProblems(good, { format: "scenario", near: ["you showed up all week"] })).toContain('opens with "you" like a day near it');
    expect(repeatsNearby("slow is still moving 🌱", ["honestly the crew 🤝"])).toBeNull();
  });

  it("words in a picture stay few and plain enough for an image model to spell", () => {
    expect(typographyProblems("")).toEqual([]);
    expect(typographyProblems("still here")).toEqual([]);
    expect(typographyProblems("one two three four five six seven eight")).toContain("more than 7 words in the picture");
    expect(typographyProblems("rest → reset")).toContain("characters in the picture an image model gets wrong");
  });
});

describe("the concept comes first", () => {
  const choices = { styles: ["watercolor", "comic"] as const, formats: ["humor", "observation"] as const, topics: ["burnout", "overwhelm"] as const };

  it("reads the concept, holding its choices to the lists it was given", () => {
    const c = parseConcept(
      '```json\n{"topic": "burnout", "situation": "s", "tension": "t", "message": "m", "format": "essay", "style": "oil painting", "visual": "v", "typography": "\\"still here\\"", "caption": "c"}\n```',
      { styles: [...choices.styles], formats: [...choices.formats], topics: [...choices.topics] },
    );
    expect(c).toMatchObject({ topic: "burnout", format: "humor", style: "watercolor", typography: "still here", caption: "c" });
    expect(parseConcept("no json", { styles: ["comic"], formats: ["humor"], topics: ["burnout"] })).toBeNull();
  });

  it("is told the day, who it's for, what's worked, what to avoid and what the coach threw out", () => {
    const p = conceptPrompt({
      theme: "emotional",
      audience: "everyone",
      faith: true,
      choices: { styles: [...choices.styles], formats: [...choices.formats], topics: [...choices.topics] },
      learnings: "Best looks so far: watercolour.",
      best: ["liked line"],
      worst: [],
      recent: [{ day: "2026-11-07", topic: "burnout", format: "humor", style: "comic", caption: "recent one" }],
      rejected: ["thrown out line"],
    });
    expect(p).toContain("TODAY'S LENS: Feelings & rest.");
    expect(p).toContain("SUNDAY: a Bible verse goes under the caption.");
    expect(p).toContain("POSTS THEY LIKED MOST:\n- liked line");
    expect(p).toContain("RECENT POSTS (make yours different in every way):\n- 2026-11-07 · burnout · humor · comic: recent one");
    expect(p).toContain("THE COACH THREW THESE OUT (never write like them):\n- thrown out line");
    expect(conceptPrompt({ theme: "courage", audience: "men", faith: false, choices: { styles: ["comic"], formats: ["humor"], topics: ["confidence"] }, learnings: "", best: [], worst: [], recent: [], keep: { caption: "keep me" } })).toContain(
      "KEEP THIS CAPTION EXACTLY, word for word",
    );
  });

  it("the picture: its style, the JF Effect look, the words in it spelled exactly or none at all", () => {
    const withWords = picturePrompt({ style: "typography", visual: "a sand background", typography: "still here", message: "m" });
    expect(withWords).toContain(DAILY_STYLES.typography.look);
    expect(withWords).toContain(JF_LOOK);
    expect(withWords).toContain("The only text in the image is exactly this, spelled exactly, clean and fully legible: still here.");
    const none = picturePrompt({ style: "cinematic_photo", visual: "a car in a gym lot at dawn", typography: "", message: "m" }, { faith: true, fix: "the hands looked wrong" });
    expect(none).toContain("Absolutely no text, letters, numbers, signs, logos or watermarks");
    expect(none).toContain("never posing or looking at the camera");
    expect(none).toContain("any Bible stays closed");
    expect(none).toContain("Fix from the last try: the hands looked wrong");
    expect(none).toContain("middle 80% of the height");
  });
});

describe("the review: concrete checks before any score", () => {
  it("passes a clean picture whose words read exactly as asked", () => {
    expect(reviewVerdict(review({ text_seen: "Still here." }), "still here")).toEqual({ pass: true, image: [], caption: [] });
    expect(reviewVerdict(review(), "").pass).toBe(true);
  });

  it("fails misspelled, missing or extra words, any defect, and scores under the bar, on the right side", () => {
    expect(reviewVerdict(review({ text_seen: "Stil heer" }), "still here").image[0]).toContain('read "Stil heer", not "still here"');
    expect(reviewVerdict(review({ text_seen: "SALE" }), "").image[0]).toContain("words that shouldn't be there");
    expect(reviewVerdict(review({ defects: ["six fingers on the left hand"] }), "").image).toContain("six fingers on the left hand");
    const low = reviewVerdict(review({ scores: { ...review().scores, writing: 2, aesthetic: 3 }, fix_caption: "say it plainer" }), "");
    expect(low.pass).toBe(false);
    expect(low.caption).toEqual(["writing 2/5", "fix: say it plainer"]);
    expect(low.image).toEqual(["aesthetic 3/5"]);
    expect(REVIEW_BARS.match).toBe(4);
  });

  it("a defect is an objective error, never taste (taste is scored and goes in the fix)", async () => {
    const { REVIEW_PROMPT } = await import("@/lib/daily-visuals");
    expect(REVIEW_PROMPT).toContain("Taste is never a defect (a slightly stock look, the framing, the lighting, empty space, what could be clearer)");
    expect(REVIEW_PROMPT).toContain("4 = good enough to publish");
  });

  it("reads the reviewer's JSON and averages its scores", () => {
    const r = parseReview('{"text_seen": "", "defects": [], "scores": {"relatable": 5, "original": 4, "writing": 4, "audience_fit": 4, "aesthetic": 5, "storytelling": 4, "match": 5, "engaging": 9}}');
    expect(r?.scores.engaging).toBe(5);
    expect(reviewScore(r!)).toBe(4.5);
    expect(parseCaption('{"caption": "\\"new words\\""}')).toBe("new words");
  });
});

describe("it learns what the crew likes, and never repeats itself", () => {
  it("doesn't reuse a style from the last 4 days, a form from the last 2 or a topic from the last 10", () => {
    const l = learnDailyVisuals([]);
    const recent = [
      { day: "2026-11-01", style: "watercolor", format: "humor", topic: "confidence" },
      { day: "2026-11-02", style: "comic", format: "observation", topic: "ambition" },
    ];
    const c = pickChoices(l, "courage", recent, () => 0.9);
    expect(c.styles).not.toContain("watercolor");
    expect(c.styles).not.toContain("comic");
    expect(c.formats).not.toContain("humor");
    expect(c.topics).not.toContain("confidence");
    expect(c.topics.every((t) => DAILY_THEMES.courage.topics.includes(t))).toBe(true);
    // the coach's pick wins
    expect(pickChoices(l, "courage", recent, () => 0.9, "watercolor").styles).toEqual(["watercolor"]);
    expect(learningsText(l)).toContain("Not enough posted yet");
  });

  it("goes with what's working once it has posts, and still tries the untried sometimes", () => {
    const stats = [1, 2, 3].map((i) => stat({ day: `2026-10-0${i}`, style: "watercolor", likers: 4, commenters: 1 }));
    stats.push(...[4, 5, 6].map((i) => stat({ day: `2026-10-0${i}`, style: "comic", likers: 0, stopped: 0 })));
    const l = learnDailyVisuals(stats);
    expect(pickChoices(l, "courage", [], () => 0.9).styles[0]).toBe("watercolor");
    expect(pickChoices(l, "courage", [], () => 0.9).styles.at(-1)).toBe("comic");
    expect(pickChoices(l, "courage", [], () => 0.01).styles[0]).not.toBe("watercolor");
    expect(learningsText(l)).toContain("Best looks so far: watercolour");
  });

  it("a comment or a save counts more than a like, and stopping on it counts", () => {
    expect(visualScore(stat({ likers: 0, commenters: 1 }))).toBeGreaterThan(visualScore(stat({ likers: 1 })));
    expect(visualScore(stat({ stopped: 4, reached: 4 }))).toBeGreaterThan(visualScore(stat({ stopped: 0, reached: 4 })));
  });
});

describe("the maker: OpenAI, never Lovable AI unless the coach allows it", () => {
  it("uses OpenAI when there's a key, Lovable only when allowed, and otherwise says why", () => {
    expect((makerFor(false, { OPENAI_API_KEY: "k", LOVABLE_API_KEY: "l" }) as any).provider).toBe("openai");
    expect(makerFor(false, { LOVABLE_API_KEY: "l" })).toEqual({ blocked: "No OpenAI key (OPENAI_API_KEY) is set up, and Lovable AI is off for daily pictures." });
    expect((makerFor(true, { LOVABLE_API_KEY: "l" }) as any).provider).toBe("lovable");
    expect(server).toContain("picture: (p) => generatePicture(p, { lovable: false }),");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS daily_visuals_lovable boolean NOT NULL DEFAULT false;");
  });

  it("does the days not out yet first, soonest first, then the ones already out, latest first", () => {
    const row = (day: string, status = "ready") => ({ day, status });
    expect(workOrder([row("2026-11-02", "posted"), row("2026-11-07"), row("2026-11-05", "posted"), row("2026-11-06")], "2026-11-05").map((r) => r.day)).toEqual([
      "2026-11-06",
      "2026-11-07",
      "2026-11-05",
      "2026-11-02",
    ]);
  });

  it("works only on queued days, never a skipped one, and waits 20 minutes after a failure", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    const base = { regen: "full" as const, status: "ready" as const, attempts: 0, updated_at: "2026-11-05T11:59:00Z" };
    expect(isDue(base, now)).toBe(true);
    expect(isDue({ ...base, regen: null }, now)).toBe(false);
    expect(isDue({ ...base, status: "skipped" as any }, now)).toBe(false);
    expect(isDue({ ...base, attempts: 1 }, now)).toBe(false);
    expect(isDue({ ...base, attempts: 1, updated_at: "2026-11-05T11:30:00Z" }, now)).toBe(true);
  });
});

describe("nothing is lost, and a post that's out changes in place", () => {
  it("every replaced version is kept by a trigger, whatever replaced it", () => {
    expect(sql).toContain("BEFORE UPDATE OF ai_line, coach_line, picture ON public.community_daily_visuals");
    expect(sql).toContain("coalesce(nullif(current_setting('jf.daily_visual_reason', true), ''), 'replaced'), auth.uid());");
    expect(sql).toContain('CREATE POLICY "Staff read daily picture versions" ON public.community_daily_visual_versions');
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.community_daily_visual_versions FROM anon, authenticated;");
  });

  it("a remake goes live in one step, only from the server, and a posted one keeps its id, date and likes", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.community_daily_visual_apply(_id uuid, _patch jsonb)");
    expect(sql).toContain("IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_daily_visual_apply(uuid, jsonb) FROM PUBLIC, anon, authenticated;");
    // the same post: its words and picture replaced, its updated_at put back so it never moves
    expect(sql).toContain("UPDATE public.community_posts SET updated_at = v_updated WHERE id = r.post_id;");
    expect(sql).not.toMatch(/INSERT INTO public\.community_posts[^;]*sync/);
    // restoring puts back the words exactly as people saw them
    expect(sql).toContain("PERFORM public.community_daily_visual_sync_post(r.id, x.caption);");
  });

  it("the coach approves, rejects, remakes the whole post, the words or the picture, in a style he picks", () => {
    expect(sql).toContain("IF v_action IN ('full', 'caption', 'picture', 'reject') THEN");
    expect(sql).toContain("regen_reason = CASE WHEN v_action = 'reject' THEN 'rejected' ELSE 'coach' END,");
    expect(sql).toContain("IF v_action IN ('approve', 'unapprove') THEN");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.community_daily_visual_act(uuid, text, text);");
    expect(sql).toContain("v_action text := CASE WHEN _action = 'words' THEN 'caption' ELSE _action END;");
  });

  it("every day there is gets remade, the originals kept, and a failure keeps what was there", () => {
    expect(sql).toContain("regen_reason = CASE WHEN ai_line IS NULL AND coach_line IS NULL AND picture IS NULL THEN 'new' ELSE 'rebuild' END,");
    expect(server).toContain("error: (kept ? `Kept what was there: ${reason}` : `Couldn't make it: ${reason}`).slice(0, 500),");
    // a remake is built on the side and never shown until it passes
    expect(server).toContain('const { error } = await admin.rpc("community_daily_visual_apply", { _id: r.id, _patch: JSON.parse(JSON.stringify(patch)) });');
  });

  it("with no AI set up the job checks once an hour, and the hook and the coach's card are wired in", () => {
    expect(sql).toContain("IF v_status->>'blocked' IS NOT NULL AND (v_status->>'at')::timestamptz > now() - interval '1 hour' THEN RETURN false; END IF;");
    expect(sql).toContain("$cmd$select public.community_publish_daily_visual(); select public.community_daily_visuals_kick(false);$cmd$");
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain("'/api/public/hooks/daily-visuals-tick'");
    expect(readFileSync("src/components/community/coach-weekly-posts.tsx", "utf8")).toContain("<DailyPicturesCard />");
  });
});
