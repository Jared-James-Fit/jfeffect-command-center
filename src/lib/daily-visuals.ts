/**
 * Daily posts (series `daily_visual`): every morning one post that makes the
 * crew glad they opened the app. A picture and a caption made together, like
 * something a real person would post: a realization that makes someone see
 * their progress differently, a laugh they send to a friend, a moment of
 * belonging, one useful idea, now and then a respectful challenge. Never a
 * feed of AI motivation quotes, and never negativity as the default hook.
 *
 * What a day is about (`pickPillars`): five content pillars with a target mix
 * (DAILY_PILLARS: realization 30%, humour 25%, community 20%, insight 15%,
 * challenge 10%), kept by how far each is behind its share over the last few
 * weeks, nudged by how the crew actually responds (`pillarShares`), never the
 * same pillar two days running and a challenge at most once in 6 days (never
 * on a Sunday). Each pillar has its angles (DAILY_TOPICS, stored as `topic`).
 * Who it's for turns over too: women, men, everyone (`audienceForDay`) and,
 * independently, beginners, lifestyle, serious lifters, everyone
 * (`crowdForDay`). The weekday only sets a mood (DAILY_THEMES), and Sunday's
 * carries a Bible verse (only ever one of FAITH_VERSES, word for word).
 *
 * How one is made (daily-visuals.server.ts):
 *   1. the writer plans the moment and the picture first, then drafts three
 *      captions for it (CONCEPT_PROMPT); `tidyCaption` and `captionProblems`
 *      throw out any that break the hard rules (length, a body put down,
 *      lecturing, slogans and AI phrases, a poem of one-line sentences, the
 *      picture's words repeated, a question ending again, too close to a
 *      recent post);
 *   2. an editor scores the drafts (EDITOR_PROMPT: human, hook, clarity,
 *      match, tight, mobile, relatable, fresh, shareable, feel-good, with
 *      flags for shaming, lecturing, invented claims, generic and negative),
 *      picks the best and polishes it; `editorVerdict` passes it only at every
 *      bar with no flag, else the writer tries again with the editor's notes;
 *   3. the picture: a bright, colourful frame from a premium hand-drawn 2D
 *      animated film (FILM_LOOK), then a review that looks at the picture with
 *      the caption (REVIEW_PROMPT / `reviewVerdict`).
 * It learns from every posted day (likes, comments (more for real ones),
 * saves, shares and reposts, and whether people stopped on it), by pillar,
 * angle, form and shot.
 */
import { JARGON, readingGrade, longestSentence, voiceProblems, words as wordsOf } from "@/lib/plain-words";

export type DailyTheme = "courage" | "patience" | "your_circle" | "self_reflection" | "encouragement" | "self_love" | "emotional";
export type DailyAudience = "women" | "men" | "everyone";
/** The shot: every picture is the same 2D film look, framed one of these ways (stored as `style`). */
export type DailyStyle =
  | "wide_moment"
  | "medium_candid"
  | "two_people"
  | "group"
  | "in_action"
  | "close_detail"
  | "over_shoulder"
  | "low_angle"
  | "framed_view"
  | "backlit"
  | "overhead"
  | "two_frames";
/** The colour and light: vivid pairings, never a muddy or gloomy grade. */
export type DailyLight =
  | "golden_teal"
  | "coral_turquoise"
  | "sunset_violet"
  | "blue_amber"
  | "green_peach"
  | "morning_sun"
  | "clear_noon"
  | "gym_glow"
  | "neon_night";
/** The two art directions (concept.art): A for energy, B for feeling. */
export type DailyArt = "graphic" | "anime";

/* ------------------------------------------------------------------ */
/*  What a day is about                                                */
/* ------------------------------------------------------------------ */

export type DailyPillar = "realization" | "humor" | "community" | "insight" | "challenge";
export type DailyCrowd = "everyone" | "beginners" | "lifestyle" | "lifters";
export type DailyMood = "uplifting" | "proud" | "funny" | "warm" | "curious" | "fired_up" | "thoughtful";
export type DailyFormat = "one_liner" | "quick_take" | "short_story" | "dialogue" | "list" | "tip" | "question";

/** The five content pillars and the mix they start at (a guide the learning nudges, never quotas). */
export const DAILY_PILLARS: Record<DailyPillar, { name: string; share: number; goal: string; guide: string; moods: DailyMood[]; formats: DailyFormat[] }> = {
  realization: {
    name: "Realization",
    share: 0.3,
    goal: "a small epiphany that makes them see themselves, their progress or fitness differently, and feel good about it",
    guide: "A genuine human observation, never an inspirational speech. Often it starts from an ordinary moment and turns it so they notice something they'd overlooked.",
    moods: ["uplifting", "proud", "thoughtful"],
    formats: ["one_liner", "quick_take", "short_story", "list"],
  },
  humor: {
    name: "Humour",
    share: 0.25,
    goal: "a real laugh at something every lifter recognizes, the kind they send to a friend",
    guide: "Affectionate, specific and true, never mean. Laughing with the crew, never at anyone's body.",
    moods: ["funny"],
    formats: ["one_liner", "dialogue", "list", "quick_take", "short_story"],
  },
  community: {
    name: "Community",
    share: 0.2,
    goal: "they feel part of something: the people, the friendships, the shared moments",
    guide: "The warmth of training with and around people. Make them want to cheer someone on or say hi to someone new.",
    moods: ["warm", "funny", "uplifting"],
    formats: ["quick_take", "short_story", "question", "one_liner", "list"],
  },
  insight: {
    name: "Insight",
    share: 0.15,
    goal: "one useful idea that clicks and makes training, eating or recovering easier",
    guide: "Explained so simply it feels obvious afterwards, with why it helps. Only well-known, safe basics, no numbers or studies.",
    moods: ["curious", "uplifting"],
    formats: ["tip", "quick_take", "list", "one_liner"],
  },
  challenge: {
    name: "Challenge",
    share: 0.1,
    goal: "a respectful nudge or an honest truth that leaves them capable and fired up, never ashamed",
    guide: "From someone who believes in them. It can be direct, but it's on their side and ends with something they can do.",
    moods: ["fired_up", "thoughtful"],
    formats: ["quick_take", "one_liner", "tip", "short_story"],
  },
};
export const DAILY_PILLAR_KEYS = Object.keys(DAILY_PILLARS) as DailyPillar[];

/** Each pillar's angles (stored as `topic`). */
export const DAILY_TOPICS = {
  progress_noticed: { pillar: "realization", name: "Progress you stopped noticing", idea: "the moment you notice how far you've come: the weight that used to be your max is your warm-up now, the stairs, the hike, the jeans" },
  confidence_grown: { pillar: "realization", name: "Confidence", idea: "realizing you carry yourself differently: you walk into the gym like you belong, you try the new thing, you take up space" },
  more_than_looks: { pillar: "realization", name: "More than looks", idea: "fitness paying off where the mirror can't see it: sleep, mood, patience, energy for the people you love, every grocery bag in one trip" },
  actually_enjoy_it: { pillar: "realization", name: "Actually enjoying it", idea: "the day you realize training is something you look forward to now, not something you force yourself through" },
  new_identity: { pillar: "realization", name: "Who you're becoming", idea: "becoming someone who trains without debating it; the old you would be surprised, and proud" },
  small_milestones: { pillar: "realization", name: "Small milestones", idea: "a small first worth being proud of: the first pull-up, the first full week, the first time the bar felt light" },
  whats_possible: { pillar: "realization", name: "What's possible", idea: "getting excited about what's next now that you're stronger: the race, the meet, the trip, the hike you wouldn't have tried a year ago" },
  kinder_to_yourself: { pillar: "realization", name: "Kinder to yourself", idea: "noticing you talk to yourself better than you used to; a missed day isn't a disaster anymore, just a Tuesday" },
  gym_floor_comedy: { pillar: "humor", name: "Gym floor comedy", idea: "a funny, true observation from the gym floor that every lifter recognizes (fresh, never the tired old gym jokes)" },
  expectation_reality: { pillar: "humor", name: "Expectation vs reality", idea: "the plan versus what actually happens: the 5 am alarm, the 'quick' workout, meal prep Sunday" },
  food_life: { pillar: "humor", name: "Food life", idea: "affectionate jokes about eating well: protein in everything, the snack negotiation, the container collection, never anyone's body" },
  lifter_habits: { pillar: "humor", name: "Lifter habits", idea: "the habits only people who train have: the playlist ritual, stairs after leg day, judging every bench and chair as gym equipment" },
  strong_in_real_life: { pillar: "humor", name: "Strong in real life", idea: "the funny moments when training shows up in normal life: opening every jar, carrying the couch, racing the kids" },
  training_partners: { pillar: "community", name: "Training partners", idea: "the friend who makes you show up, spots you, hypes you, texts 'you up?' at 5:45" },
  cheering_others: { pillar: "community", name: "Cheering for others", idea: "the joy of watching someone else hit a PR or show up for the first time; their win feels like yours" },
  first_days: { pillar: "community", name: "Day one", idea: "being new, first-day nerves, and how fast the gym starts to feel like yours; then welcoming the next new person" },
  gym_friendships: { pillar: "community", name: "Gym friendships", idea: "friendships that started with a shared rack or a nod between sets and turned into the real thing" },
  crew_rituals: { pillar: "community", name: "Crew rituals", idea: "the little shared rituals: the coffee after, the Saturday session, the playlist argument, the high five after the last set" },
  ask_the_crew: { pillar: "community", name: "Ask the crew", idea: "a fun, easy question everyone wants to answer: the song that never fails, the best post-workout meal, the first lift you were proud of" },
  training_clicks: { pillar: "insight", name: "Training, explained", idea: "a training idea explained so it finally clicks: getting stronger in tiny steps, why rest days build you, why easier weeks help" },
  eating_made_simple: { pillar: "insight", name: "Eating, made simple", idea: "a simple, unrestrictive food idea: protein at each meal, eating enough to train well, water, planning one meal ahead" },
  recovery_wins: { pillar: "insight", name: "Recovery", idea: "how sleep, walks and rest days make you stronger, framed as part of the fun, not a chore" },
  one_good_cue: { pillar: "insight", name: "One good cue", idea: "one well-known technique cue that makes a common exercise feel better right away" },
  myth_busted: { pillar: "insight", name: "Myth, busted", idea: "a common fitness myth set straight in a friendly way (soreness isn't the goal, lifting won't suddenly make you bulky, cardio doesn't erase your gains)" },
  friendly_nudge: { pillar: "challenge", name: "A friendly nudge", idea: "a warm nudge about showing up this week, from someone who believes they can" },
  try_something_new: { pillar: "challenge", name: "Try something new", idea: "an invitation to try one new thing this week: a class, a heavier set with good form, a new route, training with a friend" },
  honest_and_kind: { pillar: "challenge", name: "Honest, and kind", idea: "a fair, respectful truth about progress that leaves them capable and motivated, never ashamed" },
  mini_challenge: { pillar: "challenge", name: "Mini challenge", idea: "a small, doable challenge for the week: a walk after dinner, one extra glass of water, bed 30 minutes earlier" },
} as const satisfies Record<string, { pillar: DailyPillar; name: string; idea: string }>;
export type DailyTopic = keyof typeof DAILY_TOPICS;
export const DAILY_TOPIC_KEYS = Object.keys(DAILY_TOPICS) as DailyTopic[];
export const topicsOf = (p: DailyPillar): DailyTopic[] => DAILY_TOPIC_KEYS.filter((k) => DAILY_TOPICS[k].pillar === p);

