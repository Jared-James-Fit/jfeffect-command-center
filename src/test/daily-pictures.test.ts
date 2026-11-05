import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DAILY_FORMATS,
  DAILY_PILLARS,
  DAILY_PILLAR_KEYS,
  DAILY_TOPICS,
  DAILY_TOPIC_KEYS,
  EDITOR_BARS,
  EDITOR_PROMPT,
  CONCEPT_PROMPT,
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
  crowdForDay,
  editorPrompt,
  editorVerdict,
  endsWithQuestion,
  hookOf,
  parseEditor,
  pickPillars,
  pillarOf,
  pillarShares,
  tidyCaption,
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
  scores: { relatable: 5, original: 4, writing: 4, audience_fit: 4, aesthetic: 5, storytelling: 4, match: 5, engaging: 4, uplift: 5 },
  fix_image: "",
  fix_caption: "",
  ...o,
});

describe("the week: a mood a day, women, men and everyone in turn", () => {
  it("each weekday is a light mood (the database's keys), Monday a fresh start … Sunday rest & reset", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(themeForDow)).toEqual(["courage", "patience", "your_circle", "self_reflection", "encouragement", "self_love", "emotional"]);
    expect(first).toContain("(ARRAY['courage', 'patience', 'your_circle', 'self_reflection', 'encouragement', 'self_love', 'emotional'])[extract(isodow FROM _day)::int]");
    expect(DAILY_THEME_KEYS.map((k) => DAILY_THEMES[k].name)).toEqual(["Fresh start", "The long game", "Your people", "How far you've come", "Celebrate", "Enjoy it", "Rest & reset"]);
    // a mood only nudges the pillar: it never decides it
    for (const k of DAILY_THEME_KEYS) for (const v of Object.values(DAILY_THEMES[k].lean)) expect(v, k).toBeLessThanOrEqual(0.4);
  });

  it("speaks to women, men, then everyone, so each weekday changes every week (the same in SQL)", () => {
    expect(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map(audienceForDay)).toEqual(["men", "everyone", "women", "men"]);
    // next Monday is someone else
    expect(audienceForDay("2026-11-09")).toBe("everyone");
    expect(sql).toContain("SELECT (ARRAY['women', 'men', 'everyone'])[((((_day - date '2026-01-05') % 3) + 3) % 3) + 1]");
  });

  it("twelve shots and seven caption forms, each as long as its idea needs and never longer", () => {
    // one look (a hand-drawn 2D film frame), the variety in the shot and the light
    expect(DAILY_STYLE_KEYS).toHaveLength(12);
    expect(Object.keys(DAILY_LIGHTS)).toHaveLength(9);
    for (const k of DAILY_STYLE_KEYS) expect(vivid, k).toContain(`'${k}'`);
    expect(Object.keys(DAILY_FORMATS)).toEqual(["one_liner", "quick_take", "short_story", "dialogue", "list", "tip", "question"]);
    expect(DAILY_FORMATS.one_liner.max).toBeLessThan(DAILY_FORMATS.short_story.max);
    // the database holds 600 characters for a caption
    for (const f of Object.values(DAILY_FORMATS)) expect(f.max).toBeLessThanOrEqual(600);
    // no minimum: a one-line post is a post
    expect(captionProblems("Your warm-up used to be your whole workout.", { format: "one_liner" })).toEqual([]);
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
    expect(captionProblems("Psalm 46:10 says be still. So be still today and rest well.", { format: "quick_take" })).toContain("mentions a verse (the app adds it)");
  });
});

