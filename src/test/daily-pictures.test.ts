import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DAILY_FORMATS,
  DAILY_STYLES,
  DAILY_STYLE_KEYS,
  DAILY_THEMES,
  DAILY_THEME_KEYS,
  FAITH_VERSES,
  FILM_AVOID,
  FILM_LOOK,
  DAILY_LIGHTS,
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
const film = readFileSync("supabase/migrations/20270126090000_daily_pictures_2d_film.sql", "utf8");
const vivid = readFileSync("supabase/migrations/20270127090000_daily_pictures_vivid.sql", "utf8");
const server = readFileSync("src/lib/daily-visuals.server.ts", "utf8");

const stat = (o: Partial<VisualStat>): VisualStat => ({
  day: "2026-11-01",
  theme: "courage",
  audience: "men",
  style: "medium_candid",
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
  colour: "vibrant",
  clarity: "crisp",
  medium: "hand_drawn_2d",
  description: "",
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
    // one look (a hand-drawn 2D film frame), the variety in the shot and the light
    expect(DAILY_STYLE_KEYS).toHaveLength(12);
    expect(Object.keys(DAILY_LIGHTS)).toHaveLength(9);
    for (const k of DAILY_STYLE_KEYS) expect(vivid, k).toContain(`'${k}'`);
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
    expect(captionProblems(good, { format: "scenario", near: ["you know what the gym at 6 am feels like"] })).toContain('opens with "you know" like a day near it');
    // a common first word alone isn't a template: "you know" and "you showed" open differently
    expect(repeatsNearby(good, ["you showed up all week"])).toBeNull();
    expect(repeatsNearby("honestly the crew carried me", ["honestly just show up"])).toContain('opens with "honestly"');
    expect(repeatsNearby("slow is still moving 🌱", ["honestly the crew 🤝"])).toBeNull();
  });

  it("words in a picture stay few and plain enough for an image model to spell", () => {
    expect(typographyProblems("")).toEqual([]);
    expect(typographyProblems("still here")).toEqual([]);
    // a text message can carry a whole line, no more
    expect(typographyProblems("leaving now, be there in 10, save me the bench")).toEqual([]);
    expect(typographyProblems("one two three four five six seven eight nine ten eleven twelve thirteen")).toContain("more than 12 words in the picture");
    expect(typographyProblems("rest → reset")).toContain("characters in the picture an image model gets wrong");
  });
});