/** The first version's topics and forms, for the names (and the pillar, for the learning) of days made before. */
export const LEGACY_TOPICS: Record<string, { name: string; pillar: DailyPillar | null }> = {
  confidence: { name: "Confidence and self-worth", pillar: "realization" },
  discipline: { name: "Discipline and consistency", pillar: "challenge" },
  body_image: { name: "Body image", pillar: null },
  ambition: { name: "Ambition and growth", pillar: "realization" },
  relationships: { name: "Relationships", pillar: "community" },
  resilience: { name: "Resilience", pillar: "challenge" },
  burnout: { name: "Stress and burnout", pillar: null },
  overwhelm: { name: "Feeling overwhelmed", pillar: null },
  identity: { name: "Who you're becoming", pillar: "realization" },
  small_wins: { name: "Small wins", pillar: "realization" },
  hard_truths: { name: "Hard truths", pillar: "challenge" },
  humor_shared: { name: "Shared humour", pillar: "humor" },
};
export const LEGACY_FORMAT_NAMES: Record<string, string> = { observation: "Observation", humor: "Humour", scenario: "Relatable moment", encouragement: "Encouragement" };

export const topicName = (t: string | null | undefined): string | null =>
  !t ? null : t in DAILY_TOPICS ? DAILY_TOPICS[t as DailyTopic].name : (LEGACY_TOPICS[t]?.name ?? null);
export const formatName = (f: string | null | undefined): string | null =>
  !f ? null : f in DAILY_FORMATS ? DAILY_FORMATS[f as DailyFormat].name : (LEGACY_FORMAT_NAMES[f] ?? null);
/** A day's pillar: the concept's own, else its angle's (the first version's topics map where they can). */
export function pillarOf(o: { pillar?: string | null; topic?: string | null } | null | undefined): DailyPillar | null {
  if (!o) return null;
  if (o.pillar && o.pillar in DAILY_PILLARS) return o.pillar as DailyPillar;
  if (o.topic && o.topic in DAILY_TOPICS) return DAILY_TOPICS[o.topic as DailyTopic].pillar;
  return (o.topic && LEGACY_TOPICS[o.topic]?.pillar) || null;
}

/** How a caption is told, and how long it may run (characters). No minimum: a post is as long as the idea deserves. */
export const DAILY_FORMATS: Record<DailyFormat, { name: string; guide: string; max: number; lines?: boolean }> = {
  one_liner: { name: "One-liner", guide: "one or two sentences, and that's the whole post", max: 170 },
  quick_take: { name: "Quick take", guide: "a short observation or realization in 2 to 4 sentences, in one or two short paragraphs", max: 360 },
  short_story: { name: "Short story", guide: "a tiny scene in two or three short paragraphs that lands on the realization, the laugh or the warm moment", max: 580 },
  dialogue: { name: "Dialogue", guide: "a funny exchange on 2 to 4 short lines ('me: …' / 'my legs: …'), one line each, nothing explained after", max: 240, lines: true },
  list: { name: "List", guide: "a one-line setup, then 3 or 4 short items each on its own line (no bullets or numbers), maybe one closing line", max: 400, lines: true },
  tip: { name: "Tip", guide: "one useful idea: what it is and why it helps, in 2 to 4 plain sentences, maybe how to try it this week", max: 440 },
  question: { name: "Question", guide: "a fun, easy question for the crew with a line of context, the kind people actually answer", max: 240 },
};
export const DAILY_FORMAT_KEYS = Object.keys(DAILY_FORMATS) as DailyFormat[];

/** Who it's for, besides women / men / everyone: where they are with training. */
export const DAILY_CROWDS: Record<DailyCrowd, { name: string; guide: string }> = {
  everyone: { name: "Everyone", guide: "anyone who trains, from week one to year ten" },
  beginners: { name: "Beginners", guide: "people in their first months: a bit nervous, excited, learning the basics, surprised by their own progress" },
  lifestyle: { name: "Lifestyle", guide: "people who train to feel good and live well, around work, family and a social life" },
  lifters: { name: "Serious lifters", guide: "people who chase PRs, follow a program, know their numbers and love the details" },
};
const CROWD_ORDER: DailyCrowd[] = ["everyone", "beginners", "lifestyle", "lifters"];

const dayIndex = (day: string) => Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse("2026-01-05T12:00:00Z")) / 86_400_000);

/** Who a day's post is for: women, men, then everyone, so each weekday turns over every week. */
export function audienceForDay(day: string): DailyAudience {
  const days = dayIndex(day);
  return (["women", "men", "everyone"] as const)[((days % 3) + 3) % 3];
}

/** Where they are with training, on its own 4-day turn (so with the 3-day one above, 12 different pairs). */
export function crowdForDay(day: string): DailyCrowd {
  const days = dayIndex(day);
  return CROWD_ORDER[((days % 4) + 4) % 4];
}

/* ------------------------------------------------------------------ */
/*  The week                                                           */
/* ------------------------------------------------------------------ */

type ThemeSpec = {
  /** ISO weekday: Monday = 1 … Sunday = 7. */
  dow: number;
  name: string;
  /** The day's mood, a light touch on top of the pillar. */
  idea: string;
  /** Pillars that suit the day a little better (a small nudge in `pickPillars`). */
  lean: Partial<Record<DailyPillar, number>>;
};

/** A mood a day (Monday first; the keys are the database's, kept from the first version). Sunday's is the faith post. */
export const DAILY_THEMES: Record<DailyTheme, ThemeSpec> = {
  courage: { dow: 1, name: "Fresh start", idea: "Monday: a new week, a fresh start, something worth starting", lean: { realization: 0.3, challenge: 0.2 } },
  patience: { dow: 2, name: "The long game", idea: "Tuesday: enjoying the process and the long game", lean: { insight: 0.3 } },
  your_circle: { dow: 3, name: "Your people", idea: "Wednesday: the people you train with and around", lean: { community: 0.4 } },
  self_reflection: { dow: 4, name: "How far you've come", idea: "Thursday: noticing how far you've come", lean: { realization: 0.3, insight: 0.1 } },
  encouragement: { dow: 5, name: "Celebrate", idea: "Friday: celebrating the week and having fun with it", lean: { humor: 0.4, community: 0.1 } },
  self_love: { dow: 6, name: "Enjoy it", idea: "Saturday: movement for fun, sunshine, friends, enjoying life", lean: { humor: 0.2, community: 0.2 } },
  emotional: { dow: 7, name: "Rest & reset", idea: "Sunday: rest, gratitude and a calm reset for the week", lean: { realization: 0.3, community: 0.2 } },
};

export const DAILY_THEME_KEYS = Object.keys(DAILY_THEMES) as DailyTheme[];

export function themeForDow(dow: number): DailyTheme {
  return DAILY_THEME_KEYS.find((k) => DAILY_THEMES[k].dow === dow) ?? "encouragement";
}

export const DAILY_AUDIENCE_GUIDE: Record<DailyAudience, string> = {
  women: "Women in the crew: strong, busy, funny, ambitious, at every level. Confidence and strength, never how she should look.",
  men: "Men in the crew: training, work, family, friends, at every level. Real and warm, never macho or preachy.",
  everyone: "Everyone in the crew: a moment anyone sees themselves in.",
};

/* ------------------------------------------------------------------ */
/*  The look                                                           */
/* ------------------------------------------------------------------ */

/**
 * The look: a frame from a premium, colourful, hand-drawn 2D animated film,
 * bright and crisp enough to stop someone scrolling. Two art directions share
 * it (ART_STYLES: A vibrant graphic 2D, B cinematic 2D anime), picked for the
 * story; variety comes from the moment, the shot and the colour and light.
 * When the coach has given style references (Crew → Posts → Daily pictures),
 * the image model gets the one for the art direction to match.
 * FILM_LOOK_VERSION marks which days are in this look (concept.look).
 */
export const FILM_LOOK_VERSION = "film_v3";

export const FILM_LOOK =
  "A frame from a premium, colourful, hand-drawn 2D animated feature film. Crisp, confident, clean linework; refined cel shading with clean, crisp shadow shapes; rich, vibrant, saturated colour with strong warm-versus-cool contrast; bright, luminous light with glowing highlights; a detailed, beautifully illustrated background with depth; expressive, attractive, naturally proportioned adult characters with clean, sharp, well-drawn faces and clear expressions; a clear focal point and a strong, intentional composition. Polished, bright and striking, made to stop someone scrolling.";

export const ART_STYLES: Record<DailyArt, { name: string; look: string; use: string }> = {
  graphic: {
    name: "A · Vibrant graphic 2D",
    look: "Art direction A, vibrant graphic 2D illustration like a premium animated film's key art: crisp dark ink outlines and flat cel shading with clean, hard-edged shadow shapes and a light hatched texture; a warm coral-red, terracotta and golden-yellow palette set against teal and blue-grey shadows; dramatic hard-edged shafts of sunlight beaming through windows across the scene, dust glowing in them; a dense, lived-in environment where every object is drawn (plates, racks, shelves, tools, plants); bold, deep one-point compositions with a bright window or doorway behind the subject.",
    use: "fitness, ambition, confidence, discipline, humour and exciting everyday moments",
  },
  anime: {
    name: "B · Cinematic 2D anime",
    look: "Art direction B, beautiful cinematic 2D anime like a frame from a modern anime film: thin, clean, confident linework; two-tone cel shading with one soft shadow tone; a glowing golden-hour or sunset sky with soft painted clouds and silhouetted buildings and trees; warm sunlight flooding the frame and a bright rim light glowing along the hair and face; complementary colours in the clothes and scene (orange against teal, gold against blue); calm, expressive faces in profile or three-quarter view; intimate medium close-ups.",
    use: "relationships, self-worth, lifestyle, personal growth, reflection and relatable everyday life",
  },
};
export const DAILY_ART_KEYS = Object.keys(ART_STYLES) as DailyArt[];

/** What it must never look like (the muddy, dark first tries included). */
export const FILM_AVOID =
  "Avoid: brown or grey colour grading, desaturated or muted colour, a dark, gloomy or murky scene, heavy film grain or dirty textures, low contrast, flat lifeless colour, blurry, smudged or painterly faces, watercolour or oil-painting looks, photorealism or a photograph, 3D, CGI or Pixar-like rendering, plastic skin, childish cartoon proportions, exaggerated anime expressions or giant eyes, a motivational poster, logos or watermarks.";

