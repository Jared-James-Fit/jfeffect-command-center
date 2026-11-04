/**
 * Daily pictures (series `daily_visual`): every morning a picture post that
 * speaks without saying much. Each day of the week has its own theme (courage
 * Monday … feelings & rest Sunday), the picture speaks to women one day and
 * men the next, and Sunday's carries a Bible verse (the weekly faith post).
 *
 * The words are one short line in the coach's voice, written by AI in the
 * background (daily-visuals.server.ts) and held to plainCheck; a verse is
 * only ever one of FAITH_VERSES, quoted word for word (KJV, public domain),
 * never written by a model. The picture comes from the image model
 * (post-pictures.server.ts generatePicture).
 *
 * It learns: every posted picture's likes, comments, saves and attention
 * (community_daily_visual_stats) feed `learnDailyVisuals`, which picks the
 * look (photo or drawing) and the length of the next one, mostly the one
 * that's doing better and sometimes the other so it keeps finding out, and
 * shows the writer what's worked and what hasn't.
 */
import { plainCheck, voiceProblems } from "@/lib/plain-words";

export type DailyTheme =
  | "courage"
  | "patience"
  | "your_circle"
  | "self_reflection"
  | "encouragement"
  | "self_love"
  | "emotional";
export type DailyAudience = "women" | "men";
export type DailyStyle = "photo" | "illustration";

type ThemeSpec = {
  /** ISO weekday: Monday = 1 … Sunday = 7. */
  dow: number;
  name: string;
  /** What the day is about, for the writer. */
  idea: string;
  /** Picture ideas to start from (the writer makes a fresh one), per who it speaks to. */
  shots: Record<DailyAudience, string[]>;
};

