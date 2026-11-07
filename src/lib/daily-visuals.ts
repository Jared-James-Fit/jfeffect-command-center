/**
 * Daily posts (series `daily_visual`): on the days no other coach post goes
 * out, one post that's worth opening the app for. A picture and a caption made
 * together, written as Jared, a powerlifting coach explaining something
 * between sets: direct, confident, analytical, occasionally dry, always about
 * getting stronger. Never a fitness motivation page.
 *
 * What a day is about (`pickPillars`): seven content categories with a target
 * mix (DAILY_PILLARS: Powerlifting IQ 20%, Coach's notes 20%, Training
 * mistakes 15%, Athlete mindset 15%, Recovery and performance 10%,
 * Hypertrophy for strength 10%, Competition prep 10%), kept by how far each
 * is behind its share over the last few weeks, nudged by how the crew
 * actually responds (`pillarShares`), never the same category two days
 * running. Each category has its angles (DAILY_TOPICS, stored as `topic`).
 * Who it's for turns over too: women, men, everyone (`audienceForDay`) and,
 * independently, newer lifters, strength for life, powerlifters, everyone
 * (`crowdForDay`). The weekday only sets a mood (DAILY_THEMES), and Sunday's
 * carries a Bible verse (only ever one of FAITH_VERSES, word for word).
 *
 * How one is made (daily-visuals.server.ts):
 *   1. the writer plans the point and the picture first, then drafts three
 *      captions for it (CONCEPT_PROMPT: hook, insight, application, takeaway,
 *      used flexibly, about 40 to 100 words); `tidyCaption` and
 *      `captionProblems` throw out any that break the hard rules (length, a
 *      slogan or one of his banned lines, AI phrases, research or statistics,
 *      a story he didn't live, a body put down, the picture's words repeated,
 *      too close to a recent post);
 *   2. an editor scores the drafts (EDITOR_PROMPT: natural, substance,
 *      accuracy, clarity, match, fresh, worth it, with flags for scripted,
 *      hype, AI phrasing, preachy, invented, shaming and generic), picks the
 *      best and polishes it; `editorVerdict` passes it only at every bar with
 *      no flag, else the writer tries again with the editor's notes;
 *   3. the picture: a bright, colourful frame from a premium hand-drawn 2D
 *      animated film (FILM_LOOK) of strength training (the lifts, coaching,
 *      the log, the platform, recovery around training), then a review that
 *      looks at the picture with the caption (REVIEW_PROMPT / `reviewVerdict`,
 *      `on_topic` included).
 * It learns from every posted day (likes, comments (more for real ones),
 * saves, shares and reposts, and whether people stopped on it), by category,
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

export type DailyPillar = "powerlifting_iq" | "coaches_notes" | "mistakes" | "mindset" | "recovery" | "hypertrophy" | "comp_prep";
export type DailyCrowd = "everyone" | "beginners" | "lifestyle" | "lifters";
export type DailyMood = "direct" | "analytical" | "dry_humour" | "matter_of_fact" | "focused" | "calm" | "curious";
export type DailyFormat = "coach_note" | "breakdown" | "mistake" | "take" | "question";

/**
 * The seven content categories (stored as concept.pillar) and the mix they
 * start at: a guide the learning nudges, never quotas. Every one is about
 * getting stronger: the lifts, the log, the work around them and the head
 * that does it.
 */
export const DAILY_PILLARS: Record<DailyPillar, { name: string; share: number; goal: string; guide: string; moods: DailyMood[]; formats: DailyFormat[] }> = {
  powerlifting_iq: {
    name: "Powerlifting IQ",
    share: 0.2,
    goal: "one idea that makes a lifter understand the squat, bench or deadlift, or their own training, better than they did",
    guide: "Explain the mechanism plainly: what happens, why it happens, and how to check it in your own lifting. Principles strength coaches agree on, said precisely, never a study or a number presented as research.",
    moods: ["analytical", "curious", "direct"],
    formats: ["breakdown", "coach_note", "question"],
  },
  coaches_notes: {
    name: "Coach's notes",
    share: 0.2,
    goal: "what an experienced coach pays attention to and why: how he reads a set, a log or a block, and what he'd change",
    guide: "A note between sets: what to look at, what it tells you, the one adjustment. Coaching principles and his opinion, never a story or a client.",
    moods: ["direct", "matter_of_fact", "dry_humour"],
    formats: ["coach_note", "take", "question"],
  },
  mistakes: {
    name: "Training mistakes",
    share: 0.15,
    goal: "a common mistake or belief that costs lifters progress, why it costs them, and what to do instead",
    guide: "Direct, never mocking: name the mistake, explain the cost, give the fix. Slightly blunt is fine, a dry joke now and then.",
    moods: ["direct", "dry_humour", "matter_of_fact"],
    formats: ["mistake", "coach_note", "take"],
  },
  mindset: {
    name: "Athlete mindset",
    share: 0.15,
    goal: "how a serious athlete thinks about training: execution, patience, accountability, confidence that comes from reps already done",
    guide: "Grounded in training, never a motivational quote or hype: what to focus on, what to ignore, what to do after a bad day.",
    moods: ["direct", "focused", "calm"],
    formats: ["take", "coach_note", "question"],
  },
  recovery: {
    name: "Recovery and performance",
    share: 0.1,
    goal: "how sleep, food, fatigue and lighter weeks show up in bar speed and RPE, and what to adjust",
    guide: "Recovery as part of the program, measured by performance, never self-care talk. Well-known basics, no studies or numbers.",
    moods: ["analytical", "matter_of_fact", "calm"],
    formats: ["coach_note", "breakdown", "take"],
  },
  hypertrophy: {
    name: "Hypertrophy for strength",
    share: 0.1,
    goal: "building the muscle that moves the big lifts: which muscles, why, and how to train them without stealing from the main work",
    guide: "Muscle as the engine for the squat, bench and deadlift, never about looks. Exercise choice, effort and fatigue, explained plainly.",
    moods: ["analytical", "direct", "curious"],
    formats: ["breakdown", "coach_note", "mistake"],
  },
  comp_prep: {
    name: "Competition prep",
    share: 0.1,
    goal: "getting ready to compete or test a max: attempts, commands, peaking, weight class, meet day",
    guide: "Practical and specific, for a first meet or a tenth: what to practise, what to plan, what not to change late.",
    moods: ["focused", "analytical", "direct"],
    formats: ["breakdown", "coach_note", "question"],
  },
};
export const DAILY_PILLAR_KEYS = Object.keys(DAILY_PILLARS) as DailyPillar[];