describe("the concept comes first", () => {
  const choices = { styles: ["backlit", "two_frames"] as const, lights: ["neon_night", "golden_teal"] as const, formats: ["humor", "observation"] as const, topics: ["burnout", "overwhelm"] as const };

  it("reads the concept, holding its choices to the lists it was given", () => {
    const c = parseConcept(
      '```json\n{"topic": "burnout", "situation": "s", "tension": "t", "message": "m", "format": "essay", "style": "oil painting", "light": "golden_teal", "visual": "v", "typography": "\\"still here\\"", "caption": "c"}\n```',
      { styles: [...choices.styles], lights: [...choices.lights], formats: [...choices.formats], topics: [...choices.topics] },
    );
    // no art direction given: a burnout story leans to B, the cinematic anime
    expect(c).toMatchObject({ topic: "burnout", format: "humor", style: "backlit", light: "golden_teal", art: "anime", typography: "still here", caption: "c" });
    expect(parseConcept("no json", { styles: ["two_frames"], formats: ["humor"], topics: ["burnout"] })).toBeNull();
  });

  it("is told the day, who it's for, what's worked, what to avoid and what the coach threw out", () => {
    const p = conceptPrompt({
      theme: "emotional",
      audience: "everyone",
      faith: true,
      choices: { styles: [...choices.styles], lights: [...choices.lights], formats: [...choices.formats], topics: [...choices.topics] },
      learnings: "Best shots so far: backlit.",
      best: ["liked line"],
      worst: [],
      recent: [{ day: "2026-11-07", topic: "burnout", format: "humor", style: "two_frames", light: "warm_lamp", caption: "recent one" }],
      rejected: ["thrown out line"],
    });
    expect(p).toContain("TODAY'S LENS: Feelings & rest.");
    expect(p).toContain("SUNDAY: a Bible verse goes under the caption.");
    expect(p).toContain("POSTS THEY LIKED MOST:\n- liked line");
    expect(p).toContain("RECENT POSTS (make yours different in every way):\n- 2026-11-07 · burnout · humor · two_frames · warm_lamp: recent one");
    expect(p).toContain("SHOTS, as \"style\" (pick the one that tells this story best, best performers first): backlit = ");
    expect(p).toContain('COLOUR AND LIGHT, as "light" (pick the one that fits the moment): neon_night = ');
    expect(p).toContain('ART DIRECTION, as "art" (pick the one that tells this story best): graphic = A · Vibrant graphic 2D, for fitness');
    expect(p).toContain("THE COACH THREW THESE OUT (never write like them):\n- thrown out line");
    expect(conceptPrompt({ theme: "courage", audience: "men", faith: false, choices: { styles: ["two_frames"], lights: ["golden_teal"], formats: ["humor"], topics: ["confidence"] }, learnings: "", best: [], worst: [], recent: [], keep: { caption: "keep me" } })).toContain(
      "KEEP THIS CAPTION EXACTLY, word for word",
    );
  });

  it("the picture: always a hand-drawn 2D film frame, its shot and light, the words in it spelled exactly or none at all", () => {
    const withWords = picturePrompt({ style: "two_frames", light: "neon_night", art: "anime", visual: "a speech bubble from her sister", typography: "you went?? proud of you", message: "m" });
    expect(withWords.startsWith(FILM_LOOK)).toBe(true);
    expect(withWords).toContain(`The shot: ${DAILY_STYLES.two_frames.look}`);
    expect(withWords).toContain(`Colour and light: ${DAILY_LIGHTS.neon_night.look}.`);
    expect(withWords).toContain("Art direction B, beautiful cinematic 2D anime");
    expect(withWords).toContain("spelled exactly and clearly readable: you went?? proud of you.");
    expect(withWords).toContain(FILM_AVOID);
    expect(FILM_LOOK).toContain("colourful, hand-drawn 2D animated feature film");
    expect(FILM_LOOK).toContain("rich, vibrant, saturated colour with strong warm-versus-cool contrast");
    expect(FILM_AVOID).toContain("brown or grey colour grading, desaturated or muted colour, a dark, gloomy or murky scene");
    expect(FILM_AVOID).toContain("3D, CGI or Pixar-like rendering");
    const none = picturePrompt({ style: "wide_moment", visual: "a car in a gym lot at dawn", typography: "", message: "m" }, { faith: true, fix: "the hands looked wrong" });
    expect(none).toContain("No words, letters, numbers, signs, logos or watermarks anywhere in the frame");
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
    // an apostrophe the picture added is the same word, and words the planned scene names aren't stray
    expect(reviewVerdict(review({ text_seen: "who are you\nwhen it's quiet?\n5:30 AM" }), "who are you when its quiet?", "a phone alarm set for 5:30 AM").pass).toBe(true);
    expect(reviewVerdict(review({ text_seen: "who are you when its quiet? SALE" }), "who are you when its quiet?", "a phone alarm").image[0]).toContain("extra words in the picture");
    // a phone's clock isn't stray text
    expect(reviewVerdict(review({ text_seen: "boss: quick thing for monday?\n11:23 PM" }), "boss: quick thing for monday?", "").pass).toBe(true);
    expect(reviewVerdict(review({ defects: ["six fingers on the left hand"] }), "").image).toContain("six fingers on the left hand");
    const low = reviewVerdict(review({ scores: { ...review().scores, writing: 2, aesthetic: 3 }, fix_caption: "say it plainer" }), "");
    expect(low.pass).toBe(false);
    expect(low.caption).toEqual(["writing 2/5", "fix: say it plainer"]);
    expect(low.image).toEqual(["aesthetic 3/5"]);
    expect(REVIEW_BARS.match).toBe(4);
  });

  it("anything that doesn't read as a hand-drawn 2D film frame fails, whatever its scores", () => {
    expect(reviewVerdict(review({ medium: "3d_render" }), "").image[0]).toBe("it reads as 3d render, not a hand-drawn 2D film frame");
    expect(reviewVerdict(review({ medium: "photo" }), "").pass).toBe(false);
    expect(reviewVerdict(review({ medium: "" }), "").pass).toBe(false);
    expect(parseReview('{"medium": "Hand-drawn 2D", "scores": {}}')?.medium).toBe("hand_drawn_2d");
    expect(parseReview('{"medium": "3D render", "scores": {}}')?.medium).toBe("3d_render");
  });

  it("a defect is an objective error, never taste (taste is scored and goes in the fix)", async () => {
    const { REVIEW_PROMPT } = await import("@/lib/daily-visuals");
    expect(REVIEW_PROMPT).toContain("Taste is never a defect (a slightly stock look, the framing, the lighting, empty space, what could be clearer)");
    expect(REVIEW_PROMPT).toContain("4 = good enough to publish");
    // the caption and the picture tell one story: a contradiction in the details fails match
    expect(REVIEW_PROMPT).toContain("any contradiction, like a text in the picture while the caption says they heard it, or another place, time or person, is 3 or less");
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
      { day: "2026-11-01", style: "backlit", light: "golden_teal", format: "humor", topic: "confidence" },
      { day: "2026-11-02", style: "two_frames", light: "neon_night", format: "observation", topic: "ambition" },
    ];
    const c = pickChoices(l, "courage", recent, () => 0.9);
    expect(c.styles).not.toContain("backlit");
    expect(c.styles).not.toContain("two_frames");
    expect(c.lights).not.toContain("golden_teal");
    expect(c.lights).toHaveLength(7);
    expect(c.formats).not.toContain("humor");
    expect(c.topics).not.toContain("confidence");
    expect(c.topics.every((t) => DAILY_THEMES.courage.topics.includes(t))).toBe(true);
    // the coach's pick wins
    expect(pickChoices(l, "courage", recent, () => 0.9, "backlit").styles).toEqual(["backlit"]);
    expect(learningsText(l)).toContain("Not enough posted yet");
  });

  it("goes with what's working once it has posts, and still tries the untried sometimes", () => {
    const stats = [1, 2, 3].map((i) => stat({ day: `2026-10-0${i}`, style: "backlit", likers: 4, commenters: 1 }));
    stats.push(...[4, 5, 6].map((i) => stat({ day: `2026-10-0${i}`, style: "two_frames", likers: 0, stopped: 0 })));
    const l = learnDailyVisuals(stats);
    expect(pickChoices(l, "courage", [], () => 0.9).styles[0]).toBe("backlit");
    expect(pickChoices(l, "courage", [], () => 0.9).styles.at(-1)).toBe("two_frames");
    expect(pickChoices(l, "courage", [], () => 0.01).styles[0]).not.toBe("backlit");
    expect(learningsText(l)).toContain("Best shots so far: backlit");
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
    expect(server).toContain("picture: (p, refs) => (refs?.length ? generatePictureWithRefs(p, refs) : generatePicture(p, { lovable: false })),");
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

describe("the 2D film look reaches every day, tested first", () => {
  it("test posts run the whole pipeline and never touch a day or the feed", () => {
    expect(server).toContain("export async function runDailyVisualTest(");
    expect(server).toContain('await admin.from("community_daily_visual_tests").insert({ data: test });');
    expect(film).toContain('CREATE POLICY "Staff read daily picture tests" ON public.community_daily_visual_tests');
    expect(film).toContain("REVOKE INSERT, UPDATE, DELETE ON public.community_daily_visual_tests FROM anon, authenticated;");
    expect(readFileSync("src/routes/api/public/hooks/daily-visuals-tick.ts", "utf8")).toContain("runDailyVisualTest(supabaseAdmin as any, body.test)");
  });

  it("every day there is gets its picture remade with its caption kept, the before kept as a version", () => {
    expect(film).toContain("SET regen = CASE WHEN day = date '2026-11-05' THEN 'full' ELSE 'picture' END,");
    expect(film).toContain("regen_reason = 'restyle'");
    expect(film).toContain("AND coalesce(concept->>'look', '') <> '2d_film';");
    expect(server).toContain("look: FILM_LOOK_VERSION,");
  });
});

describe("the vivid look: bright, colourful, crisp 2D film frames", () => {
  it("never asks for the muddy, dark or soft look of the first tries", () => {
    for (const bad of ["painterly shading", "soft painted", "sophisticated colour", "subtle linework", "dark room", "deep shadow", "muted and calm"]) {
      expect(FILM_LOOK, bad).not.toContain(bad);
      for (const l of Object.values(DAILY_LIGHTS)) expect(l.look, bad).not.toContain(bad);
    }
    // no shot built around someone staring at a phone
    expect(Object.keys(DAILY_STYLES)).not.toContain("phone_story");
    for (const s of Object.values(DAILY_STYLES)) expect(s.look).not.toMatch(/\bphone\b/);
  });

  it("two art directions, each for its kind of story", async () => {
    const { ART_STYLES, artForTopic } = await import("@/lib/daily-visuals");
    expect(Object.keys(ART_STYLES)).toEqual(["graphic", "anime"]);
    expect(artForTopic("discipline")).toBe("graphic");
    expect(artForTopic("relationships")).toBe("anime");
  });

  it("muted, dark or soft pictures fail whatever their scores", () => {
    expect(reviewVerdict(review({ colour: "muted" }), "").image[0]).toBe("its colour reads as muted, not vibrant");
    expect(reviewVerdict(review({ colour: "dark" }), "").pass).toBe(false);
    expect(reviewVerdict(review({ clarity: "soft" }), "").image[0]).toBe("its faces and lines read as soft, not crisp");
    expect(parseReview('{"medium": "hand_drawn_2d", "colour": "Vibrant", "clarity": "crisp, clean", "scores": {}}')).toMatchObject({ colour: "vibrant", clarity: "crisp" });
  });

  it("the coach's style references go to the image model and to the review", async () => {
    const { STYLE_REFERENCE, reviewPrompt } = await import("@/lib/daily-visuals");
    expect(picturePrompt({ style: "in_action", light: "gym_glow", art: "graphic", visual: "v", typography: "", message: "m" }, { reference: true }).startsWith(STYLE_REFERENCE)).toBe(true);
    expect(STYLE_REFERENCE).toContain("never copy the reference's people, place, objects or composition");
    expect(reviewPrompt({ caption: "c", concept: { message: "m", situation: "s", visual: "v", typography: "", style: "group" }, audience: "everyone", references: 1 })).toContain(
      "THE FIRST IMAGE IS THE STYLE REFERENCE THE COACH CHOSE.",
    );
    expect(readFileSync("src/lib/post-pictures.server.ts", "utf8")).toContain('fetch("https://api.openai.com/v1/images/edits"');
    // a reference that fails never costs the picture: the words alone
    expect(server).toContain("if (!made?.ok) made = await maker.picture(picturePrompt(concept, { faith: r.faith, fix: c.fix }));");
    // a reference is only ever a picture the coach uploaded under his own folder
    expect(vivid).toContain("IF v_path IS NOT NULL AND (v_path NOT LIKE ((SELECT auth.uid())::text || '/%') OR v_path LIKE '%..%') THEN");
  });

  it("existing days move to the new look only when the coach approves it, captions kept", () => {
    expect(vivid).toContain("CREATE OR REPLACE FUNCTION public.community_daily_visuals_restyle(_look text)");
    expect(vivid).toContain("SET regen = 'picture', regen_reason = 'restyle'");
    expect(vivid).not.toMatch(/^UPDATE public\.community_daily_visuals\b/m);
    expect(readFileSync("src/components/community/daily-pictures-card.tsx", "utf8")).toContain('db.rpc("community_daily_visuals_restyle", { _look: FILM_LOOK_VERSION })');
  });
});

describe("captions don't fall back on the same stock moments", () => {
  it("a stock moment a recent post used can't come back, and humour has to be funny", async () => {
    const { motifRepeats, REVIEW_PROMPT, reviewPrompt } = await import("@/lib/daily-visuals");
    const recent = ["nobody cheered when you walked into the gym tonight", "the group chat is out and you hit seen"];
    expect(motifRepeats("you pack your bag and nobody cheered. thats fine", recent)).toEqual(["nobody cheered"]);
    expect(motifRepeats("your mom asks if you live at the gym now", recent)).toEqual([]);
    expect(captionProblems("you check the group chat and laugh at your own form video from last week", { format: "humor", recent })).toContain(
      'uses "group chat" like a recent post (find a new moment)',
    );
    expect(REVIEW_PROMPT).toContain("a caption meant as humour that isn't actually funny is 3 or less");
    expect(reviewPrompt({ caption: "c", concept: { message: "m", situation: "s", visual: "v", typography: "", style: "group", format: "humor" }, audience: "everyone" })).toContain("THE CAPTION'S FORM: Humour");
  });
});

describe("a review never copies the picture into memory", () => {
  it("the vision model gets a signed link to the stored picture, the bytes only if signing fails", () => {
    expect(server).toContain("const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);");
    expect(server).toContain("image = await pictureUrl(admin, entry.path, made.picture);");
    expect(server).not.toContain("image = dataUrl(");
  });
});