/** One theme a day, Monday first; Sunday's is the faith post. */
export const DAILY_THEMES: Record<DailyTheme, ThemeSpec> = {
  courage: {
    dow: 1,
    name: "Courage",
    idea: "doing the scary thing anyway: the first set, the first meet, walking into a new gym, starting before you feel ready",
    shots: {
      women: [
        "a woman chalking her hands beside a loaded barbell, seen from the side, calm and focused",
        "a woman standing at the edge of a still lake at sunrise, about to step into the cold water, seen from behind",
        "a woman walking up to a loaded barbell on a quiet lifting platform, seen from behind",
      ],
      men: [
        "a man at the bottom of a long, steep stone staircase at dawn, seen from behind",
        "a man's chalked hands gripping a loaded barbell, chalk dust in the morning light",
        "a man standing on a rock above the sea at sunrise, looking out, seen from behind",
      ],
    },
  },
  patience: {
    dow: 2,
    name: "Patience",
    idea: "progress is slow and that's normal, trusting the process, staying calm while you wait for results",
    shots: {
      women: [
        "a woman watering a small green plant on a sunny windowsill, side view",
        "a woman waiting by a coffee pour-over in soft morning light, side view",
        "a woman stretching slowly on a mat in a quiet, sunlit room",
      ],
      men: [
        "a man's hands in rich soil planting a seedling in a small garden, morning light",
        "a man sitting on a wooden dock with a fishing rod at sunrise, seen from behind",
        "a man resting between sets on a bench in an empty gym, side view, soft window light",
      ],
    },
  },
  your_circle: {
    dow: 3,
    name: "Your circle",
    idea: "the people around you: training partners, friends who push you, being that person for someone else",
    shots: {
      women: [
        "two women laughing together on a gym floor after a workout, seen from the side",
        "a group of friends walking a forest trail together at golden hour, seen from behind",
        "one woman's hand helping another woman up off a gym floor",
      ],
      men: [
        "two men bumping fists after a heavy set, seen from the side",
        "a training partner's hands hovering under a bench press bar, spotting",
        "a group of friends around a campfire at dusk, seen from behind",
      ],
    },
  },
  self_reflection: {
    dow: 4,
    name: "Self reflection",
    idea: "looking back honestly: what's working, what isn't, who you're becoming, writing it down",
    shots: {
      women: [
        "a woman writing in a journal by a bright window, side profile",
        "a woman looking out of a train window, her reflection soft in the glass",
        "a woman sitting on a beach at sunrise hugging her knees, seen from behind",
      ],
      men: [
        "a man writing in a training journal on a gym bench, over-the-shoulder view, the pages blurred",
        "a man sitting on a hilltop at sunrise looking over a valley, seen from behind",
        "a man's reflection in a perfectly still lake at dawn",
      ],
    },
  },
  encouragement: {
    dow: 5,
    name: "Encouragement",
    idea: "you're doing better than you think, keep going, finish the week strong, be proud of showing up",
    shots: {
      women: [
        "a woman finishing a morning run, arms up at the top of a hill, seen from behind",
        "a friend's hand on a woman's shoulder after a hard set, both seen from the side",
        "a woman tying her running shoes on a porch step at sunrise",
      ],
      men: [
        "a man reaching the top of a long hill climb at sunrise, seen from behind",
        "a coach's hand on an athlete's shoulder after a set, seen from the side",
        "a man lacing his lifting shoes on a gym bench in early light",
      ],
    },
  },
  self_love: {
    dow: 6,
    name: "Self love",
    idea: "treat yourself like someone you care about: rest, good food, kind self-talk, your body is on your side",
    shots: {
      women: [
        "a woman's hands making a colourful, healthy breakfast bowl in a sunny kitchen",
        "a woman wrapped in a soft blanket with a cup of tea by a bright window, seen from the side",
        "a woman on a yoga mat with her eyes closed, smiling, side view, morning light",
      ],
      men: [
        "a man cooking a good meal in a bright kitchen, side view",
        "a man stretching after a workout in soft morning light, seen from the side",
        "a man reading on a sunny balcony with a coffee, seen from behind",
      ],
    },
  },
  emotional: {
    dow: 7,
    name: "Feelings & rest",
    idea: "it's ok not to be ok, feelings are allowed, rest and reset for the week, peace",
    shots: {
      women: [
        "a woman sitting quietly on a wooden bench in a sunlit field, seen from behind",
        "a woman's hands around a warm mug beside a closed old Bible on a wooden table, morning light",
        "a woman walking alone on a calm beach at sunrise",
      ],
      men: [
        "a man sitting in an empty, sunlit chapel pew, seen from behind",
        "a man's hands resting on a closed old Bible next to a morning coffee on a wooden table",
        "a man sitting on a mountain top at sunrise, quiet and still, seen from behind",
      ],
    },
  },
};

export const DAILY_THEME_KEYS = Object.keys(DAILY_THEMES) as DailyTheme[];

/** The theme for an ISO weekday (Monday = 1). */
export function themeForDow(dow: number): DailyTheme {
  return DAILY_THEME_KEYS.find((k) => DAILY_THEMES[k].dow === dow) ?? "encouragement";
}

/** Who a day's picture speaks to: women and men turn about, so each weekday swaps every week. */
export function audienceForDay(day: string): DailyAudience {
  const days = Math.round(
    (Date.parse(`${day}T12:00:00Z`) - Date.parse("2026-01-05T12:00:00Z")) / 86_400_000,
  );
  return ((days % 2) + 2) % 2 === 0 ? "men" : "women";
}

/** A Bible verse for the weekly faith post: the King James words exactly (public domain), never a model's. */
export type FaithVerse = { ref: string; text: string };