/** Each category's angles (stored as `topic`). */
export const DAILY_TOPICS = {
  bar_path: { pillar: "powerlifting_iq", name: "Bar path and leverages", idea: "why the bar moves where it does in the squat, bench or deadlift, what pulls it off line and how to see it on video" },
  rpe_honesty: { pillar: "powerlifting_iq", name: "RPE that means something", idea: "rating effort honestly: what a rep left in the tank looks like, why RPE drifts, how video and bar speed calibrate it" },
  top_sets: { pillar: "powerlifting_iq", name: "Top sets and back-offs", idea: "what a top set and back-off sets are each for, and what they tell you when you read them in your log" },
  sticking_points: { pillar: "powerlifting_iq", name: "Sticking points", idea: "where a lift slows down, the usual reasons, and how to find out which one it is before adding a variation" },
  specificity: { pillar: "powerlifting_iq", name: "Specificity", idea: "why the competition lifts need their own practice, and when a variation actually helps" },
  reading_the_log: { pillar: "powerlifting_iq", name: "Reading your log", idea: "trends over weeks instead of one session: load at the same RPE, bar speed, reps at a given weight" },
  set_video: { pillar: "coaches_notes", name: "What I look for in a set video", idea: "what a coach watches in a set: the setup, the first inch, where the bar slows, what changes from the first rep to the last" },
  one_variable: { pillar: "coaches_notes", name: "One change at a time", idea: "why a coach changes one variable when something stalls, so you know what fixed it" },
  execution_first: { pillar: "coaches_notes", name: "Execution over program", idea: "most sensible programs work when the sets are done as written; how they're executed matters more than which one you pick" },
  useful_notes: { pillar: "coaches_notes", name: "Notes that help your coach", idea: "what to write after a session so the next one can be adjusted: how it moved, what felt off, sleep, pain" },
  small_jumps: { pillar: "coaches_notes", name: "Small jumps", idea: "why progressing in small steps adds up over a block, and why big jumps tend to stall early" },
  sloppy_warmups: { pillar: "mistakes", name: "Sloppy warm-ups", idea: "warm-ups done differently from the top set: practising a different lift than the one you're testing" },
  every_set_a_max: { pillar: "mistakes", name: "Every set a max", idea: "grinding every set: fatigue that costs the next sessions more than it builds" },
  program_hopping: { pillar: "mistakes", name: "Changing everything", idea: "changing the program, the cues or the technique every week, so nothing gets enough time to work" },
  not_logging: { pillar: "mistakes", name: "Not logging", idea: "skipping the log, so there's no evidence of progress or of a stall" },
  junk_volume: { pillar: "mistakes", name: "Junk volume", idea: "extra sets that add fatigue without helping the main lifts" },
  chasing_soreness: { pillar: "mistakes", name: "Chasing soreness", idea: "using soreness, sweat or exhaustion as the measure of a good session" },
  bad_day_data: { pillar: "mindset", name: "A bad day is data", idea: "one bad session is one data point: what to do with it and what not to read into it" },
  boring_consistency: { pillar: "mindset", name: "Boring consistency", idea: "the same work done well for months is what moves a total" },
  earned_confidence: { pillar: "mindset", name: "Earned confidence", idea: "confidence under a heavy bar comes from reps you've already done, not from hype" },
  execution_focus: { pillar: "mindset", name: "Focus on the rep", idea: "during a set, think about one cue for the rep, not the number on the bar or the people watching" },
  long_game: { pillar: "mindset", name: "The long game", idea: "strength builds over blocks and years, so judge a week by whether it was done well" },
  own_the_basics: { pillar: "mindset", name: "Owning the basics", idea: "accountability for the things only the athlete controls: sleep, food, showing up, doing the sets as written" },
  sleep_performance: { pillar: "recovery", name: "Sleep and the bar", idea: "how a short night shows up in bar speed and RPE, and what to adjust on that day" },
  eating_to_train: { pillar: "recovery", name: "Eating to train", idea: "eating enough to train well: protein through the day, food around training, not under-eating in a strength block" },
  lighter_weeks: { pillar: "recovery", name: "Lighter weeks", idea: "what a deload or lighter week is for, and how to tell when one would help" },
  fatigue_masks_fitness: { pillar: "recovery", name: "Fatigue hides fitness", idea: "why you can feel weak at the end of a hard block and strong once the fatigue clears" },
  readiness: { pillar: "recovery", name: "Reading readiness", idea: "warm-up speed and the first working set's RPE as signals for how to run the day" },
  rest_periods: { pillar: "recovery", name: "Rest between sets", idea: "why heavy sets need longer rest, and what short rest does to the quality of the next set" },
  muscle_for_lifts: { pillar: "hypertrophy", name: "Muscle that moves the lifts", idea: "quads for the squat, pecs and triceps for the bench, back and hips for the deadlift: muscle as the engine" },
  accessories_with_a_job: { pillar: "hypertrophy", name: "Accessories with a job", idea: "picking each accessory for the muscle that's limiting a lift, not to fill time" },
  close_to_failure: { pillar: "hypertrophy", name: "Close enough to failure", idea: "taking growth sets close enough to failure to work, without wrecking the main lifts" },
  size_then_strength: { pillar: "hypertrophy", name: "Build, then express", idea: "a block focused on muscle before a strength block, and why bigger muscles give strength room to grow" },
  stable_exercises: { pillar: "hypertrophy", name: "Stable exercises for growth", idea: "machines, cables and supported variations for growth work, so the muscle is the limit, not balance" },
  attempt_selection: { pillar: "comp_prep", name: "Attempt selection", idea: "an opener you'd make on a bad day, a second that builds the total, a third that's earned in training" },
  commands: { pillar: "comp_prep", name: "Train with commands", idea: "practising squat, press and rack commands and the pause so meet day feels normal" },
  peaking: { pillar: "comp_prep", name: "Peaking", idea: "less fatigue, more specificity, heavy singles; the strength is built before the last weeks, the peak lets it show" },
  weight_class: { pillar: "comp_prep", name: "Weight class", idea: "choosing a class you can make without a big cut, since a hard cut usually costs more than it gives" },
  meet_day: { pillar: "comp_prep", name: "Meet day", idea: "warm-up timing, food and staying calm between attempts" },
  first_meet: { pillar: "comp_prep", name: "Your first meet", idea: "why a first meet is for making all your lifts and learning the day, not for a max" },
} as const satisfies Record<string, { pillar: DailyPillar; name: string; idea: string }>;
export type DailyTopic = keyof typeof DAILY_TOPICS;
export const DAILY_TOPIC_KEYS = Object.keys(DAILY_TOPICS) as DailyTopic[];
export const topicsOf = (p: DailyPillar): DailyTopic[] => DAILY_TOPIC_KEYS.filter((k) => DAILY_TOPICS[k].pillar === p);

/**
 * Earlier versions' angles, for the names of days made before. Their posts
 * were feel-good lifestyle posts, so none of them counts toward a category
 * or the learning (`pillarOf` gives null).
 */
export const LEGACY_TOPICS: Record<string, { name: string; pillar: null }> = {
  // the first version (Oct 2026)
  confidence: { name: "Confidence and self-worth", pillar: null },
  discipline: { name: "Discipline and consistency", pillar: null },
  body_image: { name: "Body image", pillar: null },
  ambition: { name: "Ambition and growth", pillar: null },
  relationships: { name: "Relationships", pillar: null },
  resilience: { name: "Resilience", pillar: null },
  burnout: { name: "Stress and burnout", pillar: null },
  overwhelm: { name: "Feeling overwhelmed", pillar: null },
  identity: { name: "Who you're becoming", pillar: null },
  small_wins: { name: "Small wins", pillar: null },
  hard_truths: { name: "Hard truths", pillar: null },
  humor_shared: { name: "Shared humour", pillar: null },
  // the feel-good version (Nov 5 to 7 2026)
  progress_noticed: { name: "Progress you stopped noticing", pillar: null },
  confidence_grown: { name: "Confidence", pillar: null },
  more_than_looks: { name: "More than looks", pillar: null },
  actually_enjoy_it: { name: "Actually enjoying it", pillar: null },
  new_identity: { name: "Who you're becoming", pillar: null },
  small_milestones: { name: "Small milestones", pillar: null },
  whats_possible: { name: "What's possible", pillar: null },
  kinder_to_yourself: { name: "Kinder to yourself", pillar: null },
  gym_floor_comedy: { name: "Gym floor comedy", pillar: null },
  expectation_reality: { name: "Plans vs what happens", pillar: null },
  food_life: { name: "Food life", pillar: null },
  lifter_habits: { name: "Lifter habits", pillar: null },
  strong_in_real_life: { name: "Strong in real life", pillar: null },
  training_partners: { name: "Training partners", pillar: null },
  cheering_others: { name: "Cheering for others", pillar: null },
  first_days: { name: "Day one", pillar: null },
  gym_friendships: { name: "Gym friendships", pillar: null },
  crew_rituals: { name: "Crew rituals", pillar: null },
  ask_the_crew: { name: "Ask the crew", pillar: null },
  training_clicks: { name: "Training, explained", pillar: null },
  eating_made_simple: { name: "Eating, made simple", pillar: null },
  recovery_wins: { name: "Recovery", pillar: null },
  one_good_cue: { name: "One good cue", pillar: null },
  myth_busted: { name: "Myth, busted", pillar: null },
  friendly_nudge: { name: "A friendly nudge", pillar: null },
  try_something_new: { name: "Try something new", pillar: null },
  honest_and_kind: { name: "Honest, and kind", pillar: null },
  mini_challenge: { name: "Mini challenge", pillar: null },
};
/** Earlier versions' caption forms, for the names of days made before. */
export const LEGACY_FORMAT_NAMES: Record<string, string> = {
  observation: "Observation",
  humor: "Humour",
  scenario: "Relatable moment",
  encouragement: "Encouragement",
  // retired Nov 5 2026: they read as scripted ("signs you're…" lists, "me: / my legs:" bits, scenes narrated to "you")
  short_story: "Short story",
  dialogue: "Dialogue",
  list: "List",
  // the feel-good version's (Nov 5 to 7 2026)
  one_liner: "One-liner",
  quick_take: "Thought",
  tip: "Advice",
  funny: "Funny",
};

export const topicName = (t: string | null | undefined): string | null =>
  !t ? null : t in DAILY_TOPICS ? DAILY_TOPICS[t as DailyTopic].name : (LEGACY_TOPICS[t]?.name ?? null);
export const formatName = (f: string | null | undefined): string | null =>
  !f ? null : f in DAILY_FORMATS ? DAILY_FORMATS[f as DailyFormat].name : (LEGACY_FORMAT_NAMES[f] ?? null);