export const DAILY_STYLES: Record<DailyStyle, { name: string; look: string }> = {
  wide_moment: { name: "Wide scene", look: "a wide shot, the person in a beautifully illustrated place full of life and colour (a busy gym, a city street, a park, a beach path, a rooftop)." },
  medium_candid: { name: "Candid moment", look: "a medium shot caught mid-moment, what they're doing and how they feel reading clearly from their posture, face and hands." },
  two_people: { name: "Two people", look: "two people together (friends, a couple, training partners, a parent and grown child), the relationship in how they stand, laugh and look at each other." },
  group: { name: "Group", look: "a few people together (a gym crew, friends at brunch, teammates), the energy and humour between them." },
  in_action: { name: "In action", look: "mid-action with motion and energy: a heavy lift, a sprint, a laugh, a high five, a jump into the lake." },
  close_detail: { name: "Close-up detail", look: "a close-up on hands and the things that tell the story (chalk on fingers, the knurl of a barbell, laced shoes, a shared meal), the person partly in frame." },
  over_shoulder: { name: "Over the shoulder", look: "over the shoulder, seeing what they see: the bar waiting on the platform, a friend waving them over, the city from a rooftop." },
  low_angle: { name: "Low angle", look: "a low angle looking up at them, a moment of confidence, bright sky or glowing lights behind them." },
  framed_view: { name: "Framed view", look: "framed through a doorway, a window or the edge of a mirror, as if we're watching a moment we weren't meant to see." },
  backlit: { name: "Backlit", look: "backlit by a big window or a low sun, a glowing rim of light around the person, long colourful shadows." },
  overhead: { name: "From above", look: "a top-down view of the moment (a gym floor, a picnic blanket, a kitchen table with a meal and a notebook)." },
  two_frames: { name: "Two frames", look: "two frames side by side like a storyboard, the same person in two moments (expectation and reality, before and after, Monday and Friday), the joke or the change living between them." },
};
export const DAILY_STYLE_KEYS = Object.keys(DAILY_STYLES) as DailyStyle[];

/** The colour and light, so a week never has the same mood twice, and never a dull one. */
export const DAILY_LIGHTS: Record<DailyLight, { name: string; look: string }> = {
  golden_teal: { name: "Golden and teal", look: "golden-hour sun with deep teal shadows, glowing warm highlights" },
  coral_turquoise: { name: "Coral and turquoise", look: "coral-orange light against a turquoise sky or water" },
  sunset_violet: { name: "Sunset pink and violet", look: "a sunset sky of pink and violet, warm golden rim light on the people" },
  blue_amber: { name: "Blue and amber", look: "bright blue daylight with warm amber lights and accents" },
  green_peach: { name: "Green and peach", look: "fresh greens and soft peach morning sunlight" },
  morning_sun: { name: "Morning sun", look: "bright morning sun pouring through big windows, crisp shadows, clean warm highlights" },
  clear_noon: { name: "Clear noon", look: "a clear, saturated blue sky with crisp white clouds, bright midday colour" },
  gym_glow: { name: "Gym glow", look: "a gym lit by warm golden spotlights and cool blue window light, strong contrast" },
  neon_night: { name: "Neon night", look: "a night lit by vivid neon pink and electric blue, strong contrast and one bright focal light" },
};
export const DAILY_LIGHT_KEYS = Object.keys(DAILY_LIGHTS) as DailyLight[];

/** Shots and lights from earlier looks, for the names of days made before. */
export const LEGACY_SHOT_NAMES: Record<string, string> = {
  phone_story: "Phone story",
  golden_hour: "Golden hour",
  blue_hour: "Blue hour",
  morning_window: "Morning window",
  warm_lamp: "Warm lamp",
  overcast: "Overcast",
  gym_morning: "Gym morning",
  rainy_evening: "Rainy evening",
  night_city: "Night city",
  sunrise: "Sunrise",
};

/** The first version's media, for the names of days made before the 2D film look. */
export const LEGACY_STYLE_NAMES: Record<string, string> = {
  photo: "Photo",
  illustration: "Illustration",
  cinematic_photo: "Cinematic photo",
  minimal_illustration: "Minimal illustration",
  pencil_sketch: "Pencil sketch",
  ink_drawing: "Ink drawing",
  watercolor: "Watercolour",
  vintage_fitness: "Vintage fitness art",
  editorial_illustration: "Editorial illustration",
  conceptual: "Conceptual art",
  comic: "Comic",
  typography: "Typography",
  mixed_media: "Mixed media",
  graphic_design: "Graphic design",
};

/* ------------------------------------------------------------------ */
/*  The faith post                                                     */
/* ------------------------------------------------------------------ */

/** A Bible verse for the weekly faith post: the King James words exactly (public domain), never a model's. */
export type FaithVerse = { ref: string; text: string };

export const FAITH_VERSES: FaithVerse[] = [
  { ref: "Psalm 46:10", text: "Be still, and know that I am God" },
  { ref: "Matthew 11:28", text: "Come unto me, all ye that labour and are heavy laden, and I will give you rest." },
  { ref: "Psalm 30:5", text: "weeping may endure for a night, but joy cometh in the morning." },
  { ref: "Psalm 34:18", text: "The LORD is nigh unto them that are of a broken heart" },
  { ref: "1 Peter 5:7", text: "Casting all your care upon him; for he careth for you." },
  { ref: "Lamentations 3:22-23", text: "his compassions fail not. They are new every morning" },
  { ref: "Isaiah 40:31", text: "they that wait upon the LORD shall renew their strength" },
  { ref: "Joshua 1:9", text: "Be strong and of a good courage; be not afraid" },
  { ref: "Psalm 139:14", text: "I am fearfully and wonderfully made" },
  { ref: "Galatians 6:9", text: "let us not be weary in well doing: for in due season we shall reap, if we faint not." },
  { ref: "Proverbs 27:17", text: "Iron sharpeneth iron; so a man sharpeneth the countenance of his friend." },
  { ref: "Psalm 118:24", text: "This is the day which the LORD hath made; we will rejoice and be glad in it." },
  { ref: "Matthew 6:34", text: "Take therefore no thought for the morrow: for the morrow shall take thought for the things of itself." },
  { ref: "Psalm 23:1", text: "The LORD is my shepherd; I shall not want." },
  { ref: "Proverbs 24:16", text: "For a just man falleth seven times, and riseth up again" },
  { ref: "2 Timothy 1:7", text: "For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind." },
];

/** The verse used least recently (`used` oldest first), so every verse goes once before one comes back. */
export function pickVerse(used: string[]): FaithVerse {
  const last = new Map<string, number>();
  used.forEach((ref, i) => last.set(ref, i));
  const never = FAITH_VERSES.filter((v) => !last.has(v.ref));
  if (never.length) return never[0];
  return [...FAITH_VERSES].sort((a, b) => (last.get(a.ref) ?? -1) - (last.get(b.ref) ?? -1))[0];
}

/** The post's words: the caption, and on Sunday the verse under it with where it's from (the same as the SQL caption). */
export function dailyCaption(line: string, verse?: FaithVerse | null): string {
  const words = line.trim();
  return verse ? `${words}\n\n“${verse.text.trim()}” ${verse.ref}` : words;
}


/* ------------------------------------------------------------------ */
/*  Learning                                                           */
/* ------------------------------------------------------------------ */

/** One posted daily picture and how the crew took it (community_daily_visual_stats). */
export type VisualStat = {
  day: string;
  theme: DailyTheme;
  audience: DailyAudience;
  style: DailyStyle | string;
  format?: DailyFormat | string | null;
  topic?: DailyTopic | string | null;
  pillar?: DailyPillar | string | null;
  crowd?: DailyCrowd | string | null;
  mood?: DailyMood | string | null;
  line: string;
  shot?: string | null;
  viewers: number;
  likers: number;
  commenters: number;
  /** Commenters who wrote something real (more than a few words or a reply), not just an emoji. */
  meaningful?: number;
  savers: number;
  /** Shared to a story or reposted. */
  sharers?: number;
  reached: number;
  stopped: number;
  median_ms: number | null;
};

/** Below this many posts a pillar, angle, style or form is still a guess. */
export const LEARN_MIN_POSTS = 3;
/** How often the next post is offered something that hasn't proven itself yet, so it keeps finding out. */
export const EXPLORE_SHARE = 0.25;
/** A caption past this is "long" for the learning (several short paragraphs). */
export const LONG_CAPTION = 200;

/**
 * How well one did: what people did with it per person who saw it (a real
 * comment, a save and a share count far more than a like: they're the
 * satisfying interactions, not just a scroll-by), plus how many stopped on it.
 */
export function visualScore(s: VisualStat): number {
  const seen = Math.max(s.viewers, s.likers, 1);
  const points = s.likers + 3 * s.commenters + 2 * (s.meaningful ?? 0) + 4 * s.savers + 5 * (s.sharers ?? 0);
  const hold = s.reached >= 3 ? s.stopped / s.reached : 0.5;
  // smoothed toward one reaction in three views, so a single like on two views isn't a landslide
  return (points + 0.33 * 3) / (seen + 3) + 0.5 * hold;
}

export type Arm = { n: number; mean: number };
const arm = (xs: VisualStat[]): Arm => ({ n: xs.length, mean: xs.length ? xs.reduce((t, s) => t + visualScore(s), 0) / xs.length : 0 });
function arms<K extends string>(stats: VisualStat[], key: (s: VisualStat) => string | null | undefined, keys: readonly K[]): Record<K, Arm> {
  return Object.fromEntries(keys.map((k) => [k, arm(stats.filter((s) => key(s) === k))])) as Record<K, Arm>;
}

export type DailyLearnings = {
  posts: number;
  pillar: Record<DailyPillar, Arm>;
  style: Record<DailyStyle, Arm>;
  format: Record<DailyFormat, Arm>;
  topic: Record<DailyTopic, Arm>;
  audience: Record<DailyAudience, Arm>;
  crowd: Record<DailyCrowd, Arm>;
  length: { short: Arm; long: Arm };
  best: VisualStat[];
  worst: VisualStat[];
};

export function learnDailyVisuals(stats: VisualStat[]): DailyLearnings {
  const ranked = [...stats].sort((a, b) => visualScore(b) - visualScore(a));
  return {
    posts: stats.length,
    pillar: arms(stats, (s) => pillarOf(s), DAILY_PILLAR_KEYS),
    style: arms(stats, (s) => s.style, DAILY_STYLE_KEYS),
    format: arms(stats, (s) => s.format, DAILY_FORMAT_KEYS),
    topic: arms(stats, (s) => s.topic, DAILY_TOPIC_KEYS),
    audience: arms(stats, (s) => s.audience, ["women", "men", "everyone"] as const),
    crowd: arms(stats, (s) => s.crowd, CROWD_ORDER),
    length: { short: arm(stats.filter((s) => s.line.length <= LONG_CAPTION)), long: arm(stats.filter((s) => s.line.length > LONG_CAPTION)) },
    best: ranked.slice(0, 3),
    worst: ranked.length > 5 ? ranked.slice(-2) : [],
  };
}

/** Proven ones first (best mean), then the untried, then the proven-weak; `rand` < EXPLORE_SHARE puts an untried one first. */
function rank<K extends string>(keys: K[], a: Record<K, Arm>, rand: number): K[] {
  const proven = keys.filter((k) => a[k].n >= LEARN_MIN_POSTS).sort((x, y) => a[y].mean - a[x].mean);
  const avg = proven.length ? proven.reduce((t, k) => t + a[k].mean, 0) / proven.length : 0;
  const strong = proven.filter((k) => a[k].mean >= avg);
  const weak = proven.filter((k) => a[k].mean < avg);
  const untried = keys.filter((k) => a[k].n < LEARN_MIN_POSTS);
  // a stable spin of the untried, so the same one isn't always offered first
  const spun = untried.map((k, i) => ({ k, o: (i * 7 + Math.floor(rand * 997)) % untried.length })).sort((x, y) => x.o - y.o).map((x) => x.k);
  return rand < EXPLORE_SHARE ? [...spun, ...strong, ...weak] : [...strong, ...spun, ...weak];
}