export const FAITH_VERSES: FaithVerse[] = [
  { ref: "Psalm 46:10", text: "Be still, and know that I am God" },
  {
    ref: "Matthew 11:28",
    text: "Come unto me, all ye that labour and are heavy laden, and I will give you rest.",
  },
  { ref: "Psalm 30:5", text: "weeping may endure for a night, but joy cometh in the morning." },
  { ref: "Psalm 34:18", text: "The LORD is nigh unto them that are of a broken heart" },
  { ref: "1 Peter 5:7", text: "Casting all your care upon him; for he careth for you." },
  { ref: "Lamentations 3:22-23", text: "his compassions fail not. They are new every morning" },
  { ref: "Isaiah 40:31", text: "they that wait upon the LORD shall renew their strength" },
  { ref: "Joshua 1:9", text: "Be strong and of a good courage; be not afraid" },
  { ref: "Psalm 139:14", text: "I am fearfully and wonderfully made" },
  {
    ref: "Galatians 6:9",
    text: "let us not be weary in well doing: for in due season we shall reap, if we faint not.",
  },
  {
    ref: "Proverbs 27:17",
    text: "Iron sharpeneth iron; so a man sharpeneth the countenance of his friend.",
  },
  {
    ref: "Psalm 118:24",
    text: "This is the day which the LORD hath made; we will rejoice and be glad in it.",
  },
  {
    ref: "Matthew 6:34",
    text: "Take therefore no thought for the morrow: for the morrow shall take thought for the things of itself.",
  },
  { ref: "Psalm 23:1", text: "The LORD is my shepherd; I shall not want." },
  { ref: "Proverbs 24:16", text: "For a just man falleth seven times, and riseth up again" },
  {
    ref: "2 Timothy 1:7",
    text: "For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.",
  },
];

/** The verse used least recently (never one of the last `recent`), so a quarter of a year goes by before one repeats. */
export function pickVerse(used: string[]): FaithVerse {
  const last = new Map<string, number>();
  used.forEach((ref, i) => last.set(ref, i));
  const never = FAITH_VERSES.filter((v) => !last.has(v.ref));
  if (never.length) return never[0];
  return [...FAITH_VERSES].sort((a, b) => (last.get(a.ref) ?? -1) - (last.get(b.ref) ?? -1))[0];
}

/** The post's words: his line, and on Sunday the verse under it with where it's from. */
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
  style: DailyStyle;
  line: string;
  shot?: string | null;
  viewers: number;
  likers: number;
  commenters: number;
  savers: number;
  reached: number;
  stopped: number;
  median_ms: number | null;
};

/** Short lines stop at this; a long one may run to LONG_LINE_MAX when the crew stays for it. */
export const SHORT_LINE_MAX = 70;
export const LONG_LINE_MAX = 150;
/** How often it tries the length that isn't winning, so it keeps learning. */
export const EXPLORE_SHARE = 0.25;
/** How often it tries the look that isn't winning (a drawing, to start: the coach asked for clean photos first). */
export const DRAWING_SHARE = 0.15;
/** Below this many posts on each side the numbers are a guess, so it keeps the default. */
export const LEARN_MIN_POSTS = 3;

/** How well one picture did: reactions per person who saw it (comments and saves count more), plus how many stopped on it. */
export function visualScore(s: VisualStat): number {
  const seen = Math.max(s.viewers, s.likers, 1);
  const points = s.likers + 3 * s.commenters + 4 * s.savers;
  const hold = s.reached >= 3 ? s.stopped / s.reached : 0.5;
  // smoothed toward one reaction in three views, so a single like on two views isn't a landslide
  return (points + 0.33 * 3) / (seen + 3) + 0.5 * hold;
}

type Arm = { n: number; mean: number };
const arm = (xs: VisualStat[]): Arm => ({
  n: xs.length,
  mean: xs.length ? xs.reduce((t, s) => t + visualScore(s), 0) / xs.length : 0,
});

export type DailyLearnings = {
  posts: number;
  style: Record<DailyStyle, Arm>;
  length: { short: Arm; long: Arm };
  audience: Record<DailyAudience, Arm>;
  theme: Partial<Record<DailyTheme, Arm>>;
  best: VisualStat[];
  worst: VisualStat[];
};