/** A day's category: the concept's own, else its angle's; an earlier version's day has none. */
export function pillarOf(o: { pillar?: string | null; topic?: string | null } | null | undefined): DailyPillar | null {
  if (!o) return null;
  if (o.pillar && o.pillar in DAILY_PILLARS) return o.pillar as DailyPillar;
  if (o.topic && o.topic in DAILY_TOPICS) return DAILY_TOPICS[o.topic as DailyTopic].pillar;
  return null;
}

/**
 * How a caption is told, and how long it may run (characters). About 40 to
 * 100 words (DAILY_MIN_WORDS is the floor); a breakdown and a coach's note
 * get the database's whole 600 characters, about 100 words, for a technical
 * idea that needs the room.
 */
export const DAILY_FORMATS: Record<DailyFormat, { name: string; guide: string; max: number }> = {
  coach_note: { name: "Coach's note", guide: "the point first, then why it happens and what to do about it, in a few short paragraphs, the way he'd say it between sets", max: 600 },
  breakdown: { name: "Breakdown", guide: "one technical idea explained: what happens, why it matters, how to check it in your own lifting", max: 600 },
  mistake: { name: "Mistake", guide: "a common mistake or belief, what it costs, and what to do instead", max: 560 },
  take: { name: "Short take", guide: "one direct point and the reason behind it, in two or three short paragraphs", max: 480 },
  question: { name: "Question", guide: "a real training question for the crew, with why he's asking and how he'd think about it, so the answers are worth reading", max: 480 },
};
export const DAILY_FORMAT_KEYS = Object.keys(DAILY_FORMATS) as DailyFormat[];
/** Under this a post is a slogan, not a coaching point (the target is about 40 to 100 words). */
export const DAILY_MIN_WORDS = 35;

/** Who it's for, besides women / men / everyone: where they are with training (the keys are the database's). */
export const DAILY_CROWDS: Record<DailyCrowd, { name: string; guide: string }> = {
  everyone: { name: "Everyone", guide: "anyone who trains seriously, from their first program to their tenth meet" },
  beginners: { name: "Newer lifters", guide: "lifters in their first year or two: learning the lifts, running their first programs, setting their first PRs" },
  lifestyle: { name: "Strength for life", guide: "people who train for strength and health around work and family, not to compete, and still want to do it right" },
  lifters: { name: "Powerlifters", guide: "competitive and serious lifters who run programs, use RPE, plan top sets and enter meets" },
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
  courage: { dow: 1, name: "New week", idea: "Monday: a new training week, setting up the week's work", lean: { coaches_notes: 0.3, mistakes: 0.2 } },
  patience: { dow: 2, name: "The long game", idea: "Tuesday: progress over blocks, not sessions", lean: { powerlifting_iq: 0.3, mindset: 0.1 } },
  your_circle: { dow: 3, name: "Midweek", idea: "Wednesday: the middle of the training week, how the work is going", lean: { hypertrophy: 0.2, recovery: 0.2 } },
  self_reflection: { dow: 4, name: "Read your log", idea: "Thursday: what the log says about the last few weeks", lean: { powerlifting_iq: 0.3, mistakes: 0.1 } },
  encouragement: { dow: 5, name: "Week in review", idea: "Friday: how the training week went, and what to take into the next one", lean: { coaches_notes: 0.3, mistakes: 0.2 } },
  self_love: { dow: 6, name: "Heavy day", idea: "Saturday: the long or heavy session of the week, doing the work well when it's hard", lean: { powerlifting_iq: 0.2, comp_prep: 0.2, hypertrophy: 0.1 } },
  emotional: { dow: 7, name: "Rest & reset", idea: "Sunday: recovery, reviewing the week and setting up the next one", lean: { recovery: 0.4, mindset: 0.3 } },
};

export const DAILY_THEME_KEYS = Object.keys(DAILY_THEMES) as DailyTheme[];

export function themeForDow(dow: number): DailyTheme {
  return DAILY_THEME_KEYS.find((k) => DAILY_THEMES[k].dow === dow) ?? "encouragement";
}

export const DAILY_AUDIENCE_GUIDE: Record<DailyAudience, string> = {
  women: "Women who lift, at every level, serious about their training. Strength and performance, never how she should look.",
  men: "Men who lift, at every level, around work and family. Straight talk, never macho or preachy.",
  everyone: "Everyone in the crew: an idea any lifter can use.",
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
    use: "the gym and the platform: lifting, coaching, technique, loading the bar, a meet",
  },
  anime: {
    name: "B · Cinematic 2D anime",
    look: "Art direction B, beautiful cinematic 2D anime like a frame from a modern anime film: thin, clean, confident linework; two-tone cel shading with one soft shadow tone; a glowing golden-hour or sunset sky with soft painted clouds and silhouetted buildings and trees; warm sunlight flooding the frame and a bright rim light glowing along the hair and face; complementary colours in the clothes and scene (orange against teal, gold against blue); calm, expressive faces in profile or three-quarter view; intimate medium close-ups.",
    use: "the moments around training: the warm-up room, writing in the log, the walk in, recovery, the night before a meet",
  },
};
export const DAILY_ART_KEYS = Object.keys(ART_STYLES) as DailyArt[];

/** What it must never look like (the muddy, dark first tries included). */
export const FILM_AVOID =
  "Avoid: brown or grey colour grading, desaturated or muted colour, a dark, gloomy or murky scene, heavy film grain or dirty textures, low contrast, flat lifeless colour, blurry, smudged or painterly faces, watercolour or oil-painting looks, photorealism or a photograph, 3D, CGI or Pixar-like rendering, plastic skin, childish cartoon proportions, exaggerated anime expressions or giant eyes, a motivational poster, logos or watermarks.";

