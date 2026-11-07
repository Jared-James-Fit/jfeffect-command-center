import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DAILY_FORMATS,
  DAILY_FORMAT_KEYS,
  DAILY_PILLARS,
  DAILY_PILLAR_KEYS,
  DAILY_TOPICS,
  DAILY_TOPIC_KEYS,
  EDITOR_BARS,
  EDITOR_PROMPT,
  CONCEPT_PROMPT,
  CAPTION_FIX_PROMPT,
  NOT_HIS_VOICE,
  VOICE_EXAMPLE,
  VOICE_EXAMPLES,
  VOICE_GUIDE,
  DAILY_MIN_WORDS,
  DAILY_AUDIENCE_GUIDE,
  RELEVANCE,
  relevanceOf,
  qualityChecks,
  visualRepeat,
  TOPIC_GAP_DAYS,
  ART_STYLES,
  LEGACY_ART_NAMES,
  FILM_LOOK_VERSION,
  REVIEW_PROMPT,
  contrastCount,
  formatName,
  topicName,
  namedPeople,
  motifRepeats,
  DAILY_STYLES,
  DAILY_STYLE_KEYS,
  DAILY_THEMES,
  DAILY_THEME_KEYS,
  FAITH_VERSES,
  FILM_AVOID,
  FILM_LOOK,
  DAILY_LIGHTS,
  DAILY_SETTINGS,
  DAILY_SETTING_KEYS,
  SETTING_GAP_DAYS,
  settingLine,
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
const insights = readFileSync("supabase/migrations/20270211090000_athlete_insights.sql", "utf8");
const server = readFileSync("src/lib/daily-visuals.server.ts", "utf8");

const stat = (o: Partial<VisualStat>): VisualStat => ({
  day: "2026-11-01",
  theme: "courage",
  audience: "men",
  style: "medium_candid",
  format: "coach_note",
  topic: "bar_path",
  line: "Film your top set and look at the first inch.",
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
  colour: "cinematic",
  clarity: "clean",
  medium: "anime",
  maturity: "mature",
  description: "",
  text_seen: "",
  defects: [],
  scores: { relatable: 5, original: 4, writing: 4, audience_fit: 4, aesthetic: 5, storytelling: 4, match: 5, engaging: 4, uplift: 5, on_topic: 5, teaches: 5, technique: 5 },
  fix_image: "",
  fix_caption: "",
  ...o,
});

/** A coaching point the way the coach writes one: the point, why, what to do. */
const good =
  "Most missed squats aren't missed at the bottom. They're missed in the first few inches out of the hole, when the hips rise faster than the chest.\n\nWatch your last rep on video. If the bar drifts forward as your hips shoot up, the fix is usually a harder brace, not more weight.\n\nFilm your top set this week and look at that first inch.";
const question =
  "What's the one cue that fixed your bench? Not the one you read about, the one that actually changed how the bar moves for you.\n\nI'm asking because the best cues are usually simple and personal, and somebody here is probably stuck on the exact thing yours fixed.";

describe("the week: a mood a day, women, men and everyone in turn", () => {
  it("each weekday is a training mood (the database's keys), Monday a new week … Sunday rest & reset", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(themeForDow)).toEqual(["courage", "patience", "your_circle", "self_reflection", "encouragement", "self_love", "emotional"]);
    expect(first).toContain("(ARRAY['courage', 'patience', 'your_circle', 'self_reflection', 'encouragement', 'self_love', 'emotional'])[extract(isodow FROM _day)::int]");
    expect(DAILY_THEME_KEYS.map((k) => DAILY_THEMES[k].name)).toEqual(["New week", "The long game", "Midweek", "Read your log", "Week in review", "Heavy day", "Rest & reset"]);
    // a mood only nudges the category: it never decides it, and it's always a real one
    for (const k of DAILY_THEME_KEYS)
      for (const [p, v] of Object.entries(DAILY_THEMES[k].lean)) {
        expect(v, k).toBeLessThanOrEqual(0.4);
        expect(DAILY_PILLAR_KEYS, k).toContain(p);
      }
  });

  it("never aimed at men or women: every post is for every athlete, labelled by its training relevance", () => {
    expect(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map(audienceForDay)).toEqual(["everyone", "everyone", "everyone", "everyone"]);
    expect(insights).toContain("SELECT 'everyone'::text");
    expect(insights).toContain("UPDATE public.community_daily_visuals SET audience = 'everyone', updated_at = now()");
    // the old values read the same, so an older day's remake isn't gendered either
    expect(DAILY_AUDIENCE_GUIDE.women).toBe(DAILY_AUDIENCE_GUIDE.everyone);
    expect(DAILY_AUDIENCE_GUIDE.men).toBe(DAILY_AUDIENCE_GUIDE.everyone);
    expect([...new Set(Object.values(RELEVANCE))].sort()).toEqual(
      ["All Athletes", "Athlete Mindset", "Competition", "Hypertrophy", "Powerlifting", "Recovery", "Strength Training"].sort(),
    );
    expect(relevanceOf({ topic: "attempt_selection" })).toBe("Competition");
    expect(relevanceOf({ topic: "gym_floor_comedy" })).toBeNull();
    const card = readFileSync("src/components/community/daily-pictures-card.tsx", "utf8");
    for (const gendered of ["for him", "for her", "AUDIENCE["]) expect(card, gendered).not.toContain(gendered);
  });

  it("twelve shots and six coaching forms, about 40 to 100 words, never past the database's 600 characters", () => {
    // one look (a hand-drawn 2D film frame), the variety in the shot and the light
    expect(DAILY_STYLE_KEYS).toHaveLength(12);
    expect(Object.keys(DAILY_LIGHTS)).toHaveLength(8);
    for (const k of DAILY_STYLE_KEYS) expect(vivid, k).toContain(`'${k}'`);
    expect(Object.keys(DAILY_FORMATS)).toEqual(["coach_note", "breakdown", "mistake", "take", "observation", "question"]);
    for (const p of DAILY_PILLAR_KEYS) for (const f of DAILY_PILLARS[p].formats) expect(Object.keys(DAILY_FORMATS), `${p} ${f}`).toContain(f);
    // the database holds 600 characters for a caption (and the coach's Edit words says so)
    for (const f of Object.values(DAILY_FORMATS)) expect(f.max).toBeLessThanOrEqual(600);
    expect(DAILY_MIN_WORDS).toBe(35);
    // a one-liner is a slogan now, not a coaching point
    expect(captionProblems("Your warm-up used to be your whole workout.", { format: "take" })[0]).toContain("too thin for a coaching point");
    // the earlier forms still have names for the days made with them
    expect(formatName("quick_take")).toBe("Thought");
    expect(formatName("one_liner")).toBe("One-liner");
  });

  it("every shot is a training scene: no beach, brunch or park", () => {
    for (const s of Object.values(DAILY_STYLES)) expect(s.look).not.toMatch(/\b(beach|brunch|picnic|park|rooftop|lake|kitchen table)\b/);
    expect(DAILY_STYLES.in_action.look).toContain("side-on or three-quarter so the technique reads");
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
    expect(dailyCaption("Rest is part of it.", FAITH_VERSES[0])).toBe("Rest is part of it.\n\n“Be still, and know that I am God” Psalm 46:10");
    expect(sql).toContain("THEN E'\\n\\n' || '“' || btrim(_verse_text) || '” ' || _verse_ref ELSE '' END");
    // the writer never writes one: a caption that names a verse is refused
    expect(captionProblems(`Psalm 46:10 says be still. ${good}`, { format: "coach_note" })).toContain("mentions a verse (the app adds it)");
  });
});