export function learnDailyVisuals(stats: VisualStat[]): DailyLearnings {
  const by = <K extends string>(key: (s: VisualStat) => K, keys: readonly K[]) =>
    Object.fromEntries(keys.map((k) => [k, arm(stats.filter((s) => key(s) === k))])) as Record<
      K,
      Arm
    >;
  const ranked = [...stats].sort((a, b) => visualScore(b) - visualScore(a));
  return {
    posts: stats.length,
    style: by((s) => s.style, ["photo", "illustration"] as const),
    length: {
      short: arm(stats.filter((s) => s.line.length <= SHORT_LINE_MAX)),
      long: arm(stats.filter((s) => s.line.length > SHORT_LINE_MAX)),
    },
    audience: by((s) => s.audience, ["women", "men"] as const),
    theme: by((s) => s.theme, DAILY_THEME_KEYS),
    best: ranked.slice(0, 3),
    worst: ranked.length > 5 ? ranked.slice(-2) : [],
  };
}

/** The winner of two, once both have enough posts to say; else the default. Sometimes (`explore`) the other one, on purpose. */
function choose<T>(
  a: { key: T; arm: Arm },
  b: { key: T; arm: Arm },
  fallback: T,
  rand: number,
  explore: number,
): { pick: T; why: string } {
  const known = a.arm.n >= LEARN_MIN_POSTS && b.arm.n >= LEARN_MIN_POSTS;
  const best = !known ? fallback : a.arm.mean >= b.arm.mean ? a.key : b.key;
  const other = best === a.key ? b.key : a.key;
  if (rand < explore) return { pick: other, why: "trying the other one" };
  return {
    pick: best,
    why: known ? "doing better so far" : "the default until there's enough to tell",
  };
}

/** The look and length of the next picture, from what's worked (rand: 0–1, injectable for tests). */
export function nextChoices(
  l: DailyLearnings,
  rand: () => number = Math.random,
): {
  style: DailyStyle;
  maxChars: number;
  why: { style: string; length: string };
} {
  // photos lead (the coach asked for clean photos first), drawings get tried and keep their place only if they earn it
  const style = choose(
    { key: "photo" as DailyStyle, arm: l.style.photo },
    { key: "illustration" as DailyStyle, arm: l.style.illustration },
    "photo",
    rand(),
    DRAWING_SHARE,
  );
  // short first: posts were reading too long; longer lines only while the crew stays for them
  const length = choose(
    { key: SHORT_LINE_MAX, arm: l.length.short },
    { key: LONG_LINE_MAX, arm: l.length.long },
    SHORT_LINE_MAX,
    rand(),
    EXPLORE_SHARE,
  );
  return {
    style: style.pick,
    maxChars: length.pick,
    why: { style: style.why, length: length.why },
  };
}

/** What's worked, in plain words, for the writer (and the coach's card). */
export function learningsText(l: DailyLearnings): string {
  if (l.posts < LEARN_MIN_POSTS)
    return "Not enough posted yet to tell what works. Keep it short, simple and real.";
  const pct = (a: Arm, b: Arm) => (b.mean > 0 ? Math.round(((a.mean - b.mean) / b.mean) * 100) : 0);
  const out: string[] = [];
  const { short, long } = l.length;
  if (short.n >= LEARN_MIN_POSTS && long.n >= LEARN_MIN_POSTS) {
    const d = pct(short, long);
    out.push(
      d >= 0
        ? `Short lines are doing ${d}% better than longer ones.`
        : `Longer lines are doing ${-d}% better than short ones.`,
    );
  }
  const { photo, illustration } = l.style;
  if (photo.n >= LEARN_MIN_POSTS && illustration.n >= LEARN_MIN_POSTS) {
    const d = pct(photo, illustration);
    out.push(
      d >= 0
        ? `Photos are doing ${d}% better than drawings.`
        : `Drawings are doing ${-d}% better than photos.`,
    );
  }
  const themes = DAILY_THEME_KEYS.map((k) => ({ k, a: l.theme[k] })).filter(
    (t): t is { k: DailyTheme; a: Arm } => !!t.a && t.a.n >= 2,
  );
  if (themes.length >= 3) {
    themes.sort((a, b) => b.a.mean - a.a.mean);
    out.push(
      `Best themes so far: ${themes
        .slice(0, 2)
        .map((t) => DAILY_THEMES[t.k].name.toLowerCase())
        .join(", ")}.`,
    );
  }
  return out.length ? out.join(" ") : "Too close to call yet. Keep it short, simple and real.";
}