export const DAILY_STYLES: Record<DailyStyle, { name: string; look: string }> = {
  wide_moment: { name: "Wide scene", look: "a wide shot of a training space full of life and colour: a busy gym floor, a powerlifting platform, a garage gym, a meet's warm-up room." },
  medium_candid: { name: "Candid moment", look: "a medium shot caught mid-moment in training, what they're doing and thinking reading clearly from their posture, face and hands." },
  two_people: { name: "Two people", look: "two people in training (a coach and a lifter, training partners), the relationship in how they stand, cue, spot and react." },
  group: { name: "Group", look: "a few lifters together (a training group between sets, a meet crew, teammates loading a bar), the energy between them." },
  in_action: { name: "In action", look: "mid-rep on a squat, bench press or deadlift with real effort and motion, the bar, the plates and the body drawn correctly." },
  close_detail: { name: "Close-up detail", look: "a close-up on the details that tell the story (chalked hands on the knurl, a belt being tightened, a pencil on a training log, plates and collars), the person partly in frame." },
  over_shoulder: { name: "Over the shoulder", look: "over the shoulder, seeing what they see: the bar waiting in the rack, the coach watching from the side, the judges and lights at a meet, a log open on a bench." },
  low_angle: { name: "Low angle", look: "a low angle looking up at a lifter set up under the bar or locking out a lift, bright lights behind them." },
  framed_view: { name: "Framed view", look: "framed through the rack's uprights, a doorway or the edge of a mirror, as if we're watching a set from the side of the gym." },
  backlit: { name: "Backlit", look: "backlit by a big gym window or a bright platform light, a glowing rim of light around the lifter, long colourful shadows." },
  overhead: { name: "From above", look: "a top-down view (a lifter's stance on the platform, a training log with a pencil, chalk and a coffee, a meal prepped next to a notebook)." },
  two_frames: { name: "Two frames", look: "two frames side by side like a storyboard, the same lifter in two moments (the rep they felt and the rep on video, week one and week eight, the warm-up and the top set), the point living between them." },
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
/** A caption past this is "long" for the learning (about 70 words and up). */
export const LONG_CAPTION = 420;

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

/** How far the learning may move a category from its starting share, either way. */
export const PILLAR_NUDGE = { min: 0.75, max: 1.3 } as const;

/**
 * The mix to aim for: the starting shares, each nudged (within PILLAR_NUDGE)
 * by how its posts do against the others once it has LEARN_MIN_POSTS of them.
 */
export function pillarShares(l: Pick<DailyLearnings, "pillar">): Record<DailyPillar, number> {
  const proven = DAILY_PILLAR_KEYS.filter((k) => l.pillar[k].n >= LEARN_MIN_POSTS);
  const avg = proven.length ? proven.reduce((t, k) => t + l.pillar[k].mean, 0) / proven.length : 0;
  const raw = Object.fromEntries(
    DAILY_PILLAR_KEYS.map((k) => {
      const base = DAILY_PILLARS[k].share;
      const m = proven.includes(k) && avg > 0 ? Math.min(PILLAR_NUDGE.max, Math.max(PILLAR_NUDGE.min, l.pillar[k].mean / avg)) : 1;
      return [k, base * m];
    }),
  ) as Record<DailyPillar, number>;
  const total = DAILY_PILLAR_KEYS.reduce((t, k) => t + raw[k], 0);
  return Object.fromEntries(DAILY_PILLAR_KEYS.map((k) => [k, raw[k] / total])) as Record<DailyPillar, number>;
}

/** The days a category's share is counted over. */
export const PILLAR_WINDOW = 20;

const dowOf = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const gap = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

/**
 * Today's category, best first: the one furthest behind its share over the
 * days around it (PILLAR_WINDOW), plus the weekday's small lean. Never the
 * same as the day before or after.
 */
export function pickPillars(l: Pick<DailyLearnings, "pillar">, day: string, around: { day: string; pillar?: DailyPillar | string | null }[], rand: () => number = Math.random): DailyPillar[] {
  const shares = pillarShares(l);
  const others = around.filter((a) => a.day !== day && a.pillar && a.pillar in DAILY_PILLARS);
  const window = others.filter((a) => gap(a.day, day) <= PILLAR_WINDOW);
  const n = window.length + 1;
  const count = (p: DailyPillar) => window.filter((a) => a.pillar === p).length;
  const neighbours = new Set(others.filter((a) => gap(a.day, day) === 1).map((a) => a.pillar));
  const lean = DAILY_THEMES[themeForDow(dowOf(day))].lean;
  const allowed = DAILY_PILLAR_KEYS.filter((p) => !neighbours.has(p));
  const pool = allowed.length ? allowed : DAILY_PILLAR_KEYS;
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
  const formats = [...rank(fits.filter((f) => !usedFormats.has(f)), l.format, rand()), ...fits.filter((f) => usedFormats.has(f))];
  const usedStyles = used(4, (r) => r.style);
  const styles = o.style ? [o.style] : rank(DAILY_STYLE_KEYS.filter((s) => !usedStyles.has(s)), l.style, rand());
  const usedLights = used(3, (r) => r.light);
  const spin = Math.floor(rand() * DAILY_LIGHT_KEYS.length);
  const lights = DAILY_LIGHT_KEYS.filter((k) => !usedLights.has(k)).map((k, i, a) => a[(i + spin) % a.length]);
  return { pillar, topics, formats, styles: styles.length ? styles : DAILY_STYLE_KEYS, lights: lights.length ? lights : DAILY_LIGHT_KEYS };
}

/** What's worked, in plain words, for the writer and the coach's card. */
export function learningsText(l: DailyLearnings): string {
  if (l.posts < LEARN_MIN_POSTS) return "Not enough posted yet to tell what works. Trying the full mix of categories, shots and forms.";
  const best = <K extends string>(a: Record<K, Arm>, name: (k: K) => string) =>
    (Object.keys(a) as K[])
      .filter((k) => a[k].n >= 2)
      .sort((x, y) => a[y].mean - a[x].mean)
      .slice(0, 2)
      .map(name);
  const out: string[] = [];
  const pillars = best(l.pillar, (k) => DAILY_PILLARS[k as DailyPillar].name);
  if (pillars.length) out.push(`Categories landing best: ${pillars.join(", ")}.`);
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
  /** Each draft's form, in the same order (the chosen one's becomes `format`). */
  draftForms: DailyFormat[];
  /** The chosen, polished caption. */
  caption: string;
};

/**
 * His voice, from the coach's own words (Nov 7 2026): the two posts he wrote
 * to show how a post should read. References for the writer and the editor,
 * never templates (each is checked against so neither can come back near
 * word for word).
 */
export const VOICE_EXAMPLES = [
  `Being in the gym for 3 hours doesn't automatically mean you trained harder.

I care about the quality of your working sets, not how long you occupied a bench.

If your main lifts are progressing, your accessories have a purpose, and you're recovering between sessions, we're doing something right.

More work isn't always better work. Stop confusing time spent training with productive training.`,
  `Your rest day is part of your program. Not a day you failed to train.

You don't get stronger just because you accumulated more fatigue. You get stronger when your body adapts to the training you've already done.

If your performance keeps declining, adding another hard session probably isn't the answer.

The goal isn't to see how much work you can survive. It's to find how much productive work you can recover from.`,
] as const;
/** Both examples as one block, for the prompts. */
export const VOICE_EXAMPLE = VOICE_EXAMPLES.join("\n\n---\n\n");

/** The examples' own lines, which a caption never borrows. */
export const EXAMPLE_LINES = [
  "rest day is part of your program",
  "a day you failed to train",
  "how much work you can survive",
  "productive work you can recover from",
  "how long you occupied a bench",
  "time spent training with productive training",
  "more work isn't always better work",
  "we're doing something right",
] as const;

/** What it must never sound like: the post he pointed to as scripted (Nov 5's), and the motivation-page lines he banned (Nov 7). */
export const NOT_HIS_VOICE = `Signs you're not "starting over" again, you're just a guy who trains now:

Alarm goes off and you just stand up.
You pack your bag before bed without thinking.
The old you would be shocked. The new you just calls it Thursday.

---

Rest days matter too! Remember to listen to your body and give yourself grace. Every little bit counts. You got this! 💪`;

/** How he writes, said once for the writer, the editor and a rewrite. */
export const VOICE_GUIDE = `HOW JARED WRITES
He's an elite powerlifting coach explaining something to an athlete between sets. These two posts are him (references for the voice, never templates to copy):

${VOICE_EXAMPLE}

Direct, confident, conversational and analytical. Athlete to athlete: he respects the reader's intelligence and talks about execution, accountability and measurable progress. Occasionally dry or a little sarcastic, never mean. Every post leaves a lifter with something they can understand, check or do in their own training.

This is NOT him (scripted copywriting, or a fitness motivation page):

${NOT_HIS_VOICE}

THE SHAPE (use it flexibly; not every post needs every part):
- Hook: the first sentence states the point or the tension, short enough to read in the preview.
- Insight: why it happens, what's really going on.
- Application: what to do, check or change in your own training.
- Takeaway: one closing line only when it adds something; never a slogan or a moral.

THE RULES
- About 40 to 100 words. Longer only when a technical point needs it. Short paragraphs, five at most.
- Normal sentence case and punctuation: capitals at the start of sentences, "I", names of days, RPE and PR. Contractions with apostrophes. No hashtags, no @tags, no dashes or semicolons, at most one emoji (usually none), no exclamation-mark hype.
- Plain, precise words. Training terms lifters use are fine (RPE, top set, back-off sets, bar speed, lockout, hypertrophy); explain anything past that.
- Never invent. No personal stories (with or without the "I": no "yesterday a client", no "when I started lifting"), no clients, athletes or results, no studies, research, statistics or percentages (the lessons carry the research, with their sources). Say how sure he is: an established principle plainly, his opinion as his ("I think", "my rule of thumb"), and where it depends on the lifter, say so ("for most lifters", "depends on your leverages").
- Never these lines or anything like them: "every little bit counts", "give yourself grace", "remember to listen to your body", "you got this", "movement is medicine", "there are worse places to spend your time", "trust the process", "no excuses", "your future self".
- No AI transitions or tells ("here's the thing", "the truth is", "let that sink in", "at the end of the day", "the key takeaway", "ultimately", "dive into", "journey", "game changer").
- Never these shapes: a list post or a setup line ending in a colon, a "me: / my legs:" script, a little scene narrated to "you" ("you walk in… you load the bar… you realize…"), "the old you / the new you", "it's not X, it's Y" more than once, words in scare quotes.
- Bodies: strength and performance, never how someone looks. Talk with lifters, never down to them: blunt about the training, never about the person.
- No names (his shows on the post) and no Bible verses (the app adds Sunday's).`;

export const CONCEPT_PROMPT = `You write the daily post for the JF Effect community feed, as Jared, the powerlifting coach who runs it. The crew is men and women who lift, from newer lifters to competitive powerlifters. A post is a picture and a caption made together, and it should be worth opening the app for: one training idea a lifter can use, said the way an elite coach explains something between sets. Not another fitness motivation page.

${VOICE_GUIDE}

WORK IT OUT IN THIS ORDER
1. The category is given. Pick one angle from its list.
2. The point: what he wants a lifter to understand or do, in one plain sentence. It must be true for most lifters and defensible to another good coach.
3. The picture: one specific training moment that goes with the point (it sets the scene; the caption never describes it or repeats words in it).
4. Three different captions, three takes on the point, each labelled with its form. Pick the clearest and most useful first, not the most dramatic.

THE PICTURE
- A frame from a premium, colourful, hand-drawn 2D animated film (the look is fixed; you choose the moment, the art direction, the shot and the colour and light). It shows strength training, the same place, time and people as the caption.
- What it shows: a squat, bench press or deadlift (the setup, mid-rep, the lockout), a coach watching or cueing a lifter, a training log or notebook with a pencil, loading plates, chalking up, a belt and knee sleeves, a warm-up room, a meet platform with judges, or recovery that belongs to training (a meal prepped next to a training log, sleep before a heavy day, an easy walk the day after a meet, a light deload session). Real gyms: racks, platforms, barbells, plates, benches, chalk.
- Equipment drawn right: a straight barbell with the same plates on both sides and collars, a real rack or bench, the grip and stance that lift actually uses.
- Describe the frame: who's in it (adults, their age range, build, hair and training clothes, people of different looks, fitting who it's for), what they're doing and thinking, where they are, what's around them.
- Never a lifestyle scene with no training in it (picnics, beaches, brunch, parks, parties), never someone miserable alone in a dark room, staring at a phone, undressed, measuring their body or on a scale, never a poster, a pose or someone looking at the camera. Bright and inviting; night only when the moment needs it, then with vivid colour and one bright light.
- Most pictures have no words in them. Put words in the scene (a line in a training log, a note, a sign) only when they ARE the point, and then write exactly those words in "typography" (at most 12). With no words in the scene, "typography" is "".

Answer with JSON only:
{"topic": "the angle", "mood": "...", "situation": "the moment", "idea": "the point, in one sentence", "art": "graphic or anime", "style": "the shot", "light": "...", "visual": "...", "typography": "...", "captions": [{"form": "...", "text": "..."}, {"form": "...", "text": "..."}, {"form": "...", "text": "..."}]}`;

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
  /** One of the two posts before had words in its picture: today's has none. */
  noWords?: boolean;
}): string {
  const t = DAILY_THEMES[o.theme];
  const p = DAILY_PILLARS[o.choices.pillar];
  const ordered = [...o.recent].sort((a, b) => a.day.localeCompare(b.day)).filter((r) => r.day !== o.day);
  const before = ordered.filter((r) => r.day < o.day).slice(-2);
  const asked = before.length === 2 && before.every((r) => r.caption && endsWithQuestion(r.caption));
  return [
    `TODAY: ${t.idea}.`,
    `CATEGORY: ${p.name}. The goal: ${p.goal}. ${p.guide}`,
    `ANGLES, as "topic" (pick one, best first): ${o.choices.topics.map((k) => `${k} = ${DAILY_TOPICS[k].idea}`).join("; ")}`,
    `MOOD, as "mood" (pick one): ${p.moods.join(", ")}`,
    `WHO IT'S FOR: ${DAILY_AUDIENCE_GUIDE[o.audience]} Today especially ${DAILY_CROWDS[o.crowd].guide}.`,
    o.faith ? "SUNDAY: a Bible verse goes under the caption. Keep the post about training (recovery, review, the week ahead) and leave the verse to speak for itself: no preaching." : null,
    `CAPTION FORMS, as each draft's "form" (best first; two drafts can share one): ${o.choices.formats.map((k) => `${k} = ${DAILY_FORMATS[k].guide} (up to ${DAILY_FORMATS[k].max} characters)`).join("; ")}`,
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
    o.noWords ? 'NO WORDS IN THE PICTURE TODAY (a post just before had some): "typography" is "".' : null,
    o.neverSay?.length ? `THE COACH NEVER SAYS: ${o.neverSay.join(", ")}` : null,
    // what landed is said as kinds of posts, never as captions to copy (the early ones were in a voice he's retired)
    `WHAT'S WORKED WITH THIS CREW: ${o.learnings}`,
    o.rejected?.length ? `THE COACH THREW THESE OUT (never write like them):\n${o.rejected.map((l) => `- ${l.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}` : null,
    ordered.length
      ? `RECENT POSTS (pick a different angle, moment and opening; don't copy how they're written):\n${ordered
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

/** The art direction a category leans to when the writer doesn't pick one. */
export function artForPillar(p: DailyPillar): DailyArt {
  return p === "mindset" || p === "recovery" ? "anime" : "graphic";
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
    const fallback: DailyFormat = isKey(allowed.formats, j.format) ? j.format : allowed.formats[0];
    // a draft is "text" or {form, text}; a form outside the ones offered reads as the first one offered
    const raw = (Array.isArray(j.captions) ? j.captions : [j.caption])
      .map((c: unknown) =>
        c && typeof c === "object"
          ? { text: unquote(str((c as any).text, 900)), form: isKey(allowed.formats, (c as any).form) ? ((c as any).form as DailyFormat) : fallback }
          : { text: unquote(str(c, 900)), form: fallback },
      )
      .filter((d: { text: string }) => d.text)
      .slice(0, 3) as { text: string; form: DailyFormat }[];
    const drafts = raw.map((d) => d.text);
    const pillar = allowed.pillar;
    const c: DailyConcept = {
      pillar,
      topic: isKey(allowed.topics, j.topic) ? j.topic : allowed.topics[0],
      crowd: allowed.crowd ?? "everyone",
      mood: isKey(DAILY_PILLARS[pillar].moods, j.mood) ? j.mood : DAILY_PILLARS[pillar].moods[0],
      situation: str(j.situation, 500),
      tension: str(j.tension, 300),
      message: str(j.idea ?? j.message, 300),
      format: raw[0]?.form ?? fallback,
      style: isKey(allowed.styles, j.style) ? j.style : allowed.styles[0],
      light: isKey(DAILY_LIGHT_KEYS, j.light) ? j.light : (allowed.lights?.[0] ?? "golden_teal"),
      art: allowed.art ?? (isKey(DAILY_ART_KEYS, j.art) ? j.art : artForPillar(pillar)),
      visual: str(j.visual, 1400),
      typography: str(j.typography, 100).replace(/^["“]|["”]$/g, ""),
      drafts,
      draftForms: raw.map((d) => d.form),
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

export const EDITOR_SCORES = ["natural", "substance", "accuracy", "clarity", "match", "fresh", "worth_it"] as const;
export type EditorScore = (typeof EDITOR_SCORES)[number];
export const EDITOR_FLAGS = ["scripted", "hype", "ai_phrasing", "preachy", "invented", "shaming", "generic"] as const;
export type EditorFlag = (typeof EDITOR_FLAGS)[number];

/** Each score the chosen draft has to reach. */
export const EDITOR_BARS: Record<EditorScore, number> = { natural: 4, substance: 4, accuracy: 4, clarity: 4, match: 3, fresh: 3, worth_it: 4 };

export const EDITOR_PROMPT = `You're the editor of the JF Effect community feed, a powerlifting coach's app. Every caption has to pass one test: would Jared, an elite powerlifting coach, post this as his own, and would a serious lifter be glad they read it? You get today's post plan (one picture) and up to three caption drafts.

${VOICE_GUIDE}

Score each draft 1 to 5 (5 = excellent, 4 = good enough to publish, 3 = needs work, 2 or 1 = poor):
- natural: reads exactly like Jared, a coach talking to an athlete, not a copywriter, a brand, a motivational speaker or an AI
- substance: one real training idea a lifter can understand, check or use (why it happens, what to do), not a feeling or a slogan
- accuracy: true for most lifters and defensible to another good coach; nothing overstated, opinion said as opinion, "it depends" said where it does
- clarity: you get it on one read on a phone
- match: it goes with the picture without describing it or repeating its words
- fresh: different from the recent posts in angle, opening and shape
- worth_it: a lifter would save it, comment on it or send it to a training partner

Flags (true or false):
- scripted: a formula: a list post, a "me: / my legs:" bit, a scene narrated to "you", "the old you / the new you", "it's not X, it's Y" twice, a kicker line or moral at the end
- hype: motivation-page energy: hype words, exclamation marks, a pep talk, a poster line
- ai_phrasing: phrases, transitions or rhythms that give away an AI
- preachy: moralizing, guilt, or talking down to the reader (direct about the training is fine)
- invented: a fact, number, study, statistic, name, result or personal story it can't stand behind (a story told as his own counts, even with the "I" left off)
- shaming: makes anyone feel bad about their body or themselves
- generic: could sit on any fitness page; says nothing specific about training

Then pick the clearest, most useful draft (not the most dramatic or clever) and polish it: only edits that make it plainer and tighter (cut a word or a sentence, simpler wording, fix punctuation, capitals or a paragraph break). Keep normal sentence case. Never add a closing line, a question, an emoji, a claim or a name, and never change the point. If it's already right, return it unchanged.

Answer with JSON only:
{"drafts": [{"scores": {"natural": 1-5, "substance": 1-5, "accuracy": 1-5, "clarity": 1-5, "match": 1-5, "fresh": 1-5, "worth_it": 1-5}, "flags": {"scripted": false, "hype": false, "ai_phrasing": false, "preachy": false, "invented": false, "shaming": false, "generic": false}, "note": "one line"}], "best": 0, "polished": "...", "why": "one line"}`;

export function editorPrompt(o: {
  concept: Pick<DailyConcept, "pillar" | "topic" | "crowd" | "mood" | "situation" | "message" | "visual" | "typography" | "format">;
  audience: DailyAudience;
  drafts: string[];
  /** Each draft's form, when they differ. */
  forms?: DailyFormat[];
  recent: string[];
}): string {
  const p = DAILY_PILLARS[o.concept.pillar];
  const label = (i: number) => (o.forms?.[i] && DAILY_FORMATS[o.forms[i]] ? ` (${DAILY_FORMATS[o.forms[i]].name}: ${DAILY_FORMATS[o.forms[i]].guide})` : "");
  return [
    `CATEGORY: ${p.name}. The goal: ${p.goal}`,
    `ANGLE: ${DAILY_TOPICS[o.concept.topic]?.idea ?? o.concept.topic}`,
    `FOR: ${DAILY_AUDIENCE_GUIDE[o.audience]} Especially ${DAILY_CROWDS[o.concept.crowd]?.guide ?? "anyone who trains"}.`,
    `MOOD: ${o.concept.mood}`,
    `THE MOMENT: ${o.concept.situation}`,
    `THE IDEA: ${o.concept.message}`,
    `THE PICTURE: ${o.concept.visual}`,
    o.concept.typography ? `WORDS IN THE PICTURE: ${o.concept.typography}` : "THE PICTURE HAS NO WORDS IN IT.",
    o.forms?.length ? null : `THE FORM: ${DAILY_FORMATS[o.concept.format]?.guide ?? o.concept.format}`,
    o.recent.length ? `RECENT POSTS:\n${o.recent.slice(-10).map((r) => `- ${r.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}` : null,
    `THE DRAFTS:\n${o.drafts.map((d, i) => `[${i}]${label(i)}\n${d}`).join("\n\n")}`,
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
export function editorVerdict(e: EditorReview, _pillar?: DailyPillar | null): { pass: boolean; issues: string[] } {
  const d = e.drafts[e.best];
  const issues: string[] = [];
  for (const k of EDITOR_SCORES) if (d.scores[k] < EDITOR_BARS[k]) issues.push(`${k.replace("_", " ")} ${d.scores[k]}/5`);
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
  whats: "what's", theres: "there's", heres: "here's", im: "i'm", ive: "i've", ill: "i'll", itll: "it'll", lets: "let's",
};
/** "lets" is also a word ("it lets you"), so it's only fixed where it starts a sentence. */
const AMBIGUOUS = new Set(["lets", "ill", "wont", "cant"]);

/** Training terms that are always written in capitals (e1RM keeps its small e). */
const ACRONYMS: Record<string, string> = { rpe: "RPE", pr: "PR", prs: "PRs", rir: "RIR", "1rm": "1RM", e1rm: "e1RM", amrap: "AMRAP" };

/**
 * A caption as it should read in the feed, in normal sentence case (Nov 7
 * 2026: the coach's posts read like a coach, not a casual lowercase text):
 * real apostrophes ("dont" and "im" fixed), "I", a capital at the start of
 * every line and sentence, days and months capitalised, RPE / PR / RIR in
 * capitals, no em dashes or "&", no stray spaces, at most one blank line
 * between paragraphs, and never wrapped in quotes.
 */
export function tidyCaption(text: string): string {
  let t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  t = t.replace(/^["“]([\s\S]*)["”]$/, "$1").trim();
  // a model's Unicode hyphens (non-breaking "after‑work") read and compare as a plain "-"
  t = t.replace(/[\u2010\u2011\u2012]/g, "-");
  t = t.replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2");
  t = t.replace(/\s*[—–]\s*/g, ", ");
  t = t.replace(/\s+&\s+/g, " and ");
  t = t.replace(/[‘’]/g, "'");
  t = t.replace(/[“”]/g, '"');
  t = t.replace(/\b([A-Za-z]+)\b/g, (w, _x, i: number) => {
    const fix = CONTRACTIONS[w.toLowerCase()];
    if (!fix) return w;
    const before = t.slice(0, i);
    if (AMBIGUOUS.has(w.toLowerCase()) && !/(^|[.!?\n]\s*)$/.test(before)) return w;
    return fix;
  });
  // sentence case: "I" (and I'm, I've), training acronyms, days and months, the first word of a line or sentence
  t = t.replace(/\bi\b/g, "I");
  t = t.replace(/\b(rpe|prs?|rir|1rm|e1rm|amrap)\b/gi, (w) => ACRONYMS[w.toLowerCase()] ?? w);
  // "march" and "may" are words too, so only the unambiguous ones
  t = t.replace(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|august|september|october|november|december)\b/g,
    (w) => w[0].toUpperCase() + w.slice(1),
  );
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
  // the lines the coach banned (Nov 7 2026): a fitness motivation page, not a coach
  "every little bit counts",
  "every little bit helps",
  "give yourself grace",
  "listen to your body",
  "you've got this",
  "movement is medicine",
  "worse places to spend your time",
  "every rep counts",
  "proud of you",
  "be kind to yourself",
  "self-care",
  "self care",
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
  // transitions an AI reaches for
  "at the end of the day",
  "the bottom line",
  "the key takeaway",
  "key takeaway",
  "the takeaway",
  "ultimately,",
  "moreover",
  "furthermore",
  "additionally,",
  "dive into",
  "deep dive",
  "it's important to",
  "it's worth noting",
  "in today's",
  "in conclusion",
] as const;

/**
 * Kicker lines, meme slang and clickbait the writer reaches for (from the
 * audit of Nov 2 to 8 and the test posts): none of them is how he writes.
 */
export const SCRIPTED_PHRASES = [
  "the old you",
  "the new you",
  "secretly",
  "plot twist",
  "say less",
  "main character",
  "core memory",
  "this is your sign",
  "your sign to",
  "this is your reminder",
  "nobody talks about",
  "no one talks about",
  "things nobody tells you",
  "hits different",
  "lowkey",
  "low-key",
  "it's giving",
  "rent free",
  "pov:",
  "normalize",
  "chef's kiss",
  "iykyk",
  "the work worked",
  "take the win",
  "worse problems to have",
  "you know you're a",
  "signs you're",
  "signs that you",
  "unpopular opinion",
  "hot take",
  "in this economy",
] as const;

const sentencesOf = (text: string) =>
  text
    .split(/[.!?]+\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** A sentence that walks "you" through a scene, a step at a time. */
const SCENE_TO_YOU = /^you\s+(?:walk|walked|load|loaded|open|opened|see|saw|look|looked|grab|grabbed|pack|packed|step|stepped|check|checked|unrack|sit|sat|stand|stood|wake|woke|get to|realize|realise|feel|notice|hear|pick|put|head|drive|leave|finally)\b/i;

/**
 * The shapes that read as a script, not a person: a list post (a setup line
 * ending in a colon), a "me: / my legs:" bit, a little movie narrated to
 * "you", a "that's not X. that's Y." kicker, hype, scare quotes, or the
 * coach's own example coming back near word for word.
 */
export function scriptedProblems(text: string): string[] {
  const out: string[] = [];
  const t = text.replace(/[’]/g, "'");
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.some((l, i) => /:\s*$/.test(l) && i < lines.length - 1)) out.push("a setup line ending in a colon (reads like a list post)");
  if (lines.filter((l) => /^(me|you|also me|my [a-z' ]{1,20}|the [a-z ]{1,20}|everyone|them|coach)\s*:\s*\S/i.test(l)).length >= 2)
    out.push('a "me: / my legs:" script');
  // a coach explains to "you" ("you get stronger when…"); a script narrates "you" through a scene ("you walk in. you load the bar.")
  const toYou = sentencesOf(t).filter((x) => SCENE_TO_YOU.test(x)).length;
  if (toYou >= 3) out.push(`narrates a scene to "you" (${toYou} sentences walk "you" through it)`);
  if (/\b(?:that|this|it)(?:'s| is) not [^.!?\n]{1,40}[.!?]\s+(?:that|this|it)(?:'s| is) [^.!?\n]{1,40}[.!?]?\s*$/i.test(t))
    out.push('ends on a "that\'s not X. that\'s Y." kicker');
  const last = sentencesOf(t).pop() ?? "";
  const lastTwo = sentencesOf(t).slice(-2).join(". ");
  if (/\b(?:isn't|is not|aren't|are not) (?:just|only) [^.!?]{1,60}[.!?,]?\s*(?:it's|it is|they're|they are)(?: also)? /i.test(lastTwo) || /\b(?:isn't|aren't) (?:just|only)\b.*\b(?:it's|they're) also\b/i.test(last))
    out.push('ends on a moral ("X isn\'t just Y. it\'s also Z")');
  if (/\bjust (?:a )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t)) out.push('the "it\'s just tuesday now" trope');
  if (firstPersonStory(t)) out.push("tells a story as his own (it never happened to him)");
  if ((t.match(/!/g) ?? []).length >= 2) out.push("more than one exclamation mark");
  if ((t.match(/"[^"\n]{1,40}"/g) ?? []).length >= 2) out.push("words in scare quotes");
  if (VOICE_EXAMPLES.some((x) => captionSimilarity(t, x) >= 0.25)) out.push("copies a voice example (they're references, not templates)");
  // their own lines don't come back either (the first test batch closed on its example's "that's progress too." twice in ten)
  const plain = ` ${t.toLowerCase().replace(/[^a-z']+/g, " ")} `;
  for (const line of EXAMPLE_LINES) if (plain.includes(` ${line} `)) out.push(`borrows "${line}" from the voice example`);
  return out;
}

/**
 * A story told as the coach's own: something he did or that happened to him
 * ("i'm checking the clock", "i went", "my legs", "a lot of my clients"), or
 * the same with the "i" dropped at the start of a sentence ("planned a quick
 * lift.", "called it a quick workout"). His opinions and what he notices are
 * fine ("i think", "i've noticed", "i'm convinced"), and so is advice ("hit
 * the reps").
 */
const FIRST_PERSON_STORY = [
  /\bi'm (?!(?:not |just |still )?(?:saying|talking|guessing|telling|thinking|asking|wondering|convinced|sure|curious|a big|a fan|all for)\b)\w+ing\b/i,
  /\bi (?:was|went|did|had|got|planned|tried|spent|walked|left|showed|took|finished|started|ran|lifted|ate|sat|woke|remember)\b/i,
  /\bi've (?:been|got|had|done|hit|spent|tried)\b/i,
  /\bmy (?:legs|arms|back|workout|session|squat|bench|deadlift|lift|gym|program|clients?|wife|kids|son|daughter|husband|girlfriend|boyfriend|friends?|buddy|partner|coach|mom|dad|brother|sister)\b/i,
  /(?:^|[.!?]\s+|\n)(?:called|told|said|went|walked|left|showed|decided|planned|tried|grabbed|started|finished|spent|took|woke|realized)\b/i,
];
export const firstPersonStory = (text: string): boolean => FIRST_PERSON_STORY.some((re) => re.test(text.replace(/[’]/g, "'")));

/** A crew member's first name in a caption (their name shows on their own posts; a daily post names nobody). */
export function namedPeople(text: string, names: readonly string[]): string[] {
  const lower = ` ${text.toLowerCase().replace(/[^a-z']+/g, " ")} `;
  return [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3 && lower.includes(` ${n} `)))];
}

/**
 * "It's not X, it's Y" said twice in one caption: the contrast every AI
 * writer leans on. Once is natural; twice reads like a template.
 */
const CONTRAST = /\b(?:not|isn't|aren't|wasn't|doesn't|don't|never)\b[^.!?\n]{0,70}?[,.!?]\s+(?:it's|that's|they're|you're|it is|that is|this is)\b/gi;
export function contrastCount(text: string): number {
  const t = text.replace(/[’]/g, "'");
  // "if you're not logging, you're guessing" is a condition, not the contrast
  return [...t.matchAll(CONTRAST)].filter((m) => !/(?:^|[.!?\n])\s*if\b[^.!?\n]*$/i.test(t.slice(0, m.index))).length;
}

/** Talking down to the reader, not coaching them (a direct "stop doing X" about the training is a coach; these are about the person). */
const LECTURING = [
  /\bstop (being|pretending|making excuses)\b/i,
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
  // the new voice's own habits in its first test batch and rewrite
  "sneaks up",
  "funny how",
  "wild how",
  "crazy how",
  "the shift is",
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
/** Plain enough to read in one pass on a phone (a coach explaining, not a 5th-grade drill: his own example reads at 7.3). */
export const DAILY_GRADE_MAX = 8;
export const DAILY_SENTENCE_MAX = 24;
/**
 * Words lifters know: fine in a coach's post (the plain-words list still
 * catches study-speak like "participants" or "protocol").
 */
export const LIFTER_TERMS = ["hypertrophy", "eccentric", "concentric", "isometric", "velocity", "adaptation", "stimulus", "periodization", "rir", "1rm"] as const;
const DAILY_JARGON = Object.keys(JARGON).filter((j) => !(LIFTER_TERMS as readonly string[]).includes(j));

/**
 * Research said as fact in a daily post: the lessons carry studies with their
 * sources; a daily post is coaching, so it never cites research or a
 * statistic it can't show.
 */
const RESEARCH = /\b(stud(?:y|ies)|research(?:ers)?|scientists?|science (?:says|shows)|evidence (?:says|shows)|data (?:says|shows)|journal|meta-?analys[ie]s|statistic\w*|proven)\b|\d\s?%|\bpercent\b/i;

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
  o: { format: DailyFormat; pillar?: DailyPillar; recent?: string[]; near?: string[]; asked?: boolean; picture?: string; names?: readonly string[] },
): string[] {
  const out: string[] = [];
  const f = DAILY_FORMATS[o.format] ?? DAILY_FORMATS.coach_note;
  const text = caption.trim();
  if (!text) return ["empty"];
  if (text.length > f.max) out.push(`${text.length} characters (a ${f.name.toLowerCase()} is ${f.max} at most)`);
  if (wordsOf(text).length < DAILY_MIN_WORDS) out.push(`${wordsOf(text).length} words: too thin for a coaching point (about 40 to 100: the point, why, what to do)`);
  if (RESEARCH.test(text)) out.push("cites research or a statistic (daily posts are coaching; the lessons carry studies with their sources)");
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 5) out.push(`${paragraphs.length} paragraphs (5 at most)`);
  if (paragraphs.some((p) => p.split("\n").length > 1)) out.push("line breaks inside a paragraph (write sentences, not a poem of one-line lines)");
  const hook = hookOf(text);
  if (wordsOf(hook).length > HOOK_MAX_WORDS || hook.length > HOOK_MAX_CHARS) out.push(`the first sentence runs long (${wordsOf(hook).length} words): it's the hook, keep it short`);
  if ((text.match(EMOJI_RE) ?? []).length > 1) out.push("more than one emoji");
  if (/#\w/.test(text)) out.push("has a hashtag");
  if (/@\w/.test(text)) out.push("tags someone");
  if (NO_NAMES.test(text)) out.push("drops in a name");
  for (const n of namedPeople(text, o.names ?? [])) out.push(`names someone (${n})`);
  if (BIBLE_REF.test(text) || /\b(verse|scripture)\b/i.test(text)) out.push("mentions a verse (the app adds it)");
  const lower = ` ${text.toLowerCase().replace(/[’]/g, "'")} `;
  for (const g of GENERIC_PHRASES) if (lower.includes(g)) out.push(`says "${g}" (a slogan)`);
  for (const g of AI_TELLS) if (lower.includes(g)) out.push(`says "${g}" (reads like AI)`);
  for (const g of SCRIPTED_PHRASES) if (lower.includes(g)) out.push(`says "${g}" (scripted)`);
  for (const x of scriptedProblems(text)) out.push(x);
  if (LECTURING.some((re) => re.test(text))) out.push("lectures the reader");
  if (contrastCount(text) >= 2) out.push(`"it's not X, it's Y" ${contrastCount(text)} times (reads like AI)`);
  if (BODY_PUTDOWN.some((re) => re.test(text))) out.push("puts a body down");
  const lean = negativeLean(text);
  if (lean.negative >= 5 && lean.negative > lean.positive) out.push(`leans negative (${lean.negative} heavy words, ${lean.positive} light ones)`);
  if (o.asked && endsWithQuestion(text)) out.push("ends on a question again (the last two did)");
  const pic = letters(o.picture ?? "");
  if (pic.split(" ").length >= 4 && letters(text).includes(pic)) out.push("repeats the words in the picture");
  if (wordsOf(text).length >= 25 && readingGrade(text) > DAILY_GRADE_MAX) out.push(`hard to read (grade ${readingGrade(text)}, aim ${DAILY_GRADE_MAX} or under)`);
  if (longestSentence(text) > DAILY_SENTENCE_MAX) out.push(`a ${longestSentence(text)}-word sentence (${DAILY_SENTENCE_MAX} at most)`);
  for (const j of DAILY_JARGON) if (new RegExp(`[^\\p{L}]${j}s?[^\\p{L}]`, "iu").test(lower)) out.push(`"${j}" (say "${JARGON[j]}")`);
  const repeat = repeatsNearby(text, o.near ?? []);
  if (repeat) out.push(repeat);
  const close = (o.recent ?? []).find((r) => captionSimilarity(text, r) >= SIMILAR_MAX);
  if (close) out.push(`too close to a recent post ("${close.slice(0, 50)}…")`);
  for (const m of motifRepeats(text, o.recent ?? [])) out.push(`uses "${m}" like a recent post (find a new moment)`);
  // "leverages" is a lifting word (limb lengths); "leverage" the verb is on his never-say list
  const liftingLeverages = /\bleverages\b/i.test(text) && !/\bleverag(?:e|ed|ing)\b/i.test(text);
  for (const p of voiceProblems(text)) if (!out.includes(p) && !(liftingLeverages && p === 'says "leverage"')) out.push(p);
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
  direct: "focused and determined, serious intent in the faces",
  analytical: "concentrated, studying the detail that matters",
  dry_humour: "lightly funny, a wry moment readable in the faces",
  matter_of_fact: "an ordinary training moment, calm and competent",
  focused: "locked-in concentration before or during a lift",
  calm: "calm and restorative, still bright and colourful",
  curious: "engaged, a little 'aha' over the detail",
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
    "People are expressive, likeable, naturally proportioned adults with athletic builds that fit lifters, clean, sharp faces and clear, natural expressions, caught mid-moment, never posing or looking at the camera. The scene feels alive and inviting.",
    "Strength equipment is drawn correctly: a straight barbell with matching plates on both sides and collars, a real squat rack, bench or platform, the grip, stance and bar position that lift actually uses, chalk, belts and sleeves where they belong.",
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

export const REVIEW_PROMPT = `You review one daily post for a powerlifting coach's community feed before it goes out: a picture and its caption, made together for one training idea. The feed is for people serious about getting stronger, not a fitness motivation page. Be an honest editor at a good strength magazine. Look closely at the picture.

Answer with JSON only:
{
 "medium": "what the picture actually is: hand_drawn_2d (a hand-drawn, painted 2D animated-film frame), 3d_render (CGI, Pixar-like, plastic skin, volumetric 3D models), photo (a photograph or photorealistic), vector (flat clip art or a cheap vector illustration) or other",
 "description": "two sentences: what the picture shows and how it's drawn",
 "colour": "vibrant (rich, saturated, luminous colour with strong warm-versus-cool contrast), muted (desaturated, brown or grey grading, flat) or dark (dark, gloomy or low-contrast)",
 "clarity": "crisp (clean linework, sharp, well-drawn faces) or soft (blurry, smudged, grainy or painterly faces and lines)",
 "text_seen": "every word you can clearly read in the image, exactly as written, or empty",
 "defects": ["only clear mistakes anyone would notice at a glance, each one named"],
 "scores": {"relatable": 1-5, "original": 1-5, "writing": 1-5, "audience_fit": 1-5, "aesthetic": 1-5, "storytelling": 1-5, "match": 1-5, "engaging": 1-5, "uplift": 1-5, "on_topic": 1-5},
 "fix_image": "what would make the picture better, or empty",
 "fix_caption": "what would make the caption better, or empty"
}

DEFECTS are objective errors only: wrong or extra fingers or limbs, warped faces or bodies, melted or impossible objects, gym equipment drawn wrong (a bent or broken barbell, different plates on each side, a bar passing through a body or floating, an impossible grip or bar position for the lift), garbled, misspelled or extra text, a watermark or logo, obvious rendering artefacts, the subject or the words cut off at an edge. Taste is never a defect (a slightly stock look, the framing, the lighting, empty space, what could be clearer): score it and put it in fix_image or fix_caption.

SCORES: 5 = excellent, 4 = good enough to publish, 3 = needs work, 2 or 1 = poor. relatable = a lifter sees their own training in it; original = not a cliché or slogan; writing = reads like an elite powerlifting coach explaining something to an athlete (direct, precise, normal sentence case and punctuation, one real idea with why and what to do; motivational, scripted, preachy or AI-sounding is 3 or less; a joke that isn't actually funny is 3 or less); audience_fit = right for who it's for; aesthetic = bright, colourful and beautiful like a frame from a great hand-drawn 2D animated film, as striking as any style reference you were shown (not 3D, not a photo, not cheap vector, not childish, not dark or muddy); storytelling = the picture tells a story; match = the picture and caption tell the same story with the same details and add to each other, the caption not just repeating the words in the picture (any contradiction, like a text in the picture while the caption says they heard it, or another place, time or person, is 3 or less); engaging = worth a save, a comment or a send to a training partner; uplift = the picture leaves people keen to train or clearer about their training, never gloomy, shaming or heavy; on_topic = the picture is about strength training (a lift, a coach and lifter, a training log, the platform, recovery that belongs to training): a lifestyle scene with no training in it (a picnic, a beach, brunch, a party, a park) is 2 or less.`;

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
  scores: Record<"relatable" | "original" | "writing" | "audience_fit" | "aesthetic" | "storytelling" | "match" | "engaging" | "uplift" | "on_topic", number>;
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
        // and one from before the strength-training check
        on_topic: s.on_topic == null ? 4 : n(s.on_topic),
      },
      fix_image: typeof j.fix_image === "string" ? j.fix_image.trim() : "",
      fix_caption: typeof j.fix_caption === "string" ? j.fix_caption.trim() : "",
    };
  } catch {
    return null;
  }
}

/** Each score a post has to reach (the caption already passed the editor, so its bars here only catch a picture that changed its meaning). */
export const REVIEW_BARS: Review["scores"] = { relatable: 3, original: 3, writing: 4, audience_fit: 3, aesthetic: 4, storytelling: 3, match: 4, engaging: 3, uplift: 3, on_topic: 4 };
const IMAGE_SCORES = new Set<keyof Review["scores"]>(["aesthetic", "storytelling", "match", "uplift", "on_topic"]);

/**
 * Pass or fail, on concrete checks first: the words read off the picture are
 * exactly what was asked for (or none), no defects; then every score at its
 * bar (the picture has to be about strength training: `on_topic`). Says which
 * side failed, so only that side is made again.
 */
export function reviewVerdict(r: Review, typography: string, scene = "", _pillar?: DailyPillar | string | null): { pass: boolean; image: string[]; caption: string[] } {
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
    if (r.scores[k] >= REVIEW_BARS[k]) continue;
    (IMAGE_SCORES.has(k) ? image : caption).push(`${k} ${r.scores[k]}/5`);
  }
  if (image.length && r.fix_image) image.push(`fix: ${r.fix_image}`);
  if (caption.length && r.fix_caption) caption.push(`fix: ${r.fix_caption}`);
  return { pass: !image.length && !caption.length, image, caption };
}

/* ------------------------------------------------------------------ */
/*  A caption rewrite against the same picture                         */
/* ------------------------------------------------------------------ */

export const CAPTION_FIX_PROMPT = `You rewrite the caption of one daily post for the JF Effect community feed, as Jared, the powerlifting coach. The picture is already made and stays. Keep the post's point; fix only what the editor said, and make it plainer and more useful, never cleverer.

${VOICE_GUIDE}

Answer with JSON only: {"caption": "..."}`;

export function captionFixPrompt(o: { concept: Pick<DailyConcept, "message" | "situation" | "visual" | "format">; caption: string; fix: string[] }): string {
  const f = DAILY_FORMATS[o.concept.format] ?? DAILY_FORMATS.coach_note;
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

/** What goes out on one day of the coming week (`community_daily_visuals_overview().week`): null = the daily picture. */
export type CoachPostDay = { day: string; post: string | null };

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * The days the picture goes out this week, Monday first ("Fri, Sat and Sun"):
 * one coach post a day, so the picture takes only the days nothing else does
 * (`community_coach_post_day`; Sunday's always runs, it carries the verse).
 */
export function pictureDaysLabel(week: CoachPostDay[] | null | undefined): string | null {
  const days = [...new Set((week ?? []).filter((d) => d.post == null).map((d) => new Date(`${d.day}T12:00:00Z`).getUTCDay()))]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((n) => WEEKDAY_SHORT[n]);
  if (!days.length) return null;
  return days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
}