describe("captions read like a powerlifting coach between sets, never a motivation page", () => {
  it("passes a coaching point said plainly, and the coach's own two posts", () => {
    expect(captionProblems(good, { format: "coach_note" })).toEqual([]);
    expect(captionProblems(question, { format: "question" })).toEqual([]);
    // his own posts pass every rule but the one that stops them coming back word for word
    for (const x of VOICE_EXAMPLES) {
      const p = captionProblems(x, { format: "coach_note" });
      expect(p).toContain("copies a voice example (they're references, not templates)");
      expect(p.filter((m) => !m.includes("voice example"))).toEqual([]);
    }
  });

  it("refuses the lines he banned, and the motivation page behind them", () => {
    for (const line of [
      "every little bit counts",
      "give yourself grace",
      "listen to your body",
      "you got this",
      "movement is medicine",
      "worse places to spend your time",
    ])
      expect(captionProblems(`${good} ${line[0].toUpperCase()}${line.slice(1)}.`, { format: "coach_note" }), line).toContain(`says "${line}" (a slogan)`);
    const page = captionProblems(NOT_HIS_VOICE, { format: "coach_note" });
    expect(page).toEqual(expect.arrayContaining(['says "give yourself grace" (a slogan)', 'says "every little bit counts" (a slogan)', 'says "the old you" (scripted)', "a setup line ending in a colon (reads like a list post)"]));
    // and the AI transitions
    expect(captionProblems(`At the end of the day, ${good}`, { format: "coach_note" })).toContain('says "at the end of the day" (reads like AI)');
    expect(captionProblems(`${good}\n\nThe key takeaway is simple.`, { format: "coach_note" })).toContain('says "the key takeaway" (reads like AI)');
  });

  it("never cites research or a statistic: the lessons carry studies with their sources", () => {
    for (const claim of ["Studies show most lifters squat better with a pause.", "Research says 80% of misses happen out of the hole.", "It's proven that pauses build strength."])
      expect(captionProblems(`${good} ${claim}`, { format: "coach_note" }), claim).toContain(
        "cites research or a statistic (daily posts are coaching; the lessons carry studies with their sources)",
      );
    // a coaching number is fine: weights, sets, RPE, weeks
    expect(captionProblems(good.replace("this week", "this week at RPE 8"), { format: "coach_note" })).toEqual([]);
  });

  it("refuses the scripted shapes: list posts, meme scripts, scenes narrated to you, kickers, stories he didn't live", () => {
    const pad = " Film your top set and check where the bar slows before you change anything else in the program.";
    expect(captionProblems(`me: one more set\nmy legs: we've talked about this.${pad}`, { format: "take" })).toContain('a "me: / my legs:" script');
    expect(
      captionProblems(`You walk in and load the bar. You check the log and see the old max. You grab the chalk and add a plate.${pad}`, { format: "coach_note" }),
    ).toContain('narrates a scene to "you" (3 sentences walk "you" through it)');
    // a coach explaining to "you" isn't a scene
    expect(captionProblems(VOICE_EXAMPLES[1], { format: "coach_note" }).join()).not.toContain("narrates a scene");
    expect(captionProblems(`${pad} Now it's just a warm-up. That's not boring. That's proof.`, { format: "take" })).toContain('ends on a "that\'s not X. that\'s Y." kicker');
    expect(captionProblems(`${pad} Let's go!! New week!!`, { format: "take" })).toContain("more than one exclamation mark");
    for (const story of [
      "I went in for a quick upper day and stayed two hours.",
      "A lot of my clients say the warm-up is their favourite part.",
      "Called it a quick workout, left way later.",
    ])
      expect(captionProblems(`${story}${pad}`, { format: "coach_note" }), story).toContain("tells a story as his own (it never happened to him)");
    // his opinions and what he notices are fine
    for (const ok of ["I think most lifters rush the setup.", "I'm convinced the setup decides the rep.", "My rule of thumb: leave one in the tank."])
      expect(captionProblems(`${ok}${pad}`, { format: "coach_note" }), ok).not.toContain("tells a story as his own (it never happened to him)");
    expect(captionProblems(`${pad} Your "light" sets used to be your "heavy" ones.`, { format: "take" })).toContain("words in scare quotes");
    // the coach's own lines never come back
    expect(captionProblems(`${pad} More work isn't always better work.`, { format: "take" })).toContain('borrows "more work isn\'t always better work" from the voice example');
    expect(motifRepeats("strength sneaks up on you", ["funny how training sneaks up on you"])).toEqual(["sneaks up"]);
  });

  it("names nobody: no crew member's first name lands in a daily post", () => {
    expect(namedPeople("marc would love this one", ["marc", "fionna"])).toEqual(["marc"]);
    expect(namedPeople("remarkable week for everyone", ["marc"])).toEqual([]);
    expect(captionProblems(`Fionna, this one's for you. ${good}`, { format: "coach_note", names: ["fionna"] })).toContain("names someone (fionna)");
    expect(captionProblems(`Jared says rest days count too. ${good}`, { format: "coach_note" })).toContain("drops in a name");
    expect(server).toContain("names: ctx.names");
  });

  it("tidies a caption into normal sentence case with real apostrophes", () => {
    expect(tidyCaption("you close the app & swear its fine — dont worry, im fine")).toBe("You close the app and swear its fine, don't worry, I'm fine");
    expect(tidyCaption("“you showed up.\n\n\n\nthat counts”")).toBe("You showed up.\n\nThat counts");
    // "lets" is a word too: only fixed where it starts a sentence
    expect(tidyCaption("it lets you rest. lets go")).toBe("It lets you rest. Let's go");
    // a model's non-breaking hyphens and curly quotes read like the rest of the caption
    expect(tidyCaption("A quick after‑work lift, today’s “light” sets")).toBe('A quick after-work lift, today\'s "light" sets');
    // "I", days, months and training acronyms in capitals; "march" and "may" are words too
    expect(tidyCaption("i think monday is the day for a pr at rpe 9. your e1rm can march on in may.")).toBe("I think Monday is the day for a PR at RPE 9. Your e1RM can march on in may.");
    // already right: unchanged
    for (const x of VOICE_EXAMPLES) expect(tidyCaption(x)).toBe(x);
  });

  it("refuses hashtags, tags, too many emojis and the wrong length for its form", () => {
    const p = captionProblems(`${good} #grind 💪🔥 @marc`, { format: "coach_note" });
    expect(p).toEqual(expect.arrayContaining(["has a hashtag", "tags someone", "more than one emoji"]));
    expect(good.length).toBeLessThan(480);
    const long = `${good}\n\nFilm it from the side, at hip height, so you can see the bar and the hips together. Then compare the first rep with the last one and look for the moment the hips win.`;
    expect(long.length).toBeGreaterThan(480);
    expect(captionProblems(long, { format: "coach_note" })).toEqual([]);
    expect(captionProblems(long, { format: "take" })[0]).toMatch(/characters \(a short take is 480 at most\)$/);
  });

  it("never a poem of one-line sentences, and the hook stays short enough for the feed's preview", () => {
    expect(captionProblems(`You lift.\nYou rest.\nYou grow.\n\n${good}`, { format: "coach_note" })).toContain("line breaks inside a paragraph (write sentences, not a poem of one-line lines)");
    expect(hookOf("First one. Then the rest.")).toBe("First one.");
    const long = "When you finally get under a heavy bar after a long week of work and realize the warm-ups felt slow, it changes how you run the session.";
    expect(captionProblems(`${long} ${good}`, { format: "coach_note" })[0]).toContain("the first sentence runs long");
  });

  it("never puts a body down or talks down to anyone; direct about the training is fine", () => {
    expect(captionProblems(`${good} Your stomach says nah.`, { format: "coach_note" })).toContain("puts a body down");
    expect(captionProblems(`${good} Skipping dinner isn't the answer.`, { format: "coach_note" })).toContain("puts a body down");
    // food and training words aren't body words
    expect(captionProblems(`${good} Low-fat yogurt and a fat-loss phase.`, { format: "coach_note" })).not.toContain("puts a body down");
    expect(captionProblems(`${good} Stop making excuses.`, { format: "coach_note" })).toContain("lectures the reader");
    // a coach telling you what to stop doing in training isn't lecturing
    expect(captionProblems(VOICE_EXAMPLES[0], { format: "coach_note" })).not.toContain("lectures the reader");
    // "not X, it's Y" twice is the AI template; once is how people talk, and an if-clause isn't one
    expect(captionProblems(`${good} Rest days aren't you falling off, they're when you adapt. That's not slacking, that's lifting smarter.`, { format: "coach_note" })).toContain(`"it's not X, it's Y" 3 times (reads like AI)`);
    expect(contrastCount("If you're not logging every set, you're guessing.")).toBe(0);
    expect(captionProblems(`${good} Stressed, overwhelmed, anxious, dreading it, exhausted.`, { format: "coach_note" }).join()).toContain("leans negative");
  });

  it("doesn't end on a question three days running, and doesn't just repeat the picture's words", () => {
    expect(endsWithQuestion("What gets you through leg day? 🎧")).toBe(true);
    const ask = `${question} What's yours?`;
    expect(captionProblems(ask, { format: "question", asked: true })).toContain("ends on a question again (the last two did)");
    expect(captionProblems(ask, { format: "question" })).toEqual([]);
    expect(captionProblems(`Bar speed tells you more than the number. ${good}`, { format: "coach_note", picture: "bar speed tells you more" })).toContain("repeats the words in the picture");
  });

  it("never comes back close to a recent post, or opens like the days around it", () => {
    const recent = ["Most missed squats aren't missed at the bottom. They're missed in the first few inches out of the hole."];
    expect(captionSimilarity(good, recent[0])).toBeGreaterThan(0.3);
    expect(captionProblems(good, { format: "coach_note", recent })[0]).toContain("too close to a recent post");
    expect(captionProblems(good, { format: "coach_note", near: ["Most lifters rush the setup."] })).toContain('opens with "most" like a day near it');
    // a common first word alone isn't a template: "you know" and "you showed" open differently
    expect(repeatsNearby("you know that moment", ["you showed up all week"])).toBeNull();
    expect(repeatsNearby("honestly the crew carried me", ["honestly just show up"])).toContain('opens with "honestly"');
  });

  it("lifters' words are fine; study-speak still isn't", () => {
    expect(captionProblems(`${good} Hypertrophy work for the quads helps here too.`, { format: "coach_note" })).toEqual([]);
    expect(captionProblems(`${good} Participants in a protocol.`, { format: "coach_note" }).join()).toContain('"participants"');
  });

  it("words in a picture stay few and plain enough for an image model to spell", () => {
    expect(typographyProblems("")).toEqual([]);
    expect(typographyProblems("RPE 8")).toEqual([]);
    expect(typographyProblems("one two three four five six seven eight nine ten eleven twelve thirteen")).toContain("more than 12 words in the picture");
    expect(typographyProblems("rest → reset")).toContain("characters in the picture an image model gets wrong");
  });
});