/* ------------------------------------------------------------------ */
/*  The writer and the picture                                         */
/* ------------------------------------------------------------------ */

export const DAILY_WRITER_PROMPT = `You write the words for a daily picture post in a strength coach's private community feed (his clients, all ages, men and women). The picture does the talking: your words are one short line that lands the feeling, like a caption a real person would post under a photo on Instagram.

RULES
1. One line, two at most. Say one thing. The first words are the point.
2. Plain words a 10 year old knows. No sentence over 12 words.
3. Sound like the coach texting his crew (his voice is below). Real, warm, a little blunt. Not a quote account, not a greeting card, not a therapist.
4. Never invent facts, studies, numbers, names or stories. No hashtags. No quotes from anyone. Never write a Bible verse or mention a verse yourself (the app adds the verse on Sundays).
5. An emoji only if it fits, one at most, from his list.
6. You may end with a tiny question that invites a reply ("who's yours?"), only if it's natural.
7. Don't repeat or closely echo any line in RECENT LINES, and vary it: don't open with the same word or end on the same emoji as the ones around it (no "honestly" every day, no 🤝 every day). Often no emoji at all is best.

Also write the PICTURE: one specific, calm scene that shows the theme without any words in it, with the person described in the brief (a woman or a man) seen from behind, from the side or as hands, never looking at the camera. Say the setting, the light, what they're doing and the mood in one or two sentences. Make it different from RECENT PICTURES.

Answer with JSON only: {"line": "...", "picture": "..."}`;