/** How far the learning may move a pillar from its starting share, either way. */
export const PILLAR_NUDGE = { min: 0.75, max: 1.3 } as const;

/**
 * The mix to aim for: the starting shares, each nudged (within PILLAR_NUDGE)
 * by how its posts do against the others once it has LEARN_MIN_POSTS of them.
 * A challenge never goes above its starting share: it's the seasoning.
 */
export function pillarShares(l: Pick<DailyLearnings, "pillar">): Record<DailyPillar, number> {
  const proven = DAILY_PILLAR_KEYS.filter((k) => l.pillar[k].n >= LEARN_MIN_POSTS);
  const avg = proven.length ? proven.reduce((t, k) => t + l.pillar[k].mean, 0) / proven.length : 0;
  const raw = Object.fromEntries(
    DAILY_PILLAR_KEYS.map((k) => {
      const base = DAILY_PILLARS[k].share;
      const m = proven.includes(k) && avg > 0 ? Math.min(PILLAR_NUDGE.max, Math.max(PILLAR_NUDGE.min, l.pillar[k].mean / avg)) : 1;
      return [k, k === "challenge" ? Math.min(base, base * m) : base * m];
    }),
  ) as Record<DailyPillar, number>;
  const total = DAILY_PILLAR_KEYS.reduce((t, k) => t + raw[k], 0);
  return Object.fromEntries(DAILY_PILLAR_KEYS.map((k) => [k, raw[k] / total])) as Record<DailyPillar, number>;
}

/** The days a pillar's share is counted over. */
export const PILLAR_WINDOW = 20;
/** A challenge at most once in this many days. */
export const CHALLENGE_GAP = 6;

const dowOf = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const gap = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

/**
 * Today's pillar, best first: the one furthest behind its share over the
 * days around it (PILLAR_WINDOW), plus the weekday's small lean. Never the
 * same as the day before or after, and a challenge only when there's been
 * none within CHALLENGE_GAP days, never on a Sunday.
 */
export function pickPillars(l: Pick<DailyLearnings, "pillar">, day: string, around: { day: string; pillar?: DailyPillar | string | null }[], rand: () => number = Math.random): DailyPillar[] {
  const shares = pillarShares(l);
  const others = around.filter((a) => a.day !== day && a.pillar && a.pillar in DAILY_PILLARS);
  const window = others.filter((a) => gap(a.day, day) <= PILLAR_WINDOW);
  const n = window.length + 1;
  const count = (p: DailyPillar) => window.filter((a) => a.pillar === p).length;
  const neighbours = new Set(others.filter((a) => gap(a.day, day) === 1).map((a) => a.pillar));
  const recentChallenge = others.some((a) => a.pillar === "challenge" && gap(a.day, day) < CHALLENGE_GAP);
  const dow = dowOf(day);
  const lean = DAILY_THEMES[themeForDow(dow)].lean;
  const allowed = DAILY_PILLAR_KEYS.filter((p) => !neighbours.has(p) && !(p === "challenge" && (dow === 7 || recentChallenge)));
  const pool = allowed.length ? allowed : DAILY_PILLAR_KEYS.filter((p) => p !== "challenge");
  const score = (p: DailyPillar) => shares[p] * n - count(p) + (lean[p] ?? 0) + rand() * 0.05;
  return pool.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s).map((x) => x.p);
}

export type Recent = {
  day: string;
  style?: string | null;
  light?: string | null;
  format?: string | null;
  topic?: string | null;
  pillar?: string | null;
  mood?: string | null;
  caption?: string | null;
};

export type Choices = { pillar: DailyPillar; topics: DailyTopic[]; formats: DailyFormat[]; styles: DailyStyle[]; lights: DailyLight[] };

/**
 * What the next concept may use: today's pillar (`pickPillars`, or the one
 * asked for), its angles not used in the last 2 weeks, its forms not used in
 * the last 2 days, shots not used in the last 4 and light not in the last 3,
 * best first. `recent` is the days around, nearest last.
 */
export function pickChoices(
  l: DailyLearnings,
  o: { day: string; recent: Recent[]; rand?: () => number; style?: DailyStyle | null; pillar?: DailyPillar | null },
): Choices {
  const rand = o.rand ?? Math.random;
  const near = (n: number) => o.recent.filter((r) => gap(r.day, o.day) <= n && r.day !== o.day);
  const used = (n: number, f: (r: Recent) => string | null | undefined) => new Set(near(n).map(f).filter(Boolean) as string[]);
  const pillar = o.pillar ?? pickPillars(l, o.day, o.recent.map((r) => ({ day: r.day, pillar: pillarOf(r) })), rand)[0];
  const usedTopics = used(14, (r) => r.topic);
  const all = topicsOf(pillar);
  const fresh = all.filter((t) => !usedTopics.has(t));
  const topics = rank(fresh.length ? fresh : all, l.topic, rand());
  const usedFormats = used(2, (r) => r.format);
  const fits = DAILY_PILLARS[pillar].formats;
  const formatsFresh = fits.filter((f) => !usedFormats.has(f));
  const formats = rank(formatsFresh.length ? formatsFresh : fits, l.format, rand());
  const usedStyles = used(4, (r) => r.style);
  const styles = o.style ? [o.style] : rank(DAILY_STYLE_KEYS.filter((s) => !usedStyles.has(s)), l.style, rand());
  const usedLights = used(3, (r) => r.light);
  const spin = Math.floor(rand() * DAILY_LIGHT_KEYS.length);
  const lights = DAILY_LIGHT_KEYS.filter((k) => !usedLights.has(k)).map((k, i, a) => a[(i + spin) % a.length]);
  return { pillar, topics, formats, styles: styles.length ? styles : DAILY_STYLE_KEYS, lights: lights.length ? lights : DAILY_LIGHT_KEYS };
}

/** What's worked, in plain words, for the writer and the coach's card. */
export function learningsText(l: DailyLearnings): string {
  if (l.posts < LEARN_MIN_POSTS) return "Not enough posted yet to tell what works. Trying the full mix of pillars, shots and forms.";
  const best = <K extends string>(a: Record<K, Arm>, name: (k: K) => string) =>
    (Object.keys(a) as K[])
      .filter((k) => a[k].n >= 2)
      .sort((x, y) => a[y].mean - a[x].mean)
      .slice(0, 2)
      .map(name);
  const out: string[] = [];
  const pillars = best(l.pillar, (k) => DAILY_PILLARS[k as DailyPillar].name.toLowerCase());
  if (pillars.length) out.push(`Pillars landing best: ${pillars.join(", ")}.`);
  const topics = best(l.topic, (k) => DAILY_TOPICS[k as DailyTopic].name.toLowerCase());
  if (topics.length) out.push(`Angles landing: ${topics.join(", ")}.`);
  const formats = best(l.format, (k) => DAILY_FORMATS[k as DailyFormat].name.toLowerCase());
  if (formats.length) out.push(`Best caption forms: ${formats.join(", ")}.`);
  const styles = best(l.style, (k) => DAILY_STYLES[k as DailyStyle].name.toLowerCase());
  if (styles.length) out.push(`Best shots so far: ${styles.join(", ")}.`);
  const { short, long } = l.length;
  if (short.n >= LEARN_MIN_POSTS && long.n >= LEARN_MIN_POSTS)
    out.push(long.mean > short.mean ? "Longer captions are keeping people longer." : "Shorter captions are doing better.");
  return out.length ? out.join(" ") : "Too close to call yet. Still trying the full mix.";
}

/* ------------------------------------------------------------------ */
/*  The concept: the moment, the picture, three caption drafts          */
/* ------------------------------------------------------------------ */

export type DailyConcept = {
  pillar: DailyPillar;
  /** The angle (stored as `topic`). */
  topic: DailyTopic;
  crowd: DailyCrowd;
  mood: DailyMood;
  situation: string;
  /** What makes it worth reading: the realization, the joke, the twist (kept for the first version's days). */
  tension: string;
  /** The one idea it lands on. */
  message: string;
  format: DailyFormat;
  /** The shot. */
  style: DailyStyle;
  light: DailyLight;
  /** The art direction: A graphic or B anime. */
  art: DailyArt;
  /** The frame: who's in it, what they're doing and feeling, where, what's around them. */
  visual: string;
  /** Words in the scene (a text on a phone, a note, a speech bubble), exactly, or "" for none. */
  typography: string;
  /** The writer's drafts (up to three), before the checks and the editor. */
  drafts: string[];
  /** The chosen, polished caption. */
  caption: string;
};

export const CONCEPT_PROMPT = `You're the social editor of JF Effect, a strength coach's fitness community app: his clients and members, men and women, from first-week beginners to serious lifters. Every morning one post goes in the feed, a picture and a caption made together. It should read like something a real person would post on Instagram or Threads, and it should make the crew glad they opened the app.

THE FEELING
After reading, people should think things like "that's so true", "I never thought of it that way", "I needed that", "this makes me want to train", "I can't believe how far I've come", "this is so me" or "I'm sending this to someone". Get there with real observations, humour, useful ideas, possibility and belonging, never fake positivity, generic motivation or constant reassurance. A post can start with a struggle, but it lands somewhere good: a realization, a laugh, a useful idea or a feeling of possibility. Most posts don't need a struggle at all.

WORK IT OUT IN THIS ORDER
1. The pillar is given. Pick one angle from its list.
2. The moment: one specific, everyday situation people recognize (the warm-up that used to be your top set, a friend texting "you up?" at 5:45, the first time someone asks you for gym advice). Specific beats general.
3. The idea: the realization, the joke, the useful idea or the warm truth it lands on, in your own words.
4. The picture, before any caption: it sets the scene and the feeling. The caption then expands it, adds a twist or says what the picture can't. Never just describe the picture or repeat words that are in it.
5. Three caption drafts for that one picture, each a different shape and length (for example a one-liner, a quick take and a short story), in the form given or close to it.

HOW THE CAPTIONS READ
- Like a real person posting: natural, warm, confident, funny when it fits. Contractions with apostrophes (you're, don't, it's), normal capital letters and punctuation.
- The first sentence is the hook and shows alone in the feed: the reason to keep reading, under 15 words. Never a warm-up ("So,", "Let's talk about", "Here's a reminder").
- As long as the idea needs and no longer. A one-liner can be the whole post. Cut every sentence that doesn't earn its place.
- Short paragraphs of 1 to 3 sentences with a blank line between them. Never one sentence per line like a poem (only the dialogue and list forms put things on their own lines).
- Simple words, varied sentence lengths, easy to read on a phone.
- Talk with them, not at them. No lecturing ("you need to", "stop making excuses", "be honest with yourself"), no speeches, no fake edginess, no forced slang, no drama.
- Never: slogans or stock quotes ("trust the process", "no excuses", "consistency is key", "level up", "your future self"), AI phrases ("here's the thing", "the truth is", "real talk", "let that sink in", "read that again", "it's not about X, it's about Y", "journey", "game changer", "unlock"), hashtags, @tags, names (the coach's or anyone's), em dashes, semicolons, more than one emoji (often none).
- A question only when it's a real invitation (the question form, or one that truly fits). Never tack "who can relate?" or "comment below" onto the end.
- Humour is actually funny: a true, specific detail, a comparison or a twist people laugh at and send to a friend. Earnest isn't humour.
- Bodies: never put a body down or make anyone feel judged for how they look (no stomachs, fat, flaws or "fixing" yourself). Strength, confidence and how life feels, not appearance anxiety.
- Facts: only well-known, safe basics, said plainly; no numbers, studies or claims you can't stand behind. No made-up first-person stories ("I had a client who…") and no real people; a small scene told to "you" or about "someone" is fine.
- Never write or mention a Bible verse (the app adds one on Sundays).
- Don't echo RECENT POSTS: not the angle, the moment, the opening, the shape or the ending. Never lean on stock moments (nobody clapping, the quiet win, the group chat, the couch).

THE PICTURE
- A frame from a premium, colourful, hand-drawn 2D animated film (the look is fixed; you choose the moment, the art direction, the shot and the colour and light). Same story and details as the captions: the same place, time and people.
- Describe the frame: who's in it (adults, their age range, build, hair and clothes, people of different looks, fitting who it's for), what they're doing and feeling, where they are, what's around them.
- Expressive, likeable characters in moments full of life: training, laughing, celebrating, cheering each other on, a milestone, friends, sunshine, a hike, a beach, a park, a kitchen with friends, coffee after the gym, a busy, bright gym. Bright and inviting (daytime, golden hour, vivid light); night only when the story needs it, and then with vivid colour and one bright focal light.
- Never someone miserable alone in a dark room, staring at a phone, undressed, pinching or measuring their body, or on a scale. A struggle shows its turn or its human side (walking in anyway, the friend who showed up, the laugh after).
- Never a poster, a pose or someone looking at the camera, and never a scene like one in RECENT POSTS.
- Any words in the scene (a text on a phone, a note, a speech bubble, a sign) are written word for word in "typography" (at most 12 words): only the words as they appear, never where they are or who's reading them. With no words in the scene, "typography" is "".

Answer with JSON only:
{"topic": "the angle", "mood": "...", "situation": "...", "idea": "...", "format": "...", "art": "graphic or anime", "style": "the shot", "light": "...", "visual": "...", "typography": "...", "captions": ["...", "...", "..."]}`;