describe("what a day is about: seven coaching categories in a set mix", () => {
  const l = learnDailyVisuals([]);
  const run = (n: number, learned = l) => {
    const days: { day: string; pillar: string }[] = [];
    for (let i = 0; i < n; i++) {
      const day = new Date(Date.parse("2026-11-02T12:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      days.push({ day, pillar: pickPillars(learned, day, days, () => 0.5)[0] });
    }
    return days;
  };

  it("starts at 20% Powerlifting IQ, 20% Coach's notes, 15% mistakes, 15% mindset, 10% each recovery, hypertrophy and comp prep", () => {
    expect(DAILY_PILLAR_KEYS).toEqual(["powerlifting_iq", "coaches_notes", "mistakes", "mindset", "recovery", "hypertrophy", "comp_prep"]);
    expect(DAILY_PILLAR_KEYS.map((k) => DAILY_PILLARS[k].name)).toEqual([
      "Powerlifting IQ",
      "Coach's notes",
      "Training mistakes",
      "Athlete mindset",
      "Recovery and performance",
      "Hypertrophy for strength",
      "Competition prep",
    ]);
    expect(DAILY_PILLAR_KEYS.reduce((t, k) => t + DAILY_PILLARS[k].share, 0)).toBeCloseTo(1);
    const days = run(140);
    for (const k of DAILY_PILLAR_KEYS) {
      const share = days.filter((d) => d.pillar === k).length / days.length;
      expect(Math.abs(share - DAILY_PILLARS[k].share), k).toBeLessThanOrEqual(0.05);
    }
  });

  it("never the same category two days running", () => {
    const days = run(120);
    for (let i = 1; i < days.length; i++) expect(days[i].pillar, days[i].day).not.toBe(days[i - 1].pillar);
  });

  it("leans toward what the crew responds to, within limits", () => {
    const stats = [
      ...[1, 2, 3, 4].map((i) => stat({ day: `2026-10-0${i}`, topic: "bar_path", likers: 5, commenters: 3, savers: 2, sharers: 2 })),
      ...[5, 6, 7, 8].map((i) => stat({ day: `2026-10-0${i}`, topic: "long_game", likers: 0, stopped: 0 })),
    ];
    const s = pillarShares(learnDailyVisuals(stats));
    expect(s.powerlifting_iq).toBeGreaterThan(0.2);
    expect(s.mindset).toBeLessThan(0.15);
    expect(s.mindset).toBeGreaterThanOrEqual(0.15 * 0.75 * 0.8);
  });

  it("every angle belongs to a category, every category has at least five, and earlier days' topics still read", () => {
    for (const p of DAILY_PILLAR_KEYS) expect(DAILY_TOPIC_KEYS.filter((t) => DAILY_TOPICS[t].pillar === p).length, p).toBeGreaterThanOrEqual(5);
    expect(pillarOf({ topic: "attempt_selection" })).toBe("comp_prep");
    expect(pillarOf({ pillar: "recovery", topic: "bar_path" })).toBe("recovery");
    // the feel-good version's days keep their names but count toward nothing
    expect(pillarOf({ pillar: "humor", topic: "gym_floor_comedy" })).toBeNull();
    expect(pillarOf({ topic: "burnout" })).toBeNull();
    expect(topicName("gym_floor_comedy")).toBe("Gym floor comedy");
    expect(topicName("bar_path")).toBe("Bar path and leverages");
  });

  it("newer lifters, strength for life and powerlifters take turns (experience, never gender)", () => {
    const days = Array.from({ length: 4 }, (_, i) => new Date(Date.parse("2026-11-02T12:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
    expect(new Set(days.map(crowdForDay)).size).toBe(4);
  });
});

describe("the editor reads every caption before a picture is made", () => {
  const draft = (o: Partial<Record<string, number>> = {}, flags: Partial<Record<string, boolean>> = {}) => ({
    scores: { natural: 5, substance: 4, accuracy: 5, clarity: 5, match: 4, fresh: 4, worth_it: 4, ...o } as any,
    flags: { scripted: false, hype: false, ai_phrasing: false, preachy: false, invented: false, shaming: false, generic: false, ...flags } as any,
    note: "",
  });

  it("asks one question first: would an elite powerlifting coach post this, and would a lifter be glad they read it?", () => {
    for (const k of ["natural:", "substance:", "accuracy:", "clarity:", "match:", "fresh:", "worth_it:", "scripted:", "hype:", "ai_phrasing:", "preachy:", "invented:", "shaming:", "generic:"]) expect(EDITOR_PROMPT, k).toContain(k);
    expect(EDITOR_PROMPT).toContain("would Jared, an elite powerlifting coach, post this as his own, and would a serious lifter be glad they read it?");
    expect(EDITOR_PROMPT).toContain("Never add a closing line, a question, an emoji, a claim or a name, and never change the point.");
    expect(EDITOR_PROMPT).toContain("Keep normal sentence case.");
    expect(EDITOR_PROMPT).toContain(VOICE_EXAMPLE);
    const p = editorPrompt({
      concept: { pillar: "mistakes", topic: "junk_volume", crowd: "lifters", mood: "direct", situation: "s", message: "m", visual: "v", typography: "", format: "mistake" },
      audience: "everyone",
      drafts: ["a", "b"],
      recent: ["older post"],
    });
    expect(p).toContain("CATEGORY: Training mistakes.");
    expect(p).toContain("THE DRAFTS:\n[0]\na\n\n[1]\nb");
    expect(p).toContain("RECENT POSTS:\n- older post");
  });

  it("passes only at every bar with no flag", () => {
    expect(editorVerdict({ drafts: [draft()], best: 0, polished: "", why: "" }, "mistakes")).toEqual({ pass: true, issues: [] });
    expect(editorVerdict({ drafts: [draft({ substance: 3 })], best: 0, polished: "", why: "" }).issues).toContain("substance 3/5");
    expect(editorVerdict({ drafts: [draft({ accuracy: 3 })], best: 0, polished: "", why: "" }).pass).toBe(false);
    for (const f of ["scripted", "hype", "generic", "invented", "preachy"]) expect(editorVerdict({ drafts: [draft({}, { [f]: true })], best: 0, polished: "", why: "" }).issues, f).toContain(f);
    expect(EDITOR_BARS.fresh).toBe(3);
    expect(EDITOR_BARS.accuracy).toBe(4);
  });

  it("reads the editor's JSON, holding its pick to the drafts it saw", () => {
    const e = parseEditor('{"drafts": [{"scores": {"natural": 9, "substance": 4}, "flags": {"hype": true}}, {"scores": {}}], "best": 7, "polished": "x", "why": "y"}', 2)!;
    expect(e.best).toBe(0);
    expect(e.drafts[0].scores.natural).toBe(5);
    expect(e.drafts[0].scores.worth_it).toBe(1);
    expect(e.drafts[0].flags.hype).toBe(true);
    expect(parseEditor("no json", 2)).toBeNull();
  });

  it("the generator runs the writer, the hard checks and the editor before any picture, and keeps the editor's read", () => {
    // each draft held to its own form, and the chosen one's form becomes the post's
    expect(server).toContain(".filter((d) => !captionProblems(d.text, checksFor(d.form)).length);");
    expect(server).toContain("const format = passing[ed.best].form;");
    expect(server).toContain('const e = await maker.json(EDITOR_PROMPT, editorPrompt({ concept: parsed, audience: r.audience, drafts: ok, forms: passing.map((d) => d.form), recent: recentCaptions }), { effort: "low" });');
    expect(server).toContain("editor: c.editor ?? null,");
    // the feed reads like his posts: his never-say lists, not his texting style
    expect(server).not.toContain("casualize");
    expect(server).not.toContain("buildVoicePrompt");
  });
});

describe("the concept comes first: the point, the picture, then three drafts", () => {
  const choices = { pillar: "recovery" as const, styles: ["backlit", "two_frames"] as any, lights: ["night_session", "dawn_shafts"] as any, formats: ["coach_note", "take"] as any, topics: ["sleep_performance", "lighter_weeks"] as any, settings: ["garage_gym", "meet_platform"] as any };

  it("reads the concept, holding its choices to the lists it was given", () => {
    const c = parseConcept(
      '```json\n{"topic": "sleep_performance", "mood": "angry", "situation": "s", "idea": "m", "format": "essay", "style": "oil painting", "light": "dawn_shafts", "setting": "a beach", "visual": "v", "typography": "\\"RPE 8\\"", "captions": ["\\"one\\"", "two", "", "four"]}\n```',
      { ...choices, crowd: "lifters" },
    );
    // no direction given: recovery leans to a character moment; a frame carries no words, whatever the writer sent; a place that isn't a gym is the first one offered
    expect(c).toMatchObject({ pillar: "recovery", topic: "sleep_performance", crowd: "lifters", mood: "analytical", format: "coach_note", style: "backlit", light: "dawn_shafts", art: "drama", setting: "garage_gym", typography: "", message: "m", drafts: ["one", "two", "four"] });
    // any real place goes, offered first or not (a meet angle can go back to the meet)
    expect(parseConcept('{"topic": "lighter_weeks", "idea": "m", "visual": "v", "setting": "meet_warm_up", "captions": ["a"]}', choices)!.setting).toBe("meet_warm_up");
    expect(parseConcept("no json", choices)).toBeNull();
    // drafts labelled with their own forms: each keeps its own, the first one's is the post's until the editor picks
    const labelled = parseConcept('{"topic": "lighter_weeks", "idea": "m", "visual": "v", "captions": [{"form": "take", "text": "a"}, {"form": "nonsense", "text": "b"}]}', choices)!;
    expect(labelled.drafts).toEqual(["a", "b"]);
    expect(labelled.draftForms).toEqual(["take", "coach_note"]);
    expect(labelled.format).toBe("take");
    expect(editorPrompt({ concept: { ...labelled, crowd: "everyone" }, audience: "women", drafts: ["a", "b"], forms: ["take", "coach_note"], recent: [] })).toContain("[0] (Short take: one direct point");
  });

  it("is told the day's category, who it's for, what's worked, what to avoid and what the coach threw out", () => {
    const p = conceptPrompt({
      day: "2026-11-08",
      theme: "emotional",
      audience: "everyone",
      crowd: "beginners",
      faith: true,
      choices,
      learnings: "Categories landing best: Powerlifting IQ.",
      best: ["liked line"],
      worst: [],
      recent: [
        { day: "2026-11-06", pillar: "mistakes", topic: "junk_volume", format: "question", style: "group", caption: "What's your one accessory?" },
        { day: "2026-11-07", topic: "ask_the_crew", format: "question", style: "two_frames", light: "warm_lamp", caption: "Best gym memory?" },
      ],
      rejected: ["thrown out line"],
      neverSay: ["fr"],
      editorNotes: ["substance 3/5"],
    });
    expect(p).toContain("TODAY: Sunday: recovery, reviewing the week and setting up the next one.");
    expect(p).toContain("CATEGORY: Recovery and performance. The goal: how sleep, food, fatigue and lighter weeks show up in bar speed and RPE");
    expect(p).toContain('ANGLES, as "topic" (pick one, best first; each with the picture that teaches it): sleep_performance = ');
    expect(p).toContain(`(picture: ${DAILY_TOPICS.sleep_performance.picture})`);
    expect(p).toContain("Today especially lifters in their first year or two");
    expect(p).toContain("Never aimed at men or women: it's about their training.");
    expect(p).not.toMatch(/\bWomen who lift\b|\bMen who lift\b/);
    expect(p).toContain("SUNDAY: a Bible verse goes under the caption. Keep the post about training");
    expect(p).toContain("The last two posts ended with a question: don't end with one.");
    expect(p).toContain("THE COACH NEVER SAYS: fr");
    // what landed is said as kinds of posts, never captions to copy
    expect(p).not.toContain("liked line");
    expect(p).toContain("RECENT POSTS (pick a different angle, moment, opening and picture; don't copy how they're written):\n- 2026-11-06 · mistakes · junk_volume · question · group: What's your one accessory?");
    expect(p).toContain("THE COACH THREW THESE OUT (never write like them):\n- thrown out line");
    // the place is picked like the light, the ones not used lately first
    expect(p).toContain('PLACE, as "setting" (pick the one that fits the moment, the first ones not used lately): garage_gym = ');
    expect(p).toContain('ANIME DIRECTION, as "art"');
    expect(p).toContain("THE EDITOR TURNED DOWN YOUR LAST DRAFTS: substance 3/5.");
    const kept = conceptPrompt({ day: "2026-11-02", theme: "courage", audience: "men", crowd: "everyone", faith: false, choices, learnings: "", best: [], worst: [], recent: [], keep: { caption: "keep me" } });
    expect(kept).toContain("KEEP THIS CAPTION EXACTLY, word for word");
    // a kept caption's picture shows what the caption names, not whatever the angles suggest (Nov 8's log post came back as a lifter resting)
    expect(kept).toContain("The picture shows exactly what this caption is about, not the angles above");
    expect(REVIEW_PROMPT).toContain("when the caption names something (a training log, a deadlift setup, small plates, a meet platform) and it isn't clearly visible, teaches is 2 or less");
    // a kept caption from before the categories is read for its angle: every angle offered, and the category follows the one picked
    const all = { ...choices, topics: DAILY_TOPIC_KEYS, formats: DAILY_FORMAT_KEYS };
    const read = conceptPrompt({ day: "2026-11-07", theme: "self_love", audience: "everyone", crowd: "everyone", faith: false, choices: all, learnings: "", best: [], worst: [], recent: [], keep: { caption: "Your rest day is part of your program." }, classify: true });
    expect(read).toContain("CATEGORY: the one the caption below is actually about.");
    expect(read).toContain('ANGLES, as "topic" (pick the one this caption is about;');
    expect(read).not.toContain(`CATEGORY: ${DAILY_PILLARS[choices.pillar].name}.`);
    const json = `{"topic": "junk_volume", "mood": "${DAILY_PILLARS.mistakes.moods[0]}", "idea": "m", "visual": "v", "captions": ["More work isn't always better work."]}`;
    const long = parseConcept(json, { ...all, classify: true })!;
    expect(long.pillar).toBe("mistakes");
    expect(long.topic).toBe("junk_volume");
    expect(long.mood).toBe(DAILY_PILLARS.mistakes.moods[0]);
    // without it the category is the one given, whatever the angle
    expect(parseConcept(json, all)!.pillar).toBe("recovery");
  });

  it("the writer writes as the coach: his two posts, what isn't him, the shape and the rules", () => {
    for (const x of VOICE_EXAMPLES) expect(CONCEPT_PROMPT).toContain(x);
    expect(CONCEPT_PROMPT).toContain(NOT_HIS_VOICE);
    expect(CONCEPT_PROMPT).toContain("an elite powerlifting coach explaining something to an athlete between sets");
    expect(CONCEPT_PROMPT).toContain("Not another fitness motivation page.");
    for (const part of ["- Hook:", "- Insight:", "- Application:", "- Takeaway:"]) expect(CONCEPT_PROMPT, part).toContain(part);
    expect(CONCEPT_PROMPT).toContain("About 40 to 100 words.");
    expect(CONCEPT_PROMPT).toContain("Normal sentence case and punctuation");
    expect(CONCEPT_PROMPT).toContain("no studies, research, statistics or percentages");
    expect(CONCEPT_PROMPT).toContain('"every little bit counts", "give yourself grace", "remember to listen to your body", "you got this", "movement is medicine", "there are worse places to spend your time"');
    expect(CONCEPT_PROMPT).not.toContain("lowercase");
    // the picture is a frame from a serious powerlifting anime, of the lesson, the gear right, never a lifestyle scene
    expect(CONCEPT_PROMPT).toContain("A still frame from a premium, serious Japanese sports anime about powerlifting, in JF Effect's house style");
    expect(CONCEPT_PROMPT).toContain("It teaches the post's point");
    expect(CONCEPT_PROMPT).toContain("fatigue management, an athlete resting between heavy squat sets");
    expect(CONCEPT_PROMPT).toContain("one straight barbell, the same plates on both sides with collars");
    expect(CONCEPT_PROMPT).toContain("never a lifestyle scene with no training in it");
    expect(CONCEPT_PROMPT).toContain("No readable words anywhere in the frame (no speech bubbles");
    expect(CONCEPT_PROMPT).toContain("calibrated plates (red 25, blue 20, yellow 15, green 10)");
    // a different athlete, place and composition every time, and never childish
    expect(CONCEPT_PROMPT).toContain("Never the same athlete or coach as a recent post (change who they are: gender, age, build, hair, skin tone, kit colours), and never the same place or composition as a recent post.");
    expect(CONCEPT_PROMPT).toContain("never cute, childish or comedic, never a teenager or a school uniform, never fanservice");
    expect(CONCEPT_PROMPT).toContain("never a flat, centred, posed shot");
    expect(CONCEPT_PROMPT).not.toMatch(/photograph|photo\b/);
    // not every post is technical, and still never a story he didn't live
    expect(VOICE_GUIDE).toContain("Not every post is technical: some are an observation about how lifters train, a challenging perspective, or a lesson competitive lifting teaches");
    // the rewrite speaks the same voice
    expect(CAPTION_FIX_PROMPT).toContain(VOICE_GUIDE);
    // and never two days in a row: a post just before had words, today's has none
    expect(conceptPrompt({ day: "2026-11-02", theme: "courage", audience: "men", crowd: "everyone", faith: false, choices, learnings: "", best: [], worst: [], recent: [], noWords: true })).toContain('NO WORDS IN THE PICTURE:');
    expect(server).toContain('noWords: lastTwo.some((d) => !!d.concept?.typography?.trim()),');
    expect(server).toContain('words in the picture again (a post just before had some): leave them out today');
  });

  it("the picture: a frame from a serious powerlifting anime in the house style, of the lesson, its shot, light and place, the gear and technique right, no readable words", () => {
    const p = picturePrompt({ style: "low_angle", light: "night_session", art: "key_frame", setting: "basement_gym", visual: "a conventional deadlift setup, side-on", typography: "", message: "m" });
    // the same house style, word for word, at the start of every prompt
    expect(p.startsWith(FILM_LOOK)).toBe(true);
    expect(FILM_LOOK).toContain("JF Effect's house style: a still frame from a premium, beautifully animated Japanese sports anime series about powerlifting, a mature, grounded sports drama");
    expect(FILM_LOOK).toContain("Hand-drawn 2D: clean, confident line art");
    expect(FILM_LOOK).toContain("realistic adult proportions and anatomy");
    expect(p).toContain(`The shot: ${DAILY_STYLES.low_angle.look}`);
    expect(p).toContain(`Light: ${DAILY_LIGHTS.night_session.look}.`);
    expect(p).toContain(`The place: ${DAILY_SETTINGS.basement_gym.look}.`);
    expect(p).toContain(ART_STYLES.key_frame.look);
    expect(p).toContain("one straight barbell with the same plates loaded on both sides and collars on");
    expect(p).toContain("calibrated plates in their real colours and sizes (red 25, blue 20, yellow 15, green 10)");
    expect(p).toContain("never exaggerated, show-ready or steroid-looking");
    expect(p).toContain("No readable text, speech bubbles, subtitles, brand names, logos or watermarks anywhere");
    expect(p).toContain(FILM_AVOID);
    for (const bad of ["photorealism", "3D render", "generic AI-art sheen", "chibi", "under 20", "fanservice", "lifestyle scenes with no training", "stock-photo"]) expect(FILM_AVOID, bad).toContain(bad);
    const none = picturePrompt({ style: "wide_moment", visual: "a platform at a meet", typography: "", message: "m" }, { faith: true, fix: "the hands looked wrong" });
    // no direction or place given: the lift as a key frame, no place line
    expect(none).toContain(ART_STYLES.key_frame.look);
    expect(none).not.toContain("The place:");
    expect(none).toContain("never posing for the viewer");
    expect(none).toContain("any Bible stays closed");
    expect(none).toContain("Fix from the last try: the hands looked wrong");
    expect(none).toContain("middle 80% of the height");
    // every angle carries the picture that teaches it
    for (const k of DAILY_TOPIC_KEYS) expect(DAILY_TOPICS[k].picture.length, k).toBeGreaterThan(30);
    expect(DAILY_TOPICS.fatigue_masks_fitness.picture).toContain("resting between heavy squat sets");
    expect(DAILY_TOPICS.long_game.picture).toContain("training log");
  });
});

describe("the review: concrete checks before any score", () => {
  it("passes a clean anime frame, its plate weights and a clock aside", () => {
    expect(reviewVerdict(review(), "")).toEqual({ pass: true, image: [], caption: [] });
    expect(reviewVerdict(review({ text_seen: "20 KG 45 LB" }), "").pass).toBe(true);
    expect(reviewVerdict(review({ text_seen: "RPE 8." }), "RPE 8").pass).toBe(true);
  });

  it("fails misspelled, missing or extra words, any defect, and scores under the bar, on the right side", () => {
    expect(reviewVerdict(review({ text_seen: "Stil heer" }), "still here").image[0]).toContain('read "Stil heer", not "still here"');
    expect(reviewVerdict(review({ text_seen: "SALE" }), "").image[0]).toContain("words that shouldn't be there");
    // an apostrophe the picture added is the same word, and words the planned scene names aren't stray
    expect(reviewVerdict(review({ text_seen: "who are you\nwhen it's quiet?\n5:30 AM" }), "who are you when its quiet?", "a phone alarm set for 5:30 AM").pass).toBe(true);
    expect(reviewVerdict(review({ text_seen: "who are you when its quiet? SALE" }), "who are you when its quiet?", "a phone alarm").image[0]).toContain("extra words in the picture");
    expect(reviewVerdict(review({ defects: ["the barbell has different plates on each side"] }), "").image).toContain("the barbell has different plates on each side");
    // a brand on a plate is stray text
    expect(reviewVerdict(review({ text_seen: "ROGUE" }), "").image[0]).toContain("words that shouldn't be there");
    const low = reviewVerdict(review({ scores: { ...review().scores, writing: 2, aesthetic: 3 }, fix_caption: "say it plainer" }), "");
    expect(low.pass).toBe(false);
    expect(low.caption).toEqual(["writing 2/5", "fix: say it plainer"]);
    expect(low.image).toEqual(["aesthetic 3/5"]);
    expect(REVIEW_BARS.match).toBe(4);
  });

  it("a picture that isn't about strength training is remade, its caption kept", () => {
    expect(reviewVerdict(review({ scores: { ...review().scores, on_topic: 2 } }), "").image).toEqual(["on_topic 2/5"]);
    expect(REVIEW_BARS.on_topic).toBe(4);
    expect(REVIEW_PROMPT).toContain("a lifestyle scene with no training in it (a picnic, a beach, brunch, a party, a park) is 2 or less");
    expect(REVIEW_PROMPT).toContain("equipment or technique that's wrong (a bent or broken barbell, different plates on each side");
    // and the picture has to show the lesson, not just look good
    expect(reviewVerdict(review({ scores: { ...review().scores, teaches: 2 } }), "").image).toEqual(["teaches 2/5"]);
    expect(REVIEW_BARS.teaches).toBe(4);
    expect(REVIEW_PROMPT).toContain("a good-looking gym scene that could go with any post is 2 or less");
    // and the lift, the gear and the bodies drawn so a coach would show it to an athlete
    expect(reviewVerdict(review({ scores: { ...review().scores, technique: 3 } }), "").image).toEqual(["technique 3/5"]);
    expect(REVIEW_BARS.technique).toBe(4);
    expect(REVIEW_PROMPT).toContain("technique = the lift, the equipment and the bodies are drawn right");
    expect(parseReview('{"scores": {}}')?.scores.technique).toBe(4);
    // a review from before the check reads as neutral
    expect(parseReview('{"scores": {}}')?.scores.on_topic).toBe(4);
  });

  it("anything that doesn't read as an anime frame fails, whatever its scores, and so does anything childish", () => {
    expect(reviewVerdict(review({ medium: "illustration" }), "").image[0]).toBe("it reads as illustration, not an anime frame");
    expect(reviewVerdict(review({ medium: "photo" }), "").image[0]).toBe("it reads as photo, not an anime frame");
    expect(reviewVerdict(review({ medium: "3d_render" }), "").pass).toBe(false);
    expect(reviewVerdict(review({ medium: "" }), "").pass).toBe(false);
    expect(parseReview('{"medium": "Photorealistic", "scores": {}}')?.medium).toBe("photo");
    expect(parseReview('{"medium": "anime frame", "scores": {}}')?.medium).toBe("anime");
    expect(parseReview('{"medium": "2D anime", "scores": {}}')?.medium).toBe("anime");
    expect(parseReview('{"medium": "Anime", "scores": {}}')?.medium).toBe("anime");
    expect(parseReview('{"medium": "3D render", "scores": {}}')?.medium).toBe("3d_render");
    // serious and adult, never chibi, cutesy or teenage
    expect(reviewVerdict(review({ maturity: "childish" }), "").image[0]).toBe("it reads as childish, not a mature sports drama");
    expect(parseReview('{"medium": "anime", "maturity": "Mature, adult", "scores": {}}')?.maturity).toBe("mature");
    expect(parseReview('{"medium": "anime", "scores": {}}')?.maturity).toBe("mature");
    expect(REVIEW_PROMPT).toContain("childish (chibi, cutesy, moe, a kids' cartoon, giant eyes, comedic faces, anyone who looks under 20, school uniforms, fanservice)");
    // muddy or murky colour and messy linework fail too
    expect(reviewVerdict(review({ colour: "flat" }), "").image[0]).toBe("its colour reads as flat, not cinematic");
    expect(reviewVerdict(review({ colour: "dark" }), "").pass).toBe(false);
    expect(reviewVerdict(review({ clarity: "messy" }), "").image[0]).toBe("its linework reads as messy, not clean");
    expect(parseReview('{"medium": "anime", "colour": "Cinematic", "clarity": "clean, crisp", "scores": {}}')).toMatchObject({ colour: "cinematic", clarity: "clean" });
  });

  it("a defect is an objective error, never taste (taste is scored and goes in the fix)", () => {
    expect(REVIEW_PROMPT).toContain("Taste is never a defect (the framing, the lighting, empty space, what could be clearer)");
    expect(REVIEW_PROMPT).toContain("4 = good enough to publish");
    // the caption and the picture tell one story: a contradiction in the details fails match
    expect(REVIEW_PROMPT).toContain("any contradiction, like another place, time or person than the caption says, is 3 or less");
    // the writing is judged as a coach's, not a motivation page's
    expect(REVIEW_PROMPT).toContain("reads like an elite powerlifting coach explaining something to an athlete");
  });

  it("reads the reviewer's JSON and averages its scores", () => {
    const r = parseReview('{"text_seen": "", "defects": [], "scores": {"relatable": 5, "original": 4, "writing": 4, "audience_fit": 4, "aesthetic": 5, "storytelling": 4, "match": 5, "engaging": 9}}');
    expect(r?.scores.engaging).toBe(5);
    // a review without the uplift, on_topic, teaches or technique score reads them as neutral (4)
    expect(r?.scores.uplift).toBe(4);
    expect(reviewScore(r!)).toBe(4.3);
    // uplift is the picture's: a gloomy frame is remade, the caption kept
    expect(reviewVerdict(review({ scores: { ...review().scores, uplift: 2 } }), "").image).toEqual(["uplift 2/5"]);
    expect(reviewVerdict(review({ scores: { ...review().scores, uplift: 3 } }), "").pass).toBe(true);
    expect(parseCaption('{"caption": "\\"new words\\""}')).toBe("new words");
  });
});

describe("it learns what the crew likes, and never repeats itself", () => {
  it("doesn't reuse a shot from the last 4 days, light from the last 3 or an angle from the last 4 weeks, and offers a form from the last 2 days last", () => {
    const l = learnDailyVisuals([]);
    const recent = [
      { day: "2026-11-01", style: "backlit", light: "dawn_shafts", format: "coach_note", topic: "sleep_performance", setting: "garage_gym" },
      { day: "2026-11-02", style: "two_frames", light: "night_session", format: "take", topic: "bar_path", setting: "meet_platform" },
    ];
    const c = pickChoices(l, { day: "2026-11-03", recent, rand: () => 0.9, pillar: "recovery" });
    expect(c.pillar).toBe("recovery");
    expect(c.styles).not.toContain("backlit");
    expect(c.styles).not.toContain("two_frames");
    expect(c.lights).not.toContain("dawn_shafts");
    expect(c.lights).toHaveLength(6);
    // a place used in the last week goes to the back of the list, never off it (a meet angle can go back to the meet)
    expect(SETTING_GAP_DAYS).toBe(8);
    expect(c.settings).toHaveLength(DAILY_SETTING_KEYS.length);
    expect(c.settings!.slice(-2).sort()).toEqual(["garage_gym", "meet_platform"]);
    const places = settingLine(c.settings!, recent, "2026-11-03");
    expect(places).toContain('PLACE, as "setting"');
    expect(places.split("\n")[0]).not.toContain("garage_gym");
    expect(places).toContain("Used in the last week, only when the moment needs that place (a meet angle at the meet): ");
    expect(pickChoices(l, { day: "2026-11-20", recent, rand: () => 0.9, pillar: "recovery" }).settings!.slice(-2)).not.toContain("garage_gym");
    // both used in the last 2 days go last, in their order
    expect(c.formats).toEqual(["breakdown", "coach_note", "take"]);
    expect(c.formats.every((f) => DAILY_PILLARS.recovery.formats.includes(f))).toBe(true);
    expect(c.topics).not.toContain("sleep_performance");
    // an angle waits 4 weeks (about 12 posts at 3 a week)
    expect(TOPIC_GAP_DAYS).toBe(28);
    expect(pickChoices(l, { day: "2026-11-25", recent, rand: () => 0.9, pillar: "recovery" }).topics).not.toContain("sleep_performance");
    expect(pickChoices(l, { day: "2026-12-05", recent, rand: () => 0.9, pillar: "recovery" }).topics).toContain("sleep_performance");
    expect(c.topics.every((t) => DAILY_TOPICS[t].pillar === "recovery")).toBe(true);
    // the coach's pick wins, and with no category asked it's picked for the day (never yesterday's)
    expect(pickChoices(l, { day: "2026-11-03", recent, rand: () => 0.9, style: "backlit" }).styles).toEqual(["backlit"]);
    expect(pickChoices(l, { day: "2026-11-03", recent: [{ ...recent[1], pillar: "powerlifting_iq" }], rand: () => 0.9 }).pillar).not.toBe("powerlifting_iq");
    expect(learningsText(l)).toContain("Not enough posted yet");
  });

  it("goes with what's working once it has posts, and still tries the untried sometimes", () => {
    const stats = [1, 2, 3].map((i) => stat({ day: `2026-10-0${i}`, style: "backlit", likers: 4, commenters: 1 }));
    stats.push(...[4, 5, 6].map((i) => stat({ day: `2026-10-0${i}`, style: "two_frames", likers: 0, stopped: 0 })));
    const l = learnDailyVisuals(stats);
    expect(pickChoices(l, { day: "2026-11-03", recent: [], rand: () => 0.9, pillar: "mistakes" }).styles[0]).toBe("backlit");
    expect(pickChoices(l, { day: "2026-11-03", recent: [], rand: () => 0.9, pillar: "mistakes" }).styles.at(-1)).toBe("two_frames");
    expect(pickChoices(l, { day: "2026-11-03", recent: [], rand: () => 0.01, pillar: "mistakes" }).styles[0]).not.toBe("backlit");
    expect(learningsText(l)).toContain("Best shots so far: silhouette and rim light");
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
    const hook = readFileSync("src/routes/api/public/hooks/daily-visuals-tick.ts", "utf8");
    expect(hook).toContain("runDailyVisualTest(supabaseAdmin as any, body.test)");
    // a theme is all a test needs: the audience is everyone
    expect(hook).toContain("if (body?.test?.theme) return");
    expect(server).toContain("if (!(DAILY_THEME_KEYS as string[]).includes(spec.theme))");
    expect(server).toContain('const audience: DailyAudience = "everyone";');
  });

  it("every day there is gets its picture remade with its caption kept, the before kept as a version", () => {
    expect(film).toContain("SET regen = CASE WHEN day = date '2026-11-05' THEN 'full' ELSE 'picture' END,");
    expect(film).toContain("regen_reason = 'restyle'");
    expect(film).toContain("AND coalesce(concept->>'look', '') <> '2d_film';");
    expect(server).toContain("look: FILM_LOOK_VERSION,");
  });
});

describe("the anime look: one house style, a serious powerlifting anime, never a photo or anything childish", () => {
  it("the house style is a premium, mature sports anime, and nothing in the look asks for a photo or a lifestyle scene", () => {
    for (const want of ["Japanese sports anime", "mature, grounded sports drama", "cel shading", "highly detailed background art of a real strength gym", "cinematic lighting"]) expect(FILM_LOOK, want).toContain(want);
    for (const bad of ["photograph", "35mm", "50mm", "documentary", "camera"]) {
      expect(FILM_LOOK, bad).not.toContain(bad);
      for (const l of Object.values(DAILY_LIGHTS)) expect(l.look, bad).not.toContain(bad);
      for (const s of Object.values(DAILY_STYLES)) expect(s.look, bad).not.toContain(bad);
    }
    for (const s of Object.values(DAILY_STYLES)) expect(s.look).not.toMatch(/\b(beach|brunch|picnic|park|rooftop|lake)\b/);
    for (const p of Object.values(DAILY_SETTINGS)) expect(p.look).not.toMatch(/\b(beach|brunch|picnic|park|rooftop|lake|street|kitchen)\b/);
    // nothing murky
    for (const l of Object.values(DAILY_LIGHTS)) expect(l.look).not.toMatch(/\b(dark room|overcast|muddy|gloomy)\b/);
    expect(FILM_LOOK_VERSION).toBe("anime_v1");
  });

  it("three anime directions, each for its kind of point; old looks keep their names", async () => {
    const { ART_STYLES, artForPillar } = await import("@/lib/daily-visuals");
    expect(Object.keys(ART_STYLES)).toEqual(["key_frame", "drama", "insert"]);
    expect(artForPillar("powerlifting_iq")).toBe("key_frame");
    expect(artForPillar("mistakes")).toBe("key_frame");
    expect(artForPillar("recovery")).toBe("drama");
    expect(artForPillar("mindset")).toBe("drama");
    expect(LEGACY_ART_NAMES.anime).toContain("old look");
    expect(LEGACY_ART_NAMES.documentary).toContain("old look");
  });

  it("the place changes post to post: real gyms and meets only, stored with the concept", () => {
    expect(Object.keys(DAILY_SETTINGS).length).toBeGreaterThanOrEqual(8);
    expect(DAILY_SETTING_KEYS).toContain("meet_platform");
    expect(server).toContain("setting: d.concept?.setting ?? null,");
    expect(server).toContain("setting: concept.setting ?? null,");
  });

  it("a picture is made from the words alone: the house style written out in full, no reference frame to copy people or gyms from", () => {
    expect(server).toContain("const made = await maker.picture(picturePrompt(concept, { faith: r.faith, fix: c.fix }));");
    expect(server).not.toContain("seedStyleRefs(");
    expect(server).not.toContain("styleReference(");
    expect(readFileSync("src/components/community/daily-pictures-card.tsx", "utf8")).not.toContain("community_daily_visuals_set_ref");
  });

  it("published posts move to the new look only when the coach approves it; upcoming ones get it, captions kept", () => {
    expect(vivid).toContain("CREATE OR REPLACE FUNCTION public.community_daily_visuals_restyle(_look text)");
    const card = readFileSync("src/components/community/daily-pictures-card.tsx", "utf8");
    expect(card).toContain('db.rpc("community_daily_visuals_restyle", { _look: FILM_LOOK_VERSION })');
    expect(card).toContain("Nothing published changes unless you say so");
    expect(card).toContain("the new look");
    expect(insights).toContain("WHERE status = 'ready' AND post_id IS NULL AND picture IS NOT NULL AND regen IS NULL");
  });
});

describe("captions don't fall back on the same stock moments", () => {
  it("a stock moment a recent post used can't come back, and a joke has to be funny", async () => {
    const { REVIEW_PROMPT, reviewPrompt } = await import("@/lib/daily-visuals");
    const recent = ["nobody cheered when you walked into the gym tonight", "the group chat is out and you hit seen"];
    expect(motifRepeats("you pack your bag and nobody cheered. thats fine", recent)).toEqual(["nobody cheered"]);
    expect(motifRepeats("your mom asks if you live at the gym now", recent)).toEqual([]);
    expect(captionProblems(`Post your form video in the group chat. ${good}`, { format: "coach_note", recent })).toContain(
      'uses "group chat" like a recent post (find a new moment)',
    );
    expect(REVIEW_PROMPT).toContain("a joke that isn't actually funny is 3 or less");
    expect(reviewPrompt({ caption: "c", concept: { message: "m", situation: "s", visual: "v", typography: "", style: "group", format: "mistake", pillar: "mistakes", mood: "direct" }, audience: "everyone" })).toContain("THE CAPTION'S FORM: Mistake");
    expect(reviewPrompt({ caption: "c", concept: { message: "m", situation: "s", visual: "v", typography: "", style: "group", pillar: "mistakes", mood: "direct" }, audience: "everyone" })).toContain("THE KIND OF POST: Training mistakes (a common mistake or belief");
  });
});

describe("a review never copies the picture into memory", () => {
  it("the vision model gets a signed link to the stored picture, the bytes only if signing fails", () => {
    expect(server).toContain("const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);");
    expect(server).toContain("image = await pictureUrl(admin, entry.path, made.picture);");
    expect(server).not.toContain("image = dataUrl(");
  });
});

describe("the coach's seven questions", () => {
  it("each is answered from the editor's and the review's scores, and an older day reads as not checked", () => {
    const pass = qualityChecks(
      { scores: { natural: 5, substance: 4, accuracy: 5, clarity: 5, match: 4, fresh: 4, worth_it: 4 } },
      { scores: review().scores },
    );
    expect(pass.map((c) => c.label)).toEqual([
      "Relevant to athletes",
      "The image shows the lesson",
      "Real coaching value",
      "Sounds like Jared",
      "Technically accurate",
      "Different from recent posts",
      "Worth saving or discussing",
    ]);
    expect(pass.every((c) => c.pass === true)).toBe(true);
    const weak = qualityChecks({ scores: { natural: 5, substance: 3, accuracy: 3, fresh: 2, worth_it: 3 } }, { scores: { ...review().scores, teaches: 2 } });
    expect(weak.filter((c) => c.pass === false).map((c) => c.key)).toEqual(["image", "value", "accurate", "fresh", "worth"]);
    expect(qualityChecks(null, null).every((c) => c.pass === null)).toBe(true);
  });

  it("the same picture twice is a rerun, whatever the words", () => {
    const seen = "A lifter resting between heavy squat sets on a bench, belt loosened, the loaded bar waiting in the rack behind.";
    expect(visualRepeat("A lifter resting between heavy squat sets on a bench, belt loosened, chalk on the hands.", [seen])).toContain("too close to a recent one");
    expect(visualRepeat("A coach and lifter watching a set video on a phone beside the rack.", [seen])).toBeNull();
    expect(server).toContain("const seenPicture = keepPicture ? null : visualRepeat(parsed.visual, ctx.recent.map((x) => x.visual));");
  });

  it("a post that didn't fully pass waits for the coach's OK, and Publish now is his OK", () => {
    expect(insights).toContain("CREATE OR REPLACE FUNCTION public.community_daily_visual_held(r public.community_daily_visuals)");
    expect(insights).toContain("IF public.community_daily_visual_held(r) THEN RETURN jsonb_build_object('status', 'needs_review'); END IF;");
    expect(insights).toContain("-- publishing it now is the coach's OK, even for one held for review");
    const card = readFileSync("src/components/community/daily-pictures-card.tsx", "utf8");
    expect(card).toContain("Needs your OK");
    expect(card).toContain("data-daily-quality");
  });
});

describe("the writer's own clichés are banned outright", () => {
  it("nobody claps / the quiet rep fail even when no recent post used them", () => {
    expect(captionProblems(`${good}\n\nThat's the quiet rep that makes next week easier with no claps.`, { format: "coach_note" })).toEqual(
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
    expect(CONCEPT_PROMPT).toContain("undressed, measuring their body or on a scale");
  });
});