export function dailyWriterPrompt(o: {
  theme: DailyTheme;
  audience: DailyAudience;
  style: DailyStyle;
  maxChars: number;
  faith: boolean;
  learnings: string;
  best: string[];
  worst: string[];
  recentLines: string[];
  recentShots: string[];
}): string {
  const t = DAILY_THEMES[o.theme];
  return [
    `THEME: ${t.name}. ${t.idea}.`,
    `THE PICTURE SPEAKS TO: ${o.audience === "women" ? "women (the person in it is a woman)" : "men (the person in it is a man)"}. The words still work for anyone reading.`,
    o.faith
      ? "SUNDAY: a Bible verse goes under your line. Your line should sit well with a quiet, faith-filled verse about rest, hope or strength, without preaching."
      : null,
    `LOOK: ${o.style === "photo" ? "a real, clean photograph" : "a clean, minimal drawing"}.`,
    `LENGTH: ${o.maxChars} characters at most for the line.`,
    `IDEAS FOR THE PICTURE (make your own, don't copy): ${t.shots[o.audience].join(" | ")}`,
    `WHAT'S WORKED: ${o.learnings}`,
    o.best.length ? `LINES THE CREW LIKED MOST:\n${o.best.map((l) => `- ${l}`).join("\n")}` : null,
    o.worst.length ? `LINES THAT FELL FLAT:\n${o.worst.map((l) => `- ${l}`).join("\n")}` : null,
    o.recentLines.length
      ? `RECENT LINES (don't repeat):\n${o.recentLines.map((l) => `- ${l}`).join("\n")}`
      : null,
    o.recentShots.length
      ? `RECENT PICTURES (make yours different):\n${o.recentShots.map((l) => `- ${l}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The writer's JSON (it sometimes wraps it in a code fence). */
export function parseDailyWriter(text: string): { line: string; picture: string } | null {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const line = typeof j.line === "string" ? j.line.trim().replace(/^["“]|["”]$/g, "") : "";
    const picture = typeof j.picture === "string" ? j.picture.trim() : "";
    return line && picture ? { line, picture } : null;
  } catch {
    return null;
  }
}

const EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
const firstWord = (s: string) => s.trim().toLowerCase().match(/^[a-z']+/)?.[0] ?? "";
const lastEmoji = (s: string) => s.match(EMOJI_RE)?.pop() ?? "";

/**
 * A line that opens with the same word, or ends on the same emoji, as a day
 * near it reads like a template ("honestly … 🤝" three days running): what's
 * repeated, or null. `near` = the lines of the days around it.
 */
export function repeatsNearby(line: string, near: string[]): string | null {
  const w = firstWord(line);
  if (w && near.some((n) => firstWord(n) === w)) return `opens with "${w}" like a day near it`;
  const e = lastEmoji(line);
  if (e && near.some((n) => lastEmoji(n) === e)) return `ends on ${e} like a day near it`;
  return null;
}

/** What's wrong with a written line (empty = it can go out). The verse is the app's, so only his line is checked. */
export function dailyLineProblems(line: string, maxChars: number): string[] {
  const out: string[] = [];
  if (line.length > maxChars) out.push(`${line.length} characters (${maxChars} at most)`);
  if (line.split("\n").filter((l) => l.trim()).length > 2) out.push("more than two lines");
  if (/#\w/.test(line)) out.push("has a hashtag");
  if (/\b\d?\s?[A-Z][a-z]+ \d{1,3}:\d{1,3}\b/.test(line) || /\b(verse|scripture)\b/i.test(line))
    out.push("mentions a verse (the app adds it)");
  if (/["“”]/.test(line)) out.push("has a quote");
  for (const p of [...plainCheck(line).problems, ...voiceProblems(line)])
    if (!out.includes(p)) out.push(p);
  return [...new Set(out)];
}

/** How a daily picture looks: one clean, premium style per look, so the feed reads as one account. */
export const DAILY_LOOK: Record<DailyStyle, string> = {
  photo: [
    "A real editorial lifestyle photograph for a premium strength coach's Instagram, the kind that stops a scroll.",
    "Shot on a full-frame camera with a 50mm lens: soft natural light, true-to-life colours with a gentle warm film tone, crisp detail, shallow depth of field, clean and uncluttered with calm negative space.",
    "Bright and airy, never dark, moody, neon or over-edited. Not CGI, not an illustration, not a stock-photo pose.",
  ].join(" "),
  illustration: [
    "A clean, modern editorial illustration for a premium wellness brand: a few confident lines and simple shapes, a soft muted palette on warm off-white paper, subtle paper grain, elegant and calm.",
    "Not cartoonish, not clip art, not 3D, not a photo.",
  ].join(" "),
};

/** The image model's prompt for a day: the look, the person, the scene, the rules every picture keeps. */
export function dailyPicturePrompt(o: {
  theme: DailyTheme;
  audience: DailyAudience;
  style: DailyStyle;
  shot: string;
  faith: boolean;
}): string {
  const who =
    o.audience === "women"
      ? "The person is a woman in her twenties or thirties, fit and real, dressed simply."
      : "The person is a man in his twenties or thirties, fit and real, dressed simply.";
  return [
    DAILY_LOOK[o.style],
    `The feeling: ${DAILY_THEMES[o.theme].name.toLowerCase()} (${DAILY_THEMES[o.theme].idea}).`,
    `The scene: ${o.shot}`,
    who,
    "People are seen from behind, from the side or as hands, candid, never posing or looking at the camera, no close-up faces.",
    o.faith
      ? "Quiet and reverent, warm morning light; any Bible stays closed and no writing is visible."
      : null,
    "Vertical 4:5 portrait framing, the subject a little off centre with room above, nothing important near the edges.",
    "Absolutely no text, letters, numbers, signs, logos or watermarks anywhere in the image.",
  ]
    .filter(Boolean)
    .join(" ");
}