/** Ends on a question mark (a closing emoji aside). */
export const endsWithQuestion = (s: string) => /\?\s*(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*\s*)?$/u.test(s.trim());

export function conceptPrompt(o: {
  day: string;
  theme: DailyTheme;
  audience: DailyAudience;
  crowd: DailyCrowd;
  faith: boolean;
  choices: Choices;
  learnings: string;
  best: string[];
  worst: string[];
  recent: Recent[];
  /** Captions the coach threw out: never write like these. */
  rejected?: string[];
  /** The coach's own never-say words (his voice profile). */
  neverSay?: string[];
  /** A remake of one side only: the caption to keep exactly, or the picture already made (its description). */
  keep?: { caption?: string; picture?: string; style?: DailyStyle } | null;
  /** The art direction to use (a test or the coach's pick), else the writer picks. */
  art?: DailyArt | null;
  /** What the editor said about the last drafts. */
  editorNotes?: string[];
}): string {
  const t = DAILY_THEMES[o.theme];
  const p = DAILY_PILLARS[o.choices.pillar];
  const ordered = [...o.recent].sort((a, b) => a.day.localeCompare(b.day)).filter((r) => r.day !== o.day);
  const before = ordered.filter((r) => r.day < o.day).slice(-2);
  const asked = before.length === 2 && before.every((r) => r.caption && endsWithQuestion(r.caption));
  return [
    `TODAY: ${t.idea}.`,
    `PILLAR: ${p.name}. The goal: ${p.goal}. ${p.guide}`,
    `ANGLES, as "topic" (pick one, best first): ${o.choices.topics.map((k) => `${k} = ${DAILY_TOPICS[k].idea}`).join("; ")}`,
    `MOOD, as "mood" (pick one): ${p.moods.join(", ")}`,
    `WHO IT'S FOR: ${DAILY_AUDIENCE_GUIDE[o.audience]} Today especially ${DAILY_CROWDS[o.crowd].guide}.`,
    o.faith ? "SUNDAY: a Bible verse goes under the caption. Make it sit well under a calm verse about rest, hope or strength, without preaching." : null,
    `CAPTION FORMS, as "format" (pick one, best first): ${o.choices.formats.map((k) => `${k} = ${DAILY_FORMATS[k].guide} (up to ${DAILY_FORMATS[k].max} characters)`).join("; ")}`,
    `SHOTS, as "style" (pick the one that tells this story best, best performers first): ${o.choices.styles.map((k) => `${k} = ${DAILY_STYLES[k].look}`).join("; ")}`,
    `COLOUR AND LIGHT, as "light" (pick the one that fits the moment): ${o.choices.lights.map((k) => `${k} = ${DAILY_LIGHTS[k].look}`).join("; ")}`,
    o.art
      ? `ART DIRECTION, as "art": ${o.art} (${ART_STYLES[o.art].name})`
      : `ART DIRECTION, as "art" (pick the one that tells this story best): ${DAILY_ART_KEYS.map((k) => `${k} = ${ART_STYLES[k].name}, for ${ART_STYLES[k].use}`).join("; ")}`,
    o.keep?.caption ? `KEEP THIS CAPTION EXACTLY, word for word, as all three "captions" (only plan a new picture for it): ${o.keep.caption}` : null,
    o.keep?.picture
      ? `KEEP THIS PICTURE (it's already made${o.keep.style ? `, ${DAILY_STYLES[o.keep.style].name.toLowerCase()}` : ""}): ${o.keep.picture}\nPlan the post around it and write the captions for it. Describe it as it is in "visual"; "typography" is "".`
      : null,
    asked ? "The last two posts ended with a question: don't end with one." : null,
    o.neverSay?.length ? `THE COACH NEVER SAYS: ${o.neverSay.join(", ")}` : null,
    `WHAT'S WORKED WITH THIS CREW: ${o.learnings}`,
    o.best.length ? `POSTS THEY LIKED MOST:\n${o.best.map((l) => `- ${l.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")}` : null,
    o.worst.length ? `POSTS THAT FELL FLAT:\n${o.worst.map((l) => `- ${l.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")}` : null,
    o.rejected?.length ? `THE COACH THREW THESE OUT (never write like them):\n${o.rejected.map((l) => `- ${l.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}` : null,
    ordered.length
      ? `RECENT POSTS (make yours different in every way):\n${ordered
          .slice(-14)
          .map((r) => `- ${r.day} · ${pillarOf(r) ?? "?"} · ${r.topic ?? "?"} · ${r.format ?? "?"} · ${r.style ?? "?"}: ${(r.caption ?? "").replace(/\s+/g, " ").slice(0, 160)}`)
          .join("\n")}`
      : null,
    o.editorNotes?.length ? `THE EDITOR TURNED DOWN YOUR LAST DRAFTS: ${o.editorNotes.join("; ")}. Write new ones that fix it.` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const isKey = <K extends string>(keys: readonly K[], v: unknown): v is K => typeof v === "string" && (keys as readonly string[]).includes(v);

/** The art direction a pillar leans to when the writer doesn't pick one. */
export function artForPillar(p: DailyPillar): DailyArt {
  return p === "realization" || p === "community" ? "anime" : "graphic";
}

/** The concept's JSON (fenced or not), with its choices held to the lists it was given. */
export function parseConcept(
  text: string,
  allowed: Omit<Choices, "lights"> & { lights?: DailyLight[]; art?: DailyArt | null; crowd?: DailyCrowd },
): DailyConcept | null {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const unquote = (s: string) => s.replace(/^["“]([\s\S]*)["”]$/, "$1");
    const drafts = (Array.isArray(j.captions) ? j.captions : [j.caption])
      .map((c: unknown) => unquote(str(c, 900)))
      .filter(Boolean)
      .slice(0, 3);
    const pillar = allowed.pillar;
    const c: DailyConcept = {
      pillar,
      topic: isKey(allowed.topics, j.topic) ? j.topic : allowed.topics[0],
      crowd: allowed.crowd ?? "everyone",
      mood: isKey(DAILY_PILLARS[pillar].moods, j.mood) ? j.mood : DAILY_PILLARS[pillar].moods[0],
      situation: str(j.situation, 500),
      tension: str(j.tension, 300),
      message: str(j.idea ?? j.message, 300),
      format: isKey(allowed.formats, j.format) ? j.format : allowed.formats[0],
      style: isKey(allowed.styles, j.style) ? j.style : allowed.styles[0],
      light: isKey(DAILY_LIGHT_KEYS, j.light) ? j.light : (allowed.lights?.[0] ?? "golden_teal"),
      art: allowed.art ?? (isKey(DAILY_ART_KEYS, j.art) ? j.art : artForPillar(pillar)),
      visual: str(j.visual, 1400),
      typography: str(j.typography, 100).replace(/^["“]|["”]$/g, ""),
      drafts,
      caption: drafts[0] ?? "",
    };
    return c.drafts.length && c.visual && c.message ? c : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  The editor: scores the drafts, picks one, polishes it               */
/* ------------------------------------------------------------------ */

export const EDITOR_SCORES = ["human", "hook", "clarity", "match", "tight", "mobile", "relatable", "fresh", "shareable", "feel_good"] as const;
export type EditorScore = (typeof EDITOR_SCORES)[number];
export const EDITOR_FLAGS = ["shaming", "lecturing", "invented", "generic", "negative"] as const;
export type EditorFlag = (typeof EDITOR_FLAGS)[number];

/** Each score the chosen draft has to reach (a challenge post's feel-good bar is lower: motivated and respected is enough). */
export const EDITOR_BARS: Record<EditorScore, number> = { human: 4, hook: 4, clarity: 4, match: 4, tight: 4, mobile: 4, relatable: 4, fresh: 3, shareable: 4, feel_good: 4 };

export const EDITOR_PROMPT = `You're the editor of JF Effect's community feed: a strength coach's app where members, men and women from beginners to serious lifters, come to feel good about training and each other. You get the plan for today's post (one picture) and up to three caption drafts for it. Judge them like a sharp social media editor who wants people to enjoy opening the app every day.

Score each draft 1 to 5 (5 = excellent, 4 = good enough to publish, 3 = needs work, 2 or 1 = poor):
- human: sounds like a real person posting, not an AI, a brand or a motivation account
- hook: the first sentence makes you want to keep reading
- clarity: you get it instantly
- match: it fits the picture and adds to it (a twist, the feeling, what the picture can't say) without repeating its words or just describing it
- tight: nothing you could cut
- mobile: easy to read on a phone (short paragraphs, no wall of text, no poem of one-line sentences)
- relatable: the people it's for would think "that's me"
- fresh: different from the recent posts in angle, moment, opening and shape
- shareable: someone would react, comment or send it to a friend
- feel_good: they leave happier, more confident, entertained, connected or excited to train (a challenge post: motivated and respected, never ashamed)

Flags (true or false):
- shaming: makes anyone feel bad about their body or themselves
- lecturing: talks down, preaches or tells people what they're doing wrong
- invented: a fact, number, study, quote or first-person story it can't stand behind
- generic: could be on any motivation account
- negative: dwells on the bad without landing anywhere good

Then pick the best draft and polish it: the same draft with only the edits that make it better (cut a word or a sentence, smoother wording, fix punctuation or a paragraph break). Never add a question, an emoji, a hashtag or a name, and never change the idea. If it's already right, return it unchanged.

Answer with JSON only:
{"drafts": [{"scores": {"human": 1-5, "hook": 1-5, "clarity": 1-5, "match": 1-5, "tight": 1-5, "mobile": 1-5, "relatable": 1-5, "fresh": 1-5, "shareable": 1-5, "feel_good": 1-5}, "flags": {"shaming": false, "lecturing": false, "invented": false, "generic": false, "negative": false}, "note": "one line"}], "best": 0, "polished": "...", "why": "one line"}`;

export function editorPrompt(o: {
  concept: Pick<DailyConcept, "pillar" | "topic" | "crowd" | "mood" | "situation" | "message" | "visual" | "typography" | "format">;
  audience: DailyAudience;
  drafts: string[];
  recent: string[];
}): string {
  const p = DAILY_PILLARS[o.concept.pillar];
  return [
    `PILLAR: ${p.name}. The goal: ${p.goal}`,
    `ANGLE: ${DAILY_TOPICS[o.concept.topic]?.idea ?? o.concept.topic}`,
    `FOR: ${DAILY_AUDIENCE_GUIDE[o.audience]} Especially ${DAILY_CROWDS[o.concept.crowd]?.guide ?? "anyone who trains"}.`,
    `MOOD: ${o.concept.mood}`,
    `THE MOMENT: ${o.concept.situation}`,
    `THE IDEA: ${o.concept.message}`,
    `THE PICTURE: ${o.concept.visual}`,
    o.concept.typography ? `WORDS IN THE PICTURE: ${o.concept.typography}` : "THE PICTURE HAS NO WORDS IN IT.",
    `THE FORM: ${DAILY_FORMATS[o.concept.format]?.guide ?? o.concept.format}`,
    o.recent.length ? `RECENT POSTS:\n${o.recent.slice(-10).map((r) => `- ${r.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}` : null,
    `THE DRAFTS:\n${o.drafts.map((d, i) => `[${i}]\n${d}`).join("\n\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type EditorDraft = { scores: Record<EditorScore, number>; flags: Record<EditorFlag, boolean>; note: string };
export type EditorReview = { drafts: EditorDraft[]; best: number; polished: string; why: string };

export function parseEditor(text: string, count: number): EditorReview | null {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const n = (v: unknown) => Math.max(1, Math.min(5, Math.round(Number(v) || 1)));
    const drafts: EditorDraft[] = (Array.isArray(j.drafts) ? j.drafts : []).slice(0, count).map((d: any) => ({
      scores: Object.fromEntries(EDITOR_SCORES.map((k) => [k, n(d?.scores?.[k])])) as Record<EditorScore, number>,
      flags: Object.fromEntries(EDITOR_FLAGS.map((k) => [k, d?.flags?.[k] === true])) as Record<EditorFlag, boolean>,
      note: typeof d?.note === "string" ? d.note.trim().slice(0, 300) : "",
    }));
    if (!drafts.length) return null;
    const best = Number.isInteger(j.best) && j.best >= 0 && j.best < drafts.length ? j.best : 0;
    return { drafts, best, polished: typeof j.polished === "string" ? j.polished.trim().slice(0, 900) : "", why: typeof j.why === "string" ? j.why.trim().slice(0, 300) : "" };
  } catch {
    return null;
  }
}

/** A draft's average editor score (1 to 5). */
export const editorScore = (d: Pick<EditorDraft, "scores">) => Math.round((EDITOR_SCORES.reduce((t, k) => t + d.scores[k], 0) / EDITOR_SCORES.length) * 10) / 10;

/** Does the editor's chosen draft clear every bar with no flag? What's short, if not. */
export function editorVerdict(e: EditorReview, pillar: DailyPillar): { pass: boolean; issues: string[] } {
  const d = e.drafts[e.best];
  const issues: string[] = [];
  for (const k of EDITOR_SCORES) {
    const bar = k === "feel_good" && pillar === "challenge" ? 3 : EDITOR_BARS[k];
    if (d.scores[k] < bar) issues.push(`${k.replace("_", " ")} ${d.scores[k]}/5`);
  }
  for (const f of EDITOR_FLAGS) if (d.flags[f]) issues.push(f);
  if (issues.length && d.note) issues.push(d.note);
  return { pass: !issues.length, issues };
}

/* ------------------------------------------------------------------ */
/*  Checks                                                             */
/* ------------------------------------------------------------------ */

const CONTRACTIONS: Record<string, string> = {
  dont: "don't", cant: "can't", wont: "won't", isnt: "isn't", arent: "aren't", doesnt: "doesn't", didnt: "didn't", wasnt: "wasn't",
  werent: "weren't", hasnt: "hasn't", havent: "haven't", couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't",
  youre: "you're", youve: "you've", youll: "you'll", youd: "you'd", theyre: "they're", theyve: "they've", thats: "that's",
  whats: "what's", theres: "there's", heres: "here's", im: "I'm", ive: "I've", ill: "I'll", itll: "it'll", lets: "let's",
};
/** "lets" is also a word ("it lets you"), so it's only fixed where it starts a sentence. */
const AMBIGUOUS = new Set(["lets", "ill", "wont", "cant"]);

/**
 * A caption as it should read in the feed: real apostrophes and capitals
 * (the old texting style's "dont" and "im" fixed), no em dashes or "&",
 * no stray spaces, at most one blank line between paragraphs, and never
 * wrapped in quotes.
 */
export function tidyCaption(text: string): string {
  let t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  t = t.replace(/^["“]([\s\S]*)["”]$/, "$1").trim();
  t = t.replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2");
  t = t.replace(/\s*[—–]\s*/g, ", ");
  t = t.replace(/\s+&\s+/g, " and ");
  t = t.replace(/[’]/g, "'");
  t = t.replace(/\b([A-Za-z]+)\b/g, (w, _x, i: number) => {
    const fix = CONTRACTIONS[w.toLowerCase()];
    if (!fix) return w;
    const before = t.slice(0, i);
    if (AMBIGUOUS.has(w.toLowerCase()) && !/(^|[.!?\n]\s*)$/.test(before)) return w;
    return w[0] === w[0].toUpperCase() && fix[0] !== "I" ? fix[0].toUpperCase() + fix.slice(1) : fix;
  });
  t = t.replace(/\bi\b(?=[\s,.!?']|$)/g, "I");
  // a capital at the start of the caption, each line and each sentence
  t = t.replace(/(^|\n|[.!?]\s+)([a-z])/g, (_m, lead, ch) => `${lead}${ch.toUpperCase()}`);
  t = t.replace(/ +([,.!?])/g, "$1");
  t = t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** Slogans that make a post read like an auto-filled motivation account. */
export const GENERIC_PHRASES = [
  "trust the process",
  "you got this",
  "keep going",
  "keep pushing",
  "never give up",
  "no excuses",
  "consistency is key",
  "level up",
  "best version of yourself",
  "your future self",
  "one day or day one",
  "rise and grind",
  "beast mode",
  "believe in yourself",
  "dream big",
  "the grind",
  "hustle",
  "stay focused",
  "push through",
  "every day is a new",
  "you are stronger than you think",
  "finish strong",
  "no days off",
  "pain is weakness",
  "comfort zone is",
  "discipline is",
  "motivation is",
  "crush it",
  "crushing it",
  // the first weeks' own clichés: never, not just not twice
  "nobody claps",
  "no one claps",
  "no claps",
  "quiet rep",
  "quiet win",
  "quiet choice",
] as const;

/** Phrases that give away a writer, not a person. */
export const AI_TELLS = [
  "here's the thing",
  "here's the truth",
  "the truth is",
  "real talk",
  "let that sink in",
  "read that again",
  "be real:",
  "let's be honest",
  "let's talk about",
  "reminder:",
  "friendly reminder",
  "remember this",
  "game changer",
  "game-changer",
  "unlock your",
  "embrace the",
  "fuel your",
  "it's not about",
  "isn't about",
  "journey",
  "who can relate",
  "comment below",
  "drop a comment",
  "tag someone",
  "tag a friend",
] as const;

/** Talking at the reader, not with them. */
const LECTURING = [
  /\byou (need|have|got) to\b/i,
  /\bstop (making|being|saying|pretending|waiting)\b/i,
  /\bthe lie\b/i,
  /\bbe honest with yourself\b/i,
  /\bno one cares\b/i,
  /\bnobody cares\b/i,
  /\byou're (just )?(lazy|scared|weak)\b/i,
];

/** Putting a body down (any of these, anywhere, fails: the crew should never feel judged for how they look). */
const BODY_PUTDOWN = [
  /\b(stomach|love handles|muffin top|cellulite|flab|flabby|jiggly|chubby|fatty|overweight|double chin|thunder thighs|man boobs|moobs)\b/i,
  // "fat" about a body, never "fat loss", "low-fat" or "healthy fats" (no lookbehind: it has to parse on older phones)
  /(^|[^\w-])fat\b(?![\s-]*(loss|burning|free))/i,
  /\b(ugly|hideous)\b/i,
  /\bhate (your|my|their) (body|reflection|arms|legs|face|thighs)\b/i,
  /\bskipp(ing|ed) (dinner|meals|lunch|breakfast)\b/i,
];

const NEGATIVE = /\b(hate|hated|worst|failure|failing|failed|lazy|quit|quitting|guilt|guilty|shame|ashamed|pathetic|weak|trash|miserable|exhausted|drained|dread|dreading|cringe|embarrass\w*|insecur\w*|excuses?|broken|stress(ed|ful)?|anxious|anxiety|overwhelm\w*|scared|afraid|alone|lonely|sad|depress\w*)\b/gi;
const POSITIVE = /\b(proud|love|loved|enjoy\w*|fun|funny|laugh\w*|excit\w*|grateful|strong|stronger|easier|better|glad|happy|friend\w*|celebrat\w*|progress|win|wins|won|smil\w*|confiden\w*|look forward|favourite|favorite|best|cheer\w*|hype\w*|good)\b/gi;

/** How the caption leans: negative words against positive ones (a challenge can lean a little more before it counts). */
export function negativeLean(caption: string): { negative: number; positive: number } {
  return { negative: (caption.match(NEGATIVE) ?? []).length, positive: (caption.match(POSITIVE) ?? []).length };
}

const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
/** Words half of all captions start with ("you", "the"): two of them together are the opening that can repeat. */
const COMMON_OPENERS = new Set(["you", "your", "youre", "i", "im", "the", "a", "an", "its", "it", "this", "that", "thats", "when", "if", "we", "my", "and", "but", "so", "some", "nobody", "no", "every", "theres", "there", "to"]);
/** The opening that would read as a template if it came back: the first word, or the first two when the first is a common one. */
const opener = (s: string) => {
  const w = s.trim().toLowerCase().replace(/[’']/g, "").match(/[a-z]+/g) ?? [];
  return w[0] && COMMON_OPENERS.has(w[0]) ? w.slice(0, 2).join(" ") : (w[0] ?? "");
};
const lastEmoji = (s: string) => s.match(EMOJI_RE)?.pop() ?? "";

/** A post that opens the same way, or ends on the same emoji, as a day near it reads like a template. */
export function repeatsNearby(line: string, near: string[]): string | null {
  const w = opener(line);
  if (w && near.some((n) => opener(n) === w)) return `opens with "${w}" like a day near it`;
  const e = lastEmoji(line);
  if (e && near.some((n) => lastEmoji(n) === e)) return `ends on ${e} like a day near it`;
  return null;
}

const trigrams = (s: string) => {
  const w = s.toLowerCase().replace(/[’']/g, "").replace(EMOJI_RE, " ").match(/[a-z]+/g) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
};
/** How much two captions share (word three-grams, 0 to 1). */
export function captionSimilarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return both / Math.min(x.size, y.size);
}
/** "Psalm 46:10", "1 peter 5:7": a verse named in a caption (a time like "5:30" isn't one). */
const BIBLE_REF =
  /\b(?:[1-3]\s?)?(?:genesis|exodus|deuteronomy|joshua|psalms?|proverbs|ecclesiastes|isaiah|jeremiah|lamentations|micah|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|hebrews|james|peter|revelation)\s+\d{1,3}:\d{1,3}\b/i;

/**
 * Stock moments the writer falls back on (the first week used "nobody claps"
 * and the quiet win four times): one used in a recent post can't come back.
 */
export const STOCK_MOTIFS = [
  "no one claps",
  "nobody claps",
  "no one cheered",
  "nobody cheered",
  "no one notices",
  "nobody notices",
  "no one sees",
  "nobody sees",
  "quiet win",
  "quiet choice",
  "quiet rep",
  "quiet truth",
  "group chat",
  "doomscroll",
  "the sink",
  "the couch",
  "friday night",
  "its friday",
  "no selfie",
  "no post",
] as const;

/** Stock moments in a caption that a recent post already used. */
export function motifRepeats(caption: string, recent: string[]): string[] {
  const norm = (t: string) => ` ${t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ")} `;
  const mine = norm(caption);
  const theirs = recent.map(norm);
  return STOCK_MOTIFS.filter((m) => mine.includes(` ${m} `) && theirs.some((t) => t.includes(` ${m} `)));
}

/** Past this share of three-word runs, a caption is a rerun. */
export const SIMILAR_MAX = 0.3;
/** The hook (the first sentence) shows alone in the feed's preview: past these it's cut mid-thought on a phone. */
export const HOOK_MAX_WORDS = 18;
export const HOOK_MAX_CHARS = 110;
/** Plain enough to read in one pass on a phone (natural writing, not a 5th-grade drill). */
export const DAILY_GRADE_MAX = 7;
export const DAILY_SENTENCE_MAX = 24;
/** Names that must never be dropped into a caption (the coach's own, and placeholders). */
export const NO_NAMES = /\b(jared|jf effect|coach jared)\b|\[name\]|\{name\}|<name>/i;

const letters = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The first sentence (or line), the hook. */
export function hookOf(caption: string): string {
  const first = caption.trim().split("\n")[0] ?? "";
  const m = /^.*?[.!?…](?=\s|$)/.exec(first);
  return (m ? m[0] : first).trim();
}

/**
 * What's wrong with a caption (empty = it can go out). `recent` = earlier
 * posts' captions, `near` = the days around it, `asked` = the last two
 * posts ended with a question, `picture` = the words in the picture.
 */
export function captionProblems(
  caption: string,
  o: { format: DailyFormat; pillar?: DailyPillar; recent?: string[]; near?: string[]; asked?: boolean; picture?: string },
): string[] {
  const out: string[] = [];
  const f = DAILY_FORMATS[o.format] ?? DAILY_FORMATS.quick_take;
  const text = caption.trim();
  if (!text) return ["empty"];
  if (text.length > f.max) out.push(`${text.length} characters (a ${f.name.toLowerCase()} is ${f.max} at most)`);
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 4) out.push(`${paragraphs.length} paragraphs (4 at most)`);
  if (!f.lines && paragraphs.some((p) => p.split("\n").length > 1)) out.push("line breaks inside a paragraph (write sentences, not a poem of one-line lines)");
  if (f.lines && text.split("\n").filter((l) => l.trim()).length > 7) out.push("more than 7 lines");
  const hook = hookOf(text);
  if (wordsOf(hook).length > HOOK_MAX_WORDS || hook.length > HOOK_MAX_CHARS) out.push(`the first sentence runs long (${wordsOf(hook).length} words): it's the hook, keep it short`);
  if ((text.match(EMOJI_RE) ?? []).length > 1) out.push("more than one emoji");
  if (/#\w/.test(text)) out.push("has a hashtag");
  if (/@\w/.test(text)) out.push("tags someone");
  if (NO_NAMES.test(text)) out.push("drops in a name");
  if (BIBLE_REF.test(text) || /\b(verse|scripture)\b/i.test(text)) out.push("mentions a verse (the app adds it)");
  const lower = ` ${text.toLowerCase().replace(/[’]/g, "'")} `;
  for (const g of GENERIC_PHRASES) if (lower.includes(g)) out.push(`says "${g}" (a slogan)`);
  for (const g of AI_TELLS) if (lower.includes(g)) out.push(`says "${g}" (reads like AI)`);
  if (LECTURING.some((re) => re.test(text))) out.push("lectures the reader");
  if (BODY_PUTDOWN.some((re) => re.test(text))) out.push("puts a body down");
  const lean = negativeLean(text);
  if (lean.negative >= (o.pillar === "challenge" ? 4 : 3) && lean.negative > lean.positive) out.push(`leans negative (${lean.negative} heavy words, ${lean.positive} light ones)`);
  if (o.asked && endsWithQuestion(text)) out.push("ends on a question again (the last two did)");
  const pic = letters(o.picture ?? "");
  if (pic.split(" ").length >= 4 && o.format !== "dialogue" && letters(text).includes(pic)) out.push("repeats the words in the picture");
  if (wordsOf(text).length >= 25 && readingGrade(text) > DAILY_GRADE_MAX) out.push(`hard to read (grade ${readingGrade(text)}, aim ${DAILY_GRADE_MAX} or under)`);
  if (longestSentence(text) > DAILY_SENTENCE_MAX) out.push(`a ${longestSentence(text)}-word sentence (${DAILY_SENTENCE_MAX} at most)`);
  for (const j of Object.keys(JARGON)) if (new RegExp(`[^\\p{L}]${j}s?[^\\p{L}]`, "iu").test(lower)) out.push(`"${j}" (say "${JARGON[j]}")`);
  const repeat = repeatsNearby(text, o.near ?? []);
  if (repeat) out.push(repeat);
  const close = (o.recent ?? []).find((r) => captionSimilarity(text, r) >= SIMILAR_MAX);
  if (close) out.push(`too close to a recent post ("${close.slice(0, 50)}…")`);
  for (const m of motifRepeats(text, o.recent ?? [])) out.push(`uses "${m}" like a recent post (find a new moment)`);
  for (const p of voiceProblems(text)) if (!out.includes(p)) out.push(p);
  return [...new Set(out)];
}

/** Words set in the picture: a few, plain letters, nothing an image model will mangle. */
export function typographyProblems(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const out: string[] = [];
  if (t.split(/\s+/).length > 12) out.push("more than 12 words in the picture");
  if (t.length > 72) out.push("too many letters in the picture");
  if (/[^A-Za-z0-9 ,.!?'’&:\n-]/.test(t)) out.push("characters in the picture an image model gets wrong");
  return out;
}

/* ------------------------------------------------------------------ */
/*  The picture                                                        */
/* ------------------------------------------------------------------ */

/** Put first when the image model gets a style reference with the prompt. */
export const STYLE_REFERENCE =
  "The attached image is the style reference. Match its art style exactly: its colour, saturation and lighting, its linework and cel shading, how its people are drawn and how detailed its background is. Draw a completely new scene from the description below; never copy the reference's people, place, objects or composition.";

/** How each mood should feel in the frame. */
const MOOD_LOOK: Record<DailyMood, string> = {
  uplifting: "uplifting and hopeful, a sense of possibility",
  proud: "quietly proud and glowing, a small personal victory",
  funny: "funny and lively, the comedy readable in the faces and the moment",
  warm: "warm and friendly, real connection between people",
  curious: "bright and engaging, a little 'aha' in the moment",
  fired_up: "energetic and determined, full of momentum",
  thoughtful: "calm and reflective, still bright and hopeful",
};

/** The image model's prompt: the look and art direction, the shot, the colour and light, the moment and its mood, the words in it (exactly) or none, and what it must never look like. */
export function picturePrompt(
  c: Pick<DailyConcept, "style" | "visual" | "typography" | "message"> & { light?: DailyLight | string | null; art?: DailyArt | string | null; mood?: DailyMood | string | null },
  o: { faith?: boolean; fix?: string | null; reference?: boolean } = {},
): string {
  const shot = DAILY_STYLES[c.style as DailyStyle] ?? DAILY_STYLES.medium_candid;
  const light = c.light && c.light in DAILY_LIGHTS ? DAILY_LIGHTS[c.light as DailyLight] : null;
  const art = ART_STYLES[(c.art && c.art in ART_STYLES ? c.art : "graphic") as DailyArt];
  const mood = c.mood && c.mood in MOOD_LOOK ? MOOD_LOOK[c.mood as DailyMood] : null;
  const words = c.typography.trim();
  return [
    o.reference ? STYLE_REFERENCE : null,
    FILM_LOOK,
    art.look,
    `The shot: ${shot.look}`,
    light ? `Colour and light: ${light.look}.` : null,
    `What happens in the frame: ${c.visual}`,
    `The feeling: ${c.message}${mood ? ` (${mood})` : ""}`,
    "People are expressive, likeable, naturally proportioned adults with clean, sharp faces and clear, natural expressions, caught mid-moment, never posing or looking at the camera. The scene feels alive and inviting.",
    o.faith ? "Quiet and hopeful, still bright and colourful; any Bible stays closed with no readable writing on it." : null,
    words
      ? `The only words in the frame are exactly these, where the story puts them (a speech bubble, a note, a screen), spelled exactly and clearly readable: ${words}. No other letters, numbers or logos anywhere.`
      : "No words, letters, numbers, signs, logos or watermarks anywhere in the frame; any screen shows no readable text.",
    "Vertical portrait. Keep the subject and any words well inside the middle 80% of the height and away from every edge (the feed crops the top and bottom).",
    FILM_AVOID,
    o.fix ? `Fix from the last try: ${o.fix}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/* ------------------------------------------------------------------ */
/*  The review                                                         */
/* ------------------------------------------------------------------ */

export const REVIEW_PROMPT = `You review one daily post for a strength coach's community feed before it goes out: a picture and its caption, made together for one idea. The feed should make members glad they opened the app. Be an honest editor at a good magazine. Look closely at the picture.

Answer with JSON only:
{
 "medium": "what the picture actually is: hand_drawn_2d (a hand-drawn, painted 2D animated-film frame), 3d_render (CGI, Pixar-like, plastic skin, volumetric 3D models), photo (a photograph or photorealistic), vector (flat clip art or a cheap vector illustration) or other",
 "description": "two sentences: what the picture shows and how it's drawn",
 "colour": "vibrant (rich, saturated, luminous colour with strong warm-versus-cool contrast), muted (desaturated, brown or grey grading, flat) or dark (dark, gloomy or low-contrast)",
 "clarity": "crisp (clean linework, sharp, well-drawn faces) or soft (blurry, smudged, grainy or painterly faces and lines)",
 "text_seen": "every word you can clearly read in the image, exactly as written, or empty",
 "defects": ["only clear mistakes anyone would notice at a glance, each one named"],
 "scores": {"relatable": 1-5, "original": 1-5, "writing": 1-5, "audience_fit": 1-5, "aesthetic": 1-5, "storytelling": 1-5, "match": 1-5, "engaging": 1-5, "uplift": 1-5},
 "fix_image": "what would make the picture better, or empty",
 "fix_caption": "what would make the caption better, or empty"
}

DEFECTS are objective errors only: wrong or extra fingers or limbs, warped faces or bodies, melted or impossible objects, garbled, misspelled or extra text, a watermark or logo, obvious rendering artefacts, the subject or the words cut off at an edge. Taste is never a defect (a slightly stock look, the framing, the lighting, empty space, what could be clearer): score it and put it in fix_image or fix_caption.

SCORES: 5 = excellent, 4 = good enough to publish, 3 = needs work, 2 or 1 = poor. relatable = would someone think "that's me"; original = not a cliché or slogan; writing = reads like a real person posting (natural, warm, clean punctuation, no lecturing; a caption meant as humour that isn't actually funny is 3 or less); audience_fit = right for who it's for; aesthetic = bright, colourful and beautiful like a frame from a great hand-drawn 2D animated film, as striking as any style reference you were shown (not 3D, not a photo, not cheap vector, not childish, not dark or muddy); storytelling = the picture tells a story; match = the picture and caption tell the same story with the same details and add to each other, the caption not just repeating the words in the picture (any contradiction, like a text in the picture while the caption says they heard it, or another place, time or person, is 3 or less); engaging = worth a like, comment or send; uplift = the picture and caption together leave people feeling good (happier, more confident, entertained, connected or excited to train), never gloomy, shaming or heavy without a turn.`;

export type Review = {
  /** What it actually is: only hand_drawn_2d passes. */
  medium: string;
  /** Only vibrant passes. */
  colour: string;
  /** Only crisp passes. */
  clarity: string;
  description: string;
  text_seen: string;
  defects: string[];
  scores: Record<"relatable" | "original" | "writing" | "audience_fit" | "aesthetic" | "storytelling" | "match" | "engaging" | "uplift", number>;
  fix_image: string;
  fix_caption: string;
};

export function reviewPrompt(o: {
  caption: string;
  concept: Pick<DailyConcept, "message" | "situation" | "visual" | "typography" | "style"> & {
    art?: DailyArt | string | null;
    format?: DailyFormat | string | null;
    pillar?: DailyPillar | string | null;
    mood?: DailyMood | string | null;
  };
  audience: DailyAudience;
  /** How many style references come before the picture. */
  references?: number;
}): string {
  const art = o.concept.art && o.concept.art in ART_STYLES ? ART_STYLES[o.concept.art as DailyArt] : null;
  const pillar = o.concept.pillar && o.concept.pillar in DAILY_PILLARS ? DAILY_PILLARS[o.concept.pillar as DailyPillar] : null;
  return [
    o.references
      ? `THE FIRST ${o.references === 1 ? "IMAGE IS THE STYLE REFERENCE" : `${o.references} IMAGES ARE THE STYLE REFERENCES`} THE COACH CHOSE. THE LAST IMAGE IS THE ONE TO REVIEW: judge its colour, light, linework and how its people are drawn against the reference.`
      : null,
    `AUDIENCE: ${DAILY_AUDIENCE_GUIDE[o.audience]}`,
    pillar ? `THE KIND OF POST: ${pillar.name} (${pillar.goal})${o.concept.mood ? `, mood ${o.concept.mood}` : ""}` : null,
    `THE IDEA: ${o.concept.message}`,
    o.concept.format && o.concept.format in DAILY_FORMATS ? `THE CAPTION'S FORM: ${DAILY_FORMATS[o.concept.format as DailyFormat].name} (${DAILY_FORMATS[o.concept.format as DailyFormat].guide})` : null,
    `THE SITUATION: ${o.concept.situation}`,
    `THE PICTURE WAS MEANT TO BE: a frame from a premium, colourful, hand-drawn 2D animated film, bright and crisp (never 3D, a photo, vector clip art, dark or muddy)${art ? `, ${art.name}` : ""}. ${DAILY_STYLES[o.concept.style as DailyStyle]?.look ?? ""} ${o.concept.visual}`,
    o.concept.typography ? `WORDS MEANT TO BE IN THE PICTURE: ${o.concept.typography}` : "THE PICTURE WAS MEANT TO HAVE NO WORDS IN IT.",
    `THE CAPTION:\n${o.caption}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseReview(text: string): Review | null {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const s = j.scores ?? {};
    const n = (v: unknown) => Math.max(1, Math.min(5, Math.round(Number(v) || 1)));
    const word = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") : "");
    const medium = word(j.medium);
    const colour = word(j.colour ?? j.color).split("_")[0];
    const clarity = word(j.clarity).split("_")[0];
    return {
      medium: /^hand_?drawn(_2d)?$|^2d$/.test(medium) ? "hand_drawn_2d" : medium,
      colour,
      clarity,
      description: typeof j.description === "string" ? j.description.trim().slice(0, 600) : "",
      text_seen: typeof j.text_seen === "string" ? j.text_seen.trim() : "",
      defects: Array.isArray(j.defects) ? j.defects.filter((d: unknown) => typeof d === "string" && d.trim()).map((d: string) => d.trim()) : [],
      scores: {
        relatable: n(s.relatable),
        original: n(s.original),
        writing: n(s.writing),
        audience_fit: n(s.audience_fit),
        aesthetic: n(s.aesthetic),
        storytelling: n(s.storytelling),
        match: n(s.match),
        engaging: n(s.engaging),
        // a review from before the uplift score counts as neutral, not a fail
        uplift: s.uplift == null ? 4 : n(s.uplift),
      },
      fix_image: typeof j.fix_image === "string" ? j.fix_image.trim() : "",
      fix_caption: typeof j.fix_caption === "string" ? j.fix_caption.trim() : "",
    };
  } catch {
    return null;
  }
}

/** Each score a post has to reach (the caption already passed the editor, so its bars here only catch a picture that changed its meaning). */
export const REVIEW_BARS: Review["scores"] = { relatable: 3, original: 3, writing: 4, audience_fit: 3, aesthetic: 4, storytelling: 3, match: 4, engaging: 3, uplift: 4 };
const IMAGE_SCORES = new Set<keyof Review["scores"]>(["aesthetic", "storytelling", "match", "uplift"]);

/**
 * Pass or fail, on concrete checks first: the words read off the picture are
 * exactly what was asked for (or none), no defects; then every score at its
 * bar (a challenge post's uplift bar is 3). Says which side failed, so only
 * that side is made again.
 */
export function reviewVerdict(r: Review, typography: string, scene = "", pillar?: DailyPillar | string | null): { pass: boolean; image: string[]; caption: string[] } {
  const image: string[] = [];
  const caption: string[] = [];
  const want = letters(typography);
  const seen = letters(r.text_seen);
  // words the planned scene itself names (an alarm's "5:30 AM", a note that says "tomorrow") aren't stray text
  const planned = new Set([...letters(typography).split(" "), ...letters(scene).split(" ")].filter(Boolean));
  // a phone's clock or a date ("11:23", "6 am") can't be misspelled and tells no other story
  const stray = seen
    .replace(want, " ")
    .split(" ")
    .filter((w) => w && !planned.has(w) && !/^(\d+|am|pm)$/.test(w));
  if (want && !seen.includes(want)) image.push(`the words in the picture read "${r.text_seen || "nothing"}", not "${typography}"`);
  else if (stray.length) image.push(`${want ? "extra words" : "words that shouldn't be there"} in the picture: "${r.text_seen}"`);
  // the look is fixed: a frame that reads as 3D, a photo or vector clip art fails whatever its scores
  if (r.medium !== "hand_drawn_2d") image.push(`it reads as ${(r.medium || "something else").replace(/_/g, " ")}, not a hand-drawn 2D film frame`);
  // bright and crisp, never the muddy, dark or soft look of the first tries
  if (r.colour !== "vibrant") image.push(`its colour reads as ${r.colour || "unclear"}, not vibrant`);
  if (r.clarity !== "crisp") image.push(`its faces and lines read as ${r.clarity || "unclear"}, not crisp`);
  for (const d of r.defects) image.push(d);
  for (const k of Object.keys(REVIEW_BARS) as (keyof Review["scores"])[]) {
    const bar = k === "uplift" && pillar === "challenge" ? 3 : REVIEW_BARS[k];
    if (r.scores[k] >= bar) continue;
    (IMAGE_SCORES.has(k) ? image : caption).push(`${k} ${r.scores[k]}/5`);
  }
  if (image.length && r.fix_image) image.push(`fix: ${r.fix_image}`);
  if (caption.length && r.fix_caption) caption.push(`fix: ${r.fix_caption}`);
  return { pass: !image.length && !caption.length, image, caption };
}

/* ------------------------------------------------------------------ */
/*  A caption rewrite against the same picture                         */
/* ------------------------------------------------------------------ */

export const CAPTION_FIX_PROMPT = `You rewrite the caption of one daily post for a strength coach's community feed. The picture is already made and stays. Keep the post's idea and form; fix only what the editor said. The same rules: it reads like a real person posting (natural, warm, contractions with apostrophes, normal capitals and punctuation), the first sentence is a short hook, short paragraphs with a blank line between them, no lecturing, no slogans or AI phrases, no hashtags, no names, at most one emoji, never a Bible verse, never putting a body down. Answer with JSON only: {"caption": "..."}`;

export function captionFixPrompt(o: { concept: Pick<DailyConcept, "message" | "situation" | "visual" | "format">; caption: string; fix: string[] }): string {
  const f = DAILY_FORMATS[o.concept.format] ?? DAILY_FORMATS.quick_take;
  return [
    `THE IDEA: ${o.concept.message}`,
    `THE SITUATION: ${o.concept.situation}`,
    `THE PICTURE: ${o.concept.visual}`,
    `THE FORM: ${f.guide} (up to ${f.max} characters)`,
    `THE CAPTION NOW:\n${o.caption}`,
    `WHAT TO FIX: ${o.fix.join("; ")}`,
  ].join("\n\n");
}

export function parseCaption(text: string): string | null {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) return null;
  try {
    const c = JSON.parse(m[0])?.caption;
    return typeof c === "string" && c.trim() ? c.trim().replace(/^["“]|["”]$/g, "").slice(0, 900) : null;
  } catch {
    return null;
  }
}

/** The review's average score (1 to 5), for the coach's card and the learning. */
export function reviewScore(r: Pick<Review, "scores">): number {
  const s = Object.values(r.scores);
  return Math.round((s.reduce((t, n) => t + n, 0) / s.length) * 10) / 10;
}