describe("captions read like a real person posting, never a rerun", () => {
  const good = "Your warm-up used to be your whole workout.\n\nNobody hands you a certificate for that, but you should probably notice it anyway.";

  it("passes a real moment told naturally, in any form", () => {
    expect(captionProblems(good, { format: "quick_take" })).toEqual([]);
    expect(captionProblems("Me: one more set\nMy legs: we've talked about this\nMe: one more set", { format: "dialogue" })).toEqual([]);
    expect(captionProblems("What's the one song that never fails you on a heavy set?", { format: "question" })).toEqual([]);
    expect(captionProblems("Signs you've been training a while:\nYou judge every chair as a step-up box\nYour playlist has a leg day section\nStairs are a negotiation", { format: "list" })).toEqual([]);
  });

  it("tidies the old texting style into real punctuation", () => {
    expect(tidyCaption("you close the app & swear its fine — dont worry, im fine")).toBe("You close the app and swear its fine, don't worry, I'm fine");
    expect(tidyCaption("“you showed up.\n\n\n\nthat counts”")).toBe("You showed up.\n\nThat counts");
    // "lets" is a word too: only fixed where it starts a sentence
    expect(tidyCaption("it lets you rest. lets go")).toBe("It lets you rest. Let's go");
  });

  it("refuses slogans, AI phrases, hashtags, tags, names, too many emojis and the wrong length for its form", () => {
    const p = captionProblems("Trust the process. Here's the thing #grind 💪🔥 @marc", { format: "one_liner" });
    expect(p).toEqual(expect.arrayContaining(['says "trust the process" (a slogan)', 'says "here\'s the thing" (reads like AI)', "has a hashtag", "tags someone", "more than one emoji"]));
    expect(captionProblems("Jared says rest days count too.", { format: "one_liner" })).toContain("drops in a name");
    expect(captionProblems(good, { format: "one_liner" })).toEqual([]);
    expect(captionProblems(`${good} ${good}`, { format: "one_liner" })[0]).toContain("a one-liner is 170 at most");
  });

  it("never a poem of one-line sentences, and the hook stays short enough for the feed's preview", () => {
    expect(captionProblems("You lift.\nYou rest.\nYou grow.", { format: "quick_take" })).toContain("line breaks inside a paragraph (write sentences, not a poem of one-line lines)");
    expect(hookOf("First one. Then the rest.")).toBe("First one.");
    const long = "When you finally walk into the gym after a long day at work and realize everyone else is tired too, it feels different.";
    expect(captionProblems(long, { format: "quick_take" })[0]).toContain("the first sentence runs long");
  });

  it("never puts a body down, lectures, or leans negative", () => {
    expect(captionProblems("You tug the shirt down and your stomach says nah.", { format: "one_liner" })).toContain("puts a body down");
    expect(captionProblems("Skipping dinner after a bad mirror day isn't the answer.", { format: "one_liner" })).toContain("puts a body down");
    // food and training words aren't body words
    expect(captionProblems("Low-fat yogurt, healthy fats and a fat-loss phase walk into a bar.", { format: "one_liner" })).not.toContain("puts a body down");
    expect(captionProblems("You need to stop making excuses.", { format: "one_liner" })).toContain("lectures the reader");
    // "not X, it's Y" twice is the AI template; once is how people talk
    expect(captionProblems("Rest days aren't you falling off, they're when your body cashes in. That's not slacking, that's lifting smarter.", { format: "quick_take" })).toContain(`"it's not X, it's Y" 2 times (reads like AI)`);
    expect(captionProblems("Rest days aren't you falling off. They're when your body catches up.", { format: "quick_take" })).toEqual([]);
    expect(captionProblems("Tired, stressed, overwhelmed and dreading it again.", { format: "one_liner" })[0]).toContain("leans negative");
    // a challenge can be a little heavier before it counts
    expect(captionProblems("Tired, stressed, dreading it. Go anyway, then grab a coffee with a friend.", { format: "one_liner", pillar: "challenge" })).toEqual([]);
  });

  it("doesn't end on a question three days running, and doesn't just repeat the picture's words", () => {
    expect(endsWithQuestion("What gets you through leg day? 🎧")).toBe(true);
    expect(captionProblems("What gets you through leg day?", { format: "question", asked: true })).toContain("ends on a question again (the last two did)");
    expect(captionProblems("What gets you through leg day?", { format: "question" })).toEqual([]);
    expect(captionProblems("You up? Rack's free at six. That text is a love language.", { format: "one_liner", picture: "you up? rack's free at six" })).toContain("repeats the words in the picture");
  });

  it("never comes back close to a recent post, or opens like the days around it", () => {
    const recent = ["Your warm-up used to be your whole workout, and you didn't even notice when that changed."];
    expect(captionSimilarity(good, recent[0])).toBeGreaterThan(0.3);
    expect(captionProblems(good, { format: "quick_take", recent })[0]).toContain("too close to a recent post");
    expect(captionProblems(good, { format: "quick_take", near: ["Your warm-up sets say a lot about you."] })).toContain('opens with "your warm" like a day near it');
    // a common first word alone isn't a template: "you know" and "you showed" open differently
    expect(repeatsNearby("you know that moment", ["you showed up all week"])).toBeNull();
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

describe("what a day is about: a mix that makes people glad they opened the app", () => {
  const l = learnDailyVisuals([]);
  const run = (n: number, learned = l) => {
    const days: { day: string; pillar: string }[] = [];
    for (let i = 0; i < n; i++) {
      const day = new Date(Date.parse("2026-11-02T12:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      days.push({ day, pillar: pickPillars(learned, day, days, () => 0.5)[0] });
    }
    return days;
  };

  it("starts at 30% realization, 25% humour, 20% community, 15% insight, 10% challenge", () => {
    expect(DAILY_PILLAR_KEYS.map((k) => DAILY_PILLARS[k].share)).toEqual([0.3, 0.25, 0.2, 0.15, 0.1]);
    const days = run(100);
    for (const k of DAILY_PILLAR_KEYS) {
      const share = days.filter((d) => d.pillar === k).length / days.length;
      expect(Math.abs(share - DAILY_PILLARS[k].share), k).toBeLessThanOrEqual(0.04);
    }
  });

  it("never the same pillar two days running, a challenge at most once in 6 days and never on a Sunday", () => {
    const days = run(120);
    for (let i = 1; i < days.length; i++) expect(days[i].pillar, days[i].day).not.toBe(days[i - 1].pillar);
    const challenges = days.filter((d) => d.pillar === "challenge");
    for (let i = 1; i < challenges.length; i++) expect(Date.parse(challenges[i].day) - Date.parse(challenges[i - 1].day)).toBeGreaterThanOrEqual(6 * 86_400_000);
    for (const c of challenges) expect(new Date(`${c.day}T12:00:00Z`).getUTCDay(), c.day).not.toBe(0);
  });

  it("leans toward what the crew responds to, within limits, and a challenge never grows past its share", () => {
    const stats = [
      ...[1, 2, 3, 4].map((i) => stat({ day: `2026-10-0${i}`, topic: "gym_floor_comedy", likers: 5, commenters: 3, savers: 2, sharers: 2 })),
      ...[5, 6, 7, 8].map((i) => stat({ day: `2026-10-0${i}`, topic: "training_clicks", likers: 0, stopped: 0 })),
      ...[1, 2, 3].map((i) => stat({ day: `2026-10-1${i}`, topic: "honest_and_kind", likers: 9, commenters: 5, savers: 4 })),
    ];
    const s = pillarShares(learnDailyVisuals(stats));
    expect(s.humor).toBeGreaterThan(0.25);
    expect(s.insight).toBeLessThan(0.15);
    expect(s.insight).toBeGreaterThanOrEqual(0.15 * 0.75 * 0.8);
    expect(s.challenge).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it("every angle belongs to a pillar, every pillar has at least four, and old topics still read", () => {
    for (const p of DAILY_PILLAR_KEYS) expect(DAILY_TOPIC_KEYS.filter((t) => DAILY_TOPICS[t].pillar === p).length, p).toBeGreaterThanOrEqual(4);
    expect(pillarOf({ topic: "humor_shared" })).toBe("humor");
    expect(pillarOf({ topic: "burnout" })).toBeNull();
    expect(pillarOf({ pillar: "community", topic: "humor_shared" })).toBe("community");
  });

  it("beginners, lifestyle members and serious lifters take turns, apart from women / men / everyone", () => {
    const days = Array.from({ length: 12 }, (_, i) => new Date(Date.parse("2026-11-02T12:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
    expect(new Set(days.map((d) => `${audienceForDay(d)}·${crowdForDay(d)}`)).size).toBe(12);
  });
});

describe("the editor reads every caption before a picture is made", () => {
  const draft = (o: Partial<Record<string, number>> = {}, flags: Partial<Record<string, boolean>> = {}) => ({
    scores: { human: 5, hook: 4, clarity: 5, match: 4, tight: 4, mobile: 5, relatable: 4, fresh: 4, shareable: 4, feel_good: 5, ...o } as any,
    flags: { shaming: false, lecturing: false, invented: false, generic: false, negative: false, ...flags } as any,
    note: "",
  });

  it("asks the user's questions: human, hook, clear, matches the picture, tight, mobile, relatable, fresh, shareable, feel-good", () => {
    for (const k of ["human:", "hook:", "clarity:", "match:", "tight:", "mobile:", "relatable:", "fresh:", "shareable:", "feel_good:", "shaming:", "lecturing:", "invented:", "generic:", "negative:"]) expect(EDITOR_PROMPT, k).toContain(k);
    expect(EDITOR_PROMPT).toContain("Never add a question, an emoji, a hashtag or a name, and never change the idea.");
    const p = editorPrompt({
      concept: { pillar: "humor", topic: "lifter_habits", crowd: "lifters", mood: "funny", situation: "s", message: "m", visual: "v", typography: "", format: "dialogue" },
      audience: "everyone",
      drafts: ["a", "b"],
      recent: ["older post"],
    });
    expect(p).toContain("PILLAR: Humour.");
    expect(p).toContain("THE DRAFTS:\n[0]\na\n\n[1]\nb");
    expect(p).toContain("RECENT POSTS:\n- older post");
  });

  it("passes only at every bar with no flag (a challenge's feel-good bar is 3)", () => {
    expect(editorVerdict({ drafts: [draft()], best: 0, polished: "", why: "" }, "humor")).toEqual({ pass: true, issues: [] });
    expect(editorVerdict({ drafts: [draft({ hook: 3 })], best: 0, polished: "", why: "" }, "humor").issues).toContain("hook 3/5");
    expect(editorVerdict({ drafts: [draft({}, { lecturing: true })], best: 0, polished: "", why: "" }, "realization").issues).toContain("lecturing");
    expect(editorVerdict({ drafts: [draft({ feel_good: 3 })], best: 0, polished: "", why: "" }, "challenge").pass).toBe(true);
    expect(editorVerdict({ drafts: [draft({ feel_good: 3 })], best: 0, polished: "", why: "" }, "humor").pass).toBe(false);
    expect(EDITOR_BARS.fresh).toBe(3);
  });

  it("reads the editor's JSON, holding its pick to the drafts it saw", () => {
    const e = parseEditor('{"drafts": [{"scores": {"human": 9, "hook": 4}, "flags": {"generic": true}}, {"scores": {}}], "best": 7, "polished": "x", "why": "y"}', 2)!;
    expect(e.best).toBe(0);
    expect(e.drafts[0].scores.human).toBe(5);
    expect(e.drafts[0].scores.tight).toBe(1);
    expect(e.drafts[0].flags.generic).toBe(true);
    expect(parseEditor("no json", 2)).toBeNull();
  });

  it("the generator runs the writer, the hard checks and the editor before any picture, and keeps the editor's read", () => {
    // each draft held to its own form, and the chosen one's form becomes the post's
    expect(server).toContain(".filter((d) => !captionProblems(d.text, checksFor(d.form)).length);");
    expect(server).toContain("const format = passing[ed.best].form;");
    expect(server).toContain('const e = await maker.json(EDITOR_PROMPT, editorPrompt({ concept: parsed, audience: r.audience, drafts: ok, forms: passing.map((d) => d.form), recent: recentCaptions }), { effort: "low" });');
    expect(server).toContain("editor: c.editor ?? null,");
    // the feed reads like a social post: his never-say lists, not his texting style
    expect(server).not.toContain("casualize");
    expect(server).not.toContain("buildVoicePrompt");
  });
});

describe("the concept comes first: the moment, the picture, then three drafts", () => {
  const choices = { pillar: "realization" as const, styles: ["backlit", "two_frames"] as any, lights: ["neon_night", "golden_teal"] as any, formats: ["quick_take", "one_liner"] as any, topics: ["progress_noticed", "small_milestones"] as any };

  it("reads the concept, holding its choices to the lists it was given", () => {
    const c = parseConcept(
      '```json\n{"topic": "progress_noticed", "mood": "angry", "situation": "s", "idea": "m", "format": "essay", "style": "oil painting", "light": "golden_teal", "visual": "v", "typography": "\\"still here\\"", "captions": ["\\"one\\"", "two", "", "four"]}\n```',
      { ...choices, crowd: "lifters" },
    );
    // no art direction given: a realization leans to B, the cinematic anime
    expect(c).toMatchObject({ pillar: "realization", topic: "progress_noticed", crowd: "lifters", mood: "uplifting", format: "quick_take", style: "backlit", light: "golden_teal", art: "anime", typography: "still here", message: "m", drafts: ["one", "two", "four"] });
    expect(parseConcept("no json", choices)).toBeNull();
    // drafts labelled with their own forms: each keeps its own, the first one's is the post's until the editor picks
    const labelled = parseConcept('{"topic": "small_milestones", "idea": "m", "visual": "v", "captions": [{"form": "one_liner", "text": "a"}, {"form": "nonsense", "text": "b"}]}', choices)!;
    expect(labelled.drafts).toEqual(["a", "b"]);
    expect(labelled.draftForms).toEqual(["one_liner", "quick_take"]);
    expect(labelled.format).toBe("one_liner");
    expect(editorPrompt({ concept: { ...labelled, crowd: "everyone" }, audience: "women", drafts: ["a", "b"], forms: ["one_liner", "quick_take"], recent: [] })).toContain("[0] (One-liner: one or two sentences");
  });

  it("is told the day's pillar, who it's for, what's worked, what to avoid and what the coach threw out", () => {
    const p = conceptPrompt({
      day: "2026-11-08",
      theme: "emotional",
      audience: "everyone",
      crowd: "beginners",
      faith: true,
      choices,
      learnings: "Pillars landing best: humour.",
      best: ["liked line"],
      worst: [],
      recent: [
        { day: "2026-11-06", topic: "gym_floor_comedy", format: "question", style: "group", caption: "What's your song?" },
        { day: "2026-11-07", topic: "ask_the_crew", format: "question", style: "two_frames", light: "warm_lamp", caption: "Best gym memory?" },
      ],
      rejected: ["thrown out line"],
      neverSay: ["fr"],
      editorNotes: ["hook 3/5"],
    });
    expect(p).toContain("TODAY: Sunday: rest, gratitude and a calm reset for the week.");
    expect(p).toContain("PILLAR: Realization. The goal: a small epiphany");
    expect(p).toContain('ANGLES, as "topic" (pick one, best first): progress_noticed = ');
    expect(p).toContain("Today especially people in their first months");
    expect(p).toContain("SUNDAY: a Bible verse goes under the caption.");
    expect(p).toContain("The last two posts ended with a question: don't end with one.");
    expect(p).toContain("THE COACH NEVER SAYS: fr");
    expect(p).toContain("POSTS THEY LIKED MOST:\n- liked line");
    expect(p).toContain("RECENT POSTS (make yours different in every way):\n- 2026-11-06 · humor · gym_floor_comedy · question · group: What's your song?");
    expect(p).toContain("THE COACH THREW THESE OUT (never write like them):\n- thrown out line");
    expect(p).toContain("THE EDITOR TURNED DOWN YOUR LAST DRAFTS: hook 3/5.");
    expect(conceptPrompt({ day: "2026-11-02", theme: "courage", audience: "men", crowd: "everyone", faith: false, choices, learnings: "", best: [], worst: [], recent: [], keep: { caption: "keep me" } })).toContain(
      "KEEP THIS CAPTION EXACTLY, word for word",
    );
  });

  it("the writer is told how people should feel, and how a real post reads", () => {
    expect(CONCEPT_PROMPT).toContain('"I never thought of it that way"');
    expect(CONCEPT_PROMPT).toContain("A post can start with a struggle, but it lands somewhere good");
    expect(CONCEPT_PROMPT).toContain("Contractions with apostrophes (you're, don't, it's), normal capital letters and punctuation.");
    expect(CONCEPT_PROMPT).toContain("Never one sentence per line like a poem");
    expect(CONCEPT_PROMPT).toContain("never put a body down");
    expect(CONCEPT_PROMPT).toContain("No made-up first-person stories");
    expect(CONCEPT_PROMPT).toContain("The picture, before any caption");
    expect(CONCEPT_PROMPT).toContain("Most pictures have no words in them at all.");
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
    // a review without the uplift score reads it as neutral (4)
    expect(r?.scores.uplift).toBe(4);
    expect(reviewScore(r!)).toBe(4.4);
    // uplift is the picture's: a gloomy frame is remade, the caption kept (a challenge's bar is 3)
    expect(reviewVerdict(review({ scores: { ...review().scores, uplift: 3 } }), "").image).toEqual(["uplift 3/5"]);
    expect(reviewVerdict(review({ scores: { ...review().scores, uplift: 3 } }), "", "", "challenge").pass).toBe(true);
    expect(parseCaption('{"caption": "\\"new words\\""}')).toBe("new words");
  });
});

describe("it learns what the crew likes, and never repeats itself", () => {
  it("doesn't reuse a shot from the last 4 days, light from the last 3, a form from the last 2 or an angle from the last 2 weeks", () => {
    const l = learnDailyVisuals([]);
    const recent = [
      { day: "2026-11-01", style: "backlit", light: "golden_teal", format: "quick_take", topic: "progress_noticed" },
      { day: "2026-11-02", style: "two_frames", light: "neon_night", format: "one_liner", topic: "gym_floor_comedy" },
    ];
    const c = pickChoices(l, { day: "2026-11-03", recent, rand: () => 0.9, pillar: "realization" });
    expect(c.pillar).toBe("realization");
    expect(c.styles).not.toContain("backlit");
    expect(c.styles).not.toContain("two_frames");
    expect(c.lights).not.toContain("golden_teal");
    expect(c.lights).toHaveLength(7);
    expect(c.formats).not.toContain("quick_take");
    expect(c.formats.every((f) => DAILY_PILLARS.realization.formats.includes(f))).toBe(true);
    expect(c.topics).not.toContain("progress_noticed");
    expect(c.topics.every((t) => DAILY_TOPICS[t].pillar === "realization")).toBe(true);
    // the coach's pick wins, and with no pillar asked it's picked for the day (never yesterday's)
    expect(pickChoices(l, { day: "2026-11-03", recent, rand: () => 0.9, style: "backlit" }).styles).toEqual(["backlit"]);
    expect(pickChoices(l, { day: "2026-11-03", recent, rand: () => 0.9 }).pillar).not.toBe("humor");
    expect(learningsText(l)).toContain("Not enough posted yet");
  });

  it("goes with what's working once it has posts, and still tries the untried sometimes", () => {
    const stats = [1, 2, 3].map((i) => stat({ day: `2026-10-0${i}`, style: "backlit", likers: 4, commenters: 1 }));
    stats.push(...[4, 5, 6].map((i) => stat({ day: `2026-10-0${i}`, style: "two_frames", likers: 0, stopped: 0 })));
    const l = learnDailyVisuals(stats);
    expect(pickChoices(l, { day: "2026-11-03", recent: [], rand: () => 0.9, pillar: "humor" }).styles[0]).toBe("backlit");
    expect(pickChoices(l, { day: "2026-11-03", recent: [], rand: () => 0.9, pillar: "humor" }).styles.at(-1)).toBe("two_frames");
    expect(pickChoices(l, { day: "2026-11-03", recent: [], rand: () => 0.01, pillar: "humor" }).styles[0]).not.toBe("backlit");
    expect(learningsText(l)).toContain("Best shots so far: backlit");
  });

  it("a comment, a save or a share counts more than a like (a real comment more again), and stopping on it counts", () => {
    expect(visualScore(stat({ likers: 0, commenters: 1 }))).toBeGreaterThan(visualScore(stat({ likers: 1 })));
    expect(visualScore(stat({ likers: 0, commenters: 1, meaningful: 1 }))).toBeGreaterThan(visualScore(stat({ likers: 0, commenters: 1 })));
    expect(visualScore(stat({ likers: 0, sharers: 1 }))).toBeGreaterThan(visualScore(stat({ likers: 0, savers: 1 })));
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
    const { ART_STYLES, artForPillar } = await import("@/lib/daily-visuals");
    expect(Object.keys(ART_STYLES)).toEqual(["graphic", "anime"]);
    expect(artForPillar("humor")).toBe("graphic");
    expect(artForPillar("community")).toBe("anime");
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
    expect(captionProblems("You check the group chat and laugh at your own form video from last week.", { format: "quick_take", recent })).toContain(
      'uses "group chat" like a recent post (find a new moment)',
    );
    expect(REVIEW_PROMPT).toContain("a caption meant as humour that isn't actually funny is 3 or less");
    expect(reviewPrompt({ caption: "c", concept: { message: "m", situation: "s", visual: "v", typography: "", style: "group", format: "dialogue", pillar: "humor", mood: "funny" }, audience: "everyone" })).toContain("THE CAPTION'S FORM: Dialogue");
    expect(reviewPrompt({ caption: "c", concept: { message: "m", situation: "s", visual: "v", typography: "", style: "group", pillar: "humor", mood: "funny" }, audience: "everyone" })).toContain("THE KIND OF POST: Humour (a real laugh");
  });
});

describe("a review never copies the picture into memory", () => {
  it("the vision model gets a signed link to the stored picture, the bytes only if signing fails", () => {
    expect(server).toContain("const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);");
    expect(server).toContain("image = await pictureUrl(admin, entry.path, made.picture);");
    expect(server).not.toContain("image = dataUrl(");
  });
});

describe("the coach's two references set the look", () => {
  it("each art direction is written from its reference, and the references are placed once, server only", async () => {
    const { ART_STYLES } = await import("@/lib/daily-visuals");
    expect(ART_STYLES.graphic.look).toContain("crisp dark ink outlines and flat cel shading");
    expect(ART_STYLES.graphic.look).toContain("dramatic hard-edged shafts of sunlight");
    expect(ART_STYLES.anime.look).toContain("a glowing golden-hour or sunset sky");
    expect(ART_STYLES.anime.look).toContain("a bright rim light glowing along the hair and face");
    const refs = readFileSync("src/lib/daily-style-refs.server.ts", "utf8");
    expect(refs).toContain('import graphic from "@/assets/daily-style/graphic.jpg?inline";');
    expect(refs).toContain('import anime from "@/assets/daily-style/anime.jpg?inline";');
    // placed only where none is set, once, so the coach's own choice stays
    expect(server).toContain("if (refs.seeded === STYLE_REFS_SEED || !data?.author_user_id) return [];");
    expect(server).toContain("if (refs[art]) continue;");
    // never a public file
    expect(() => readFileSync("public/daily-style/graphic.jpg")).toThrow();
  });
});

describe("the writer's own clichés are banned outright", () => {
  it("nobody claps / the quiet rep fail even when no recent post used them", () => {
    expect(captionProblems("You finish the containers and set them in the fridge.\n\nThat's the quiet rep that makes next week easier with no claps.", { format: "quick_take" })).toEqual(
      expect.arrayContaining(['says "quiet rep" (a slogan)', 'says "no claps" (a slogan)']),
    );
  });
});

describe("a scene the image model's safety filter turns down gets a new scene, not four retries", () => {
  it("reads the refusal and plans a new concept", async () => {
    const { isSafetyRefusal } = await import("@/lib/daily-visuals.server");
    expect(isSafetyRefusal(new Error("OpenAI: Your request was rejected by the safety system. If you believe this is an error"))).toBe(true);
    expect(isSafetyRefusal(new Error("OpenAI said no (500)"))).toBe(false);
    expect(server).toContain('issues: ["the image model\'s safety filter turned the scene down"]');
    expect(CONCEPT_PROMPT).toContain("undressed, pinching or measuring their body, or on a scale");
  });
});
