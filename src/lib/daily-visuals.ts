/**
 * Daily pictures (series `daily_visual`): every morning a post that people
 * stop on because it says something true about their life, with a picture
 * that tells its own part of the story. Each day of the week has its own lens
 * (courage Monday … feelings & rest Sunday), the post speaks to women, men or
 * everyone in turn, and Sunday's carries a Bible verse (the weekly faith
 * post; the verse is only ever one of FAITH_VERSES, word for word).
 *
 * How one is made (daily-visuals.server.ts), concept first:
 *   1. the concept: who it's for, a topic, a specific situation and its
 *      tension, the one thing it says, the caption's form, the art style that
 *      tells it best and the picture (CONCEPT_PROMPT), then the caption;
 *   2. the caption is held to `captionProblems` (plain words, his voice, no
 *      clichés, nothing close to a recent post), with a rewrite when it fails;
 *   3. the picture (`picturePrompt`): always a still frame from a premium
 *      hand-drawn 2D animated film (FILM_LOOK, never 3D, a photo or vector
 *      clip art: FILM_AVOID), the variety in the moment, the shot
 *      (DAILY_STYLES) and the light (DAILY_LIGHTS); any words in the scene (a
 *      text on a phone, a note, a speech bubble) say exactly what the story
 *      needs, spelled exactly;
 *   4. a review that looks at the picture with the caption (REVIEW_PROMPT):
 *      `reviewVerdict` passes it only on concrete checks (it reads as a
 *      hand-drawn 2D frame, the text in it is exactly what was asked, no
 *      defects) and high enough scores
 *      for match, look, relatability and writing; a failed picture is made
 *      again with the review's fix, a failed caption rewritten.
 *
 * It learns: every posted picture's likes, comments, saves and attention
 * (community_daily_visual_stats) rank the styles, caption forms, topics and
 * lengths (`learnDailyVisuals`); `pickChoices` offers the next concept the
 * ones that are working, never the ones used in the last few days, and
 * sometimes one that hasn't had a chance yet.
 */
import { plainCheck, voiceProblems } from "@/lib/plain-words";

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
export type DailyFormat = "one_liner" | "observation" | "short_story" | "humor" | "scenario" | "encouragement";
export type DailyTopic =
  | "confidence"
  | "discipline"
  | "body_image"
  | "ambition"
  | "relationships"
  | "resilience"
  | "burnout"
  | "overwhelm"
  | "identity"
  | "small_wins"
  | "hard_truths"
  | "humor_shared";

/* ------------------------------------------------------------------ */
/*  The week                                                           */
/* ------------------------------------------------------------------ */

type ThemeSpec = {
  /** ISO weekday: Monday = 1 … Sunday = 7. */
  dow: number;
  name: string;
  /** The day's lens, for the concept. */
  idea: string;
  /** The topics that fit the day. */
  topics: DailyTopic[];
};

/** One lens a day, Monday first; Sunday's is the faith post. */
export const DAILY_THEMES: Record<DailyTheme, ThemeSpec> = {
  courage: { dow: 1, name: "Courage", idea: "doing the scary thing anyway, starting before you feel ready, wanting more for yourself", topics: ["confidence", "ambition", "identity", "hard_truths"] },
  patience: { dow: 2, name: "Patience", idea: "slow progress, showing up when it's boring, trusting what you can't see yet", topics: ["discipline", "resilience", "small_wins", "body_image"] },
  your_circle: { dow: 3, name: "Your circle", idea: "the people around you, who you train with, who you text, who you become around them", topics: ["relationships", "humor_shared", "confidence", "small_wins"] },
  self_reflection: { dow: 4, name: "Self reflection", idea: "looking at yourself honestly, who you're becoming, the truth you've been avoiding", topics: ["identity", "hard_truths", "ambition", "burnout"] },
  encouragement: { dow: 5, name: "Encouragement", idea: "the end of the week, the wins nobody claps for, getting through it", topics: ["small_wins", "humor_shared", "resilience", "discipline"] },
  self_love: { dow: 6, name: "Self love", idea: "how you treat yourself, your body on a bad mirror day, rest without guilt", topics: ["body_image", "confidence", "burnout", "relationships"] },
  emotional: { dow: 7, name: "Feelings & rest", idea: "when it's heavy, when you're tired of being strong, peace and a reset for the week", topics: ["overwhelm", "burnout", "resilience", "identity"] },
};

export const DAILY_THEME_KEYS = Object.keys(DAILY_THEMES) as DailyTheme[];

export function themeForDow(dow: number): DailyTheme {
  return DAILY_THEME_KEYS.find((k) => DAILY_THEMES[k].dow === dow) ?? "encouragement";
}

/** Who a day's post is for: women, men, then everyone, so each weekday turns over every week. */
export function audienceForDay(day: string): DailyAudience {
  const days = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse("2026-01-05T12:00:00Z")) / 86_400_000);
  return (["women", "men", "everyone"] as const)[((days % 3) + 3) % 3];
}

export const DAILY_TOPICS: Record<DailyTopic, string> = {
  confidence: "confidence and self-worth",
  discipline: "discipline and consistency",
  body_image: "body image and fitness struggles (the mirror, photos, clothes, the scale, comparing)",
  ambition: "ambition and personal growth",
  relationships: "relationships and everyday life",
  resilience: "mental resilience",
  burnout: "stress and burnout",
  overwhelm: "feeling overwhelmed",
  identity: "building a stronger identity, who you're becoming",
  small_wins: "celebrating small victories nobody else notices",
  hard_truths: "an uncomfortable but relatable truth",
  humor_shared: "humour and shared gym and life experiences",
};

export const DAILY_AUDIENCE_GUIDE: Record<DailyAudience, string> = {
  women:
    "Women in the crew. Their real lives: confidence, strength, independence, growth, relationships, the pressure of everything at once. Not every post is self-love, and nothing about how she should look.",
  men: "Men in the crew. Their real lives: purpose, responsibility, standards, confidence, resilience, being honest when it's hard. Not every post is grind harder, and nothing macho or preachy.",
  everyone: "Everyone in the crew: a moment anyone sees themselves in.",
};

/** How a caption is told, with its length (characters). */
export const DAILY_FORMATS: Record<DailyFormat, { name: string; guide: string; min: number; max: number }> = {
  one_liner: { name: "One line", guide: "one or two powerful sentences that land it", min: 20, max: 130 },
  observation: { name: "Observation", guide: "a sharp, true observation or a new way to see it, in 2 to 4 short lines", min: 60, max: 280 },
  short_story: {
    name: "Short story",
    guide: "a tiny, real-feeling moment told in 3 to 6 short lines, then the turn that makes it land. Told to 'you' or about 'someone', never a real named person",
    min: 140,
    max: 460,
  },
  humor: { name: "Humour", guide: "a relatable, funny take people tag a friend in, 1 to 4 short lines, the laugh first", min: 30, max: 240 },
  scenario: { name: "Relatable moment", guide: "a specific everyday situation they'll recognise ('you know when…'), then what it really means", min: 80, max: 340 },
  encouragement: { name: "Encouragement", guide: "talking straight to the person reading, warm and specific to the situation, never generic, in 2 to 5 short lines", min: 70, max: 380 },
};
export const DAILY_FORMAT_KEYS = Object.keys(DAILY_FORMATS) as DailyFormat[];

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
export const FILM_LOOK_VERSION = "film_v2";

export const FILM_LOOK =
  "A frame from a premium, colourful, hand-drawn 2D animated feature film. Crisp, confident, clean linework; refined cel shading with clean, crisp shadow shapes; rich, vibrant, saturated colour with strong warm-versus-cool contrast; bright, luminous light with glowing highlights; a detailed, beautifully illustrated background with depth; expressive, attractive, naturally proportioned adult characters with clean, sharp, well-drawn faces and clear expressions; a clear focal point and a strong, intentional composition. Polished, bright and striking, made to stop someone scrolling.";

export const ART_STYLES: Record<DailyArt, { name: string; look: string; use: string }> = {
  graphic: {
    name: "A · Vibrant graphic 2D",
    look: "Art direction A, vibrant graphic 2D animation: bold colour blocking, punchy complementary colours, dynamic dramatic lighting, crisp ink outlines, energetic camera angles and motion.",
    use: "fitness, ambition, confidence, discipline, humour and exciting everyday moments",
  },
  anime: {
    name: "B · Cinematic 2D anime",
    look: "Art direction B, beautiful cinematic 2D anime: a luminous sky and glowing light (sunsets, golden hour, bright city light), refined cel shading, soft glowing rim light on the characters, richly detailed environments, expressive faces with natural proportions.",
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

/** Below this many posts a style, form or topic is still a guess. */
export const LEARN_MIN_POSTS = 3;
/** How often the next post is offered something that hasn't proven itself yet, so it keeps finding out. */
export const EXPLORE_SHARE = 0.25;
/** A caption past this is "long" for the learning (several short paragraphs). */
export const LONG_CAPTION = 160;

/** How well one did: reactions per person who saw it (comments and saves count more), plus how many stopped on it. */
export function visualScore(s: VisualStat): number {
  const seen = Math.max(s.viewers, s.likers, 1);
  const points = s.likers + 3 * s.commenters + 4 * s.savers;
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
  style: Record<DailyStyle, Arm>;
  format: Record<DailyFormat, Arm>;
  topic: Record<DailyTopic, Arm>;
  audience: Record<DailyAudience, Arm>;
  length: { short: Arm; long: Arm };
  best: VisualStat[];
  worst: VisualStat[];
};

export function learnDailyVisuals(stats: VisualStat[]): DailyLearnings {
  const ranked = [...stats].sort((a, b) => visualScore(b) - visualScore(a));
  return {
    posts: stats.length,
    style: arms(stats, (s) => s.style, DAILY_STYLE_KEYS),
    format: arms(stats, (s) => s.format, DAILY_FORMAT_KEYS),
    topic: arms(stats, (s) => s.topic, Object.keys(DAILY_TOPICS) as DailyTopic[]),
    audience: arms(stats, (s) => s.audience, ["women", "men", "everyone"] as const),
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

export type Recent = { day: string; style?: string | null; light?: string | null; format?: string | null; topic?: string | null; caption?: string | null };

export type Choices = { styles: DailyStyle[]; lights: DailyLight[]; formats: DailyFormat[]; topics: DailyTopic[] };

/** What the next concept may use: shots, light, forms and topics not used in the last few days, best first. */
export function pickChoices(l: DailyLearnings, theme: DailyTheme, recent: Recent[], rand: () => number = Math.random, forcedStyle?: DailyStyle | null): Choices {
  const last = (n: number, f: (r: Recent) => string | null | undefined) => new Set(recent.slice(-n).map(f).filter(Boolean) as string[]);
  const usedStyles = last(4, (r) => r.style);
  const usedLights = last(3, (r) => r.light);
  const usedFormats = last(2, (r) => r.format);
  const usedTopics = last(10, (r) => r.topic);
  const styles = forcedStyle ? [forcedStyle] : rank(DAILY_STYLE_KEYS.filter((s) => !usedStyles.has(s)), l.style, rand());
  const spin = Math.floor(rand() * DAILY_LIGHT_KEYS.length);
  const lights = DAILY_LIGHT_KEYS.filter((k) => !usedLights.has(k)).map((k, i, a) => a[(i + spin) % a.length]);
  const formats = rank(DAILY_FORMAT_KEYS.filter((f) => !usedFormats.has(f)), l.format, rand());
  const dayTopics = DAILY_THEMES[theme].topics;
  const fresh = dayTopics.filter((t) => !usedTopics.has(t));
  const topics = rank(fresh.length ? fresh : dayTopics, l.topic, rand());
  return { styles, lights, formats, topics };
}

/** What's worked, in plain words, for the concept and the coach's card. */
export function learningsText(l: DailyLearnings): string {
  if (l.posts < LEARN_MIN_POSTS) return "Not enough posted yet to tell what works. Trying a range of shots and forms.";
  const best = <K extends string>(a: Record<K, Arm>, name: (k: K) => string) =>
    (Object.keys(a) as K[])
      .filter((k) => a[k].n >= 2)
      .sort((x, y) => a[y].mean - a[x].mean)
      .slice(0, 2)
      .map(name);
  const out: string[] = [];
  const styles = best(l.style, (k) => DAILY_STYLES[k as DailyStyle].name.toLowerCase());
  if (styles.length) out.push(`Best shots so far: ${styles.join(", ")}.`);
  const formats = best(l.format, (k) => DAILY_FORMATS[k as DailyFormat].name.toLowerCase());
  if (formats.length) out.push(`Best caption forms: ${formats.join(", ")}.`);
  const topics = best(l.topic, (k) => DAILY_TOPICS[k as DailyTopic].split(" (")[0]);
  if (topics.length) out.push(`Topics landing: ${topics.join(", ")}.`);
  const { short, long } = l.length;
  if (short.n >= LEARN_MIN_POSTS && long.n >= LEARN_MIN_POSTS)
    out.push(long.mean > short.mean ? "Longer captions are keeping people longer." : "Shorter captions are doing better.");
  return out.length ? out.join(" ") : "Too close to call yet. Still trying a range of shots and forms.";
}

/* ------------------------------------------------------------------ */
/*  The concept and the caption                                        */
/* ------------------------------------------------------------------ */

export type DailyConcept = {
  topic: DailyTopic;
  situation: string;
  tension: string;
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
  caption: string;
};

export const CONCEPT_PROMPT = `You create one daily post for a strength coach's private community feed: his clients, men and women of all ages who train with him. It's a picture with a caption. It should feel intentionally made by someone who gets their life, never auto-filled. People should think "that's literally me", "I needed that", "I never thought of it that way" or "I'm sending this to someone".

WORK IT OUT IN THIS ORDER, then answer:
1. Audience: who it's for (given).
2. Topic: pick one from the list given.
3. Situation: one specific, everyday moment with real tension in it (the car before the gym, the photo you untagged yourself from, the Sunday scaries, the friend who asks why you even bother). Specific beats general.
4. Message: the one thing it says, in your own words. Something true, maybe a little uncomfortable, never a slogan.
5. Picture: the moment as a frame from a premium, colourful, hand-drawn 2D animated film (the look is fixed; you choose the moment, the art direction, the shot and the colour and light). It shows the moment the caption is about, so the two tell the same story with the same details (if the caption says a friend texted, the picture shows that text; the same place, time and people, never another version of events), and adds what words can't (the room, the people, the small detail that says how they feel).
6. Caption: in the form given, in the coach's voice (below).

WRITING RULES
- The first line shows alone under the picture, so it has to earn the tap: the moment, the tension or the laugh, never a warm-up.
- Plain words a 10 year old knows, no sentence over 14 words. Lowercase like his texts.
- Real and warm, sometimes funny, sometimes a little blunt. No empty motivation, no slogans, no clichés ("trust the process", "you got this", "keep going", "no excuses", "level up", "best version of yourself"), no hashtags, no quotation marks, no forced slang. At most one emoji, often none.
- Never invent facts, studies, numbers, names or real people. A small made-up moment told to "you" is fine.
- Never write or mention a Bible verse (the app adds one on Sundays).
- Don't echo anything in RECENT POSTS: not the topic angle, the situation, the message, the opening or the picture. Never lean on the stock moments (nobody clapping, the quiet win, the group chat, Friday night, a full sink, the couch): find a fresh, specific one.
- A humour post is actually funny: a true, slightly absurd detail, a comparison or a twist people laugh at and tag a friend in. Earnest isn't humour.

PICTURE RULES
- Describe the frame: who is in it (adults, their age range, build, hair and clothes, people of different looks, fitting the audience and an everyday gym and life), what they're doing and feeling, where they are, what's around them.
- Natural human moments full of life: training, laughing, connecting, moving, a small win, a funny moment. Bright, colourful and eye-catching (daytime, golden hour, vivid light); a night or quiet moment only when the story needs one, and then with vivid colour and one bright focal light.
- When the caption is about a struggle, the picture shows the turn or the human side of it (walking in anyway, the friend who showed up, the laugh after), never someone miserable alone in a dark room or staring at a phone.
- Never a poster, a pose or someone looking at the camera, and never a scene like one in RECENT POSTS.
- Any words in the scene (a text message on a phone, a note, a speech bubble, a sign) say exactly what the story needs and are written word for word in "typography" (at most 12 words): only the words as they appear in the frame, never where they are or who's reading them (write "boss: quick thing for monday?", never "on his phone: boss: quick thing for monday?"). No other words anywhere. With no words in the scene, "typography" is "".

Answer with JSON only:
{"topic": "...", "situation": "...", "tension": "...", "message": "...", "format": "...", "art": "graphic or anime", "style": "the shot", "light": "...", "visual": "...", "typography": "...", "caption": "..."}`;

export function conceptPrompt(o: {
  theme: DailyTheme;
  audience: DailyAudience;
  faith: boolean;
  choices: Choices;
  learnings: string;
  best: string[];
  worst: string[];
  recent: Recent[];
  /** Captions the coach threw out: never write like these. */
  rejected?: string[];
  /** A remake of one side only: the caption to keep exactly, or the picture already made (its description). */
  keep?: { caption?: string; picture?: string; style?: DailyStyle } | null;
  /** The art direction to use (a test or the coach's pick), else the writer picks. */
  art?: DailyArt | null;
}): string {
  const t = DAILY_THEMES[o.theme];
  return [
    `TODAY'S LENS: ${t.name}. ${t.idea}.`,
    `AUDIENCE: ${DAILY_AUDIENCE_GUIDE[o.audience]}`,
    o.faith ? "SUNDAY: a Bible verse goes under the caption. Make it sit well under a quiet verse about rest, hope or strength, without preaching." : null,
    `TOPICS (pick one, best first): ${o.choices.topics.map((k) => `${k} = ${DAILY_TOPICS[k]}`).join("; ")}`,
    `CAPTION FORMS (pick one, best first): ${o.choices.formats.map((k) => `${k} = ${DAILY_FORMATS[k].guide} (${DAILY_FORMATS[k].min}-${DAILY_FORMATS[k].max} characters)`).join("; ")}`,
    `SHOTS, as "style" (pick the one that tells this story best, best performers first): ${o.choices.styles.map((k) => `${k} = ${DAILY_STYLES[k].look}`).join("; ")}`,
    `COLOUR AND LIGHT, as "light" (pick the one that fits the moment): ${o.choices.lights.map((k) => `${k} = ${DAILY_LIGHTS[k].look}`).join("; ")}`,
    o.art
      ? `ART DIRECTION, as "art": ${o.art} (${ART_STYLES[o.art].name})`
      : `ART DIRECTION, as "art" (pick the one that tells this story best): ${DAILY_ART_KEYS.map((k) => `${k} = ${ART_STYLES[k].name}, for ${ART_STYLES[k].use}`).join("; ")}`,
    o.keep?.caption ? `KEEP THIS CAPTION EXACTLY, word for word, as "caption" (only plan a new picture for it): ${o.keep.caption}` : null,
    o.keep?.picture
      ? `KEEP THIS PICTURE (it's already made${o.keep.style ? `, ${DAILY_STYLES[o.keep.style].name.toLowerCase()}` : ""}): ${o.keep.picture}\nPlan the post around it and write a new caption for it. Describe it as it is in "visual"; "typography" is "".`
      : null,
    `WHAT'S WORKED WITH THIS CREW: ${o.learnings}`,
    o.best.length ? `POSTS THEY LIKED MOST:\n${o.best.map((l) => `- ${l}`).join("\n")}` : null,
    o.worst.length ? `POSTS THAT FELL FLAT:\n${o.worst.map((l) => `- ${l}`).join("\n")}` : null,
    o.rejected?.length ? `THE COACH THREW THESE OUT (never write like them):\n${o.rejected.map((l) => `- ${l.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}` : null,
    o.recent.length
      ? `RECENT POSTS (make yours different in every way):\n${o.recent
          .slice(-14)
          .map((r) => `- ${r.day} · ${r.topic ?? "?"} · ${r.format ?? "?"} · ${r.style ?? "?"}${r.light ? ` · ${r.light}` : ""}: ${(r.caption ?? "").replace(/\s+/g, " ").slice(0, 160)}`)
          .join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const isKey = <K extends string>(keys: readonly K[], v: unknown): v is K => typeof v === "string" && (keys as readonly string[]).includes(v);

/** The concept's JSON (fenced or not), with its choices held to the lists. */
/** The art direction a topic leans to when the writer doesn't pick one. */
export function artForTopic(topic: DailyTopic): DailyArt {
  return ["relationships", "body_image", "identity", "burnout", "overwhelm", "hard_truths"].includes(topic) ? "anime" : "graphic";
}

export function parseConcept(text: string, allowed: Omit<Choices, "lights"> & { lights?: DailyLight[]; art?: DailyArt | null }): DailyConcept | null {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const c: DailyConcept = {
      topic: isKey(allowed.topics, j.topic) ? j.topic : allowed.topics[0],
      situation: str(j.situation, 500),
      tension: str(j.tension, 300),
      message: str(j.message, 300),
      format: isKey(allowed.formats, j.format) ? j.format : allowed.formats[0],
      style: isKey(allowed.styles, j.style) ? j.style : allowed.styles[0],
      light: isKey(DAILY_LIGHT_KEYS, j.light) ? j.light : (allowed.lights?.[0] ?? "golden_teal"),
      art: allowed.art ?? (isKey(DAILY_ART_KEYS, j.art) ? j.art : artForTopic(isKey(allowed.topics, j.topic) ? j.topic : allowed.topics[0])),
      visual: str(j.visual, 1400),
      typography: str(j.typography, 100).replace(/^["“]|["”]$/g, ""),
      caption: str(j.caption, 600).replace(/^["“]|["”]$/g, ""),
    };
    return c.caption && c.visual && c.message ? c : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Checks                                                             */
/* ------------------------------------------------------------------ */

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
  "small steps",
  "every day is a new",
  "you are stronger than you think",
  "finish strong",
] as const;

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
  const w = s.toLowerCase().replace(EMOJI_RE, " ").match(/[a-z']+/g) ?? [];
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

/** What's wrong with a caption (empty = it can go out). `recent` = earlier posts' captions, `near` = the days around it. */
export function captionProblems(caption: string, o: { format: DailyFormat; recent?: string[]; near?: string[] }): string[] {
  const out: string[] = [];
  const f = DAILY_FORMATS[o.format];
  if (caption.length > f.max) out.push(`${caption.length} characters (a ${f.name.toLowerCase()} is ${f.max} at most)`);
  if (caption.length < f.min) out.push(`${caption.length} characters (a ${f.name.toLowerCase()} needs ${f.min} or more)`);
  if (caption.split("\n").filter((l) => l.trim()).length > 8) out.push("more than 8 lines");
  if ((caption.match(EMOJI_RE) ?? []).length > 1) out.push("more than one emoji");
  if (/#\w/.test(caption)) out.push("has a hashtag");
  if (/@\w/.test(caption)) out.push("tags someone");
  if (/["“”]/.test(caption)) out.push("has quotation marks");
  if (BIBLE_REF.test(caption) || /\b(verse|scripture)\b/i.test(caption)) out.push("mentions a verse (the app adds it)");
  const lower = ` ${caption.toLowerCase()} `;
  for (const g of GENERIC_PHRASES) if (lower.includes(g)) out.push(`says "${g}" (a slogan)`);
  const near = o.near ?? [];
  const repeat = repeatsNearby(caption, near);
  if (repeat) out.push(repeat);
  const close = (o.recent ?? []).find((r) => captionSimilarity(caption, r) >= SIMILAR_MAX);
  if (close) out.push(`too close to a recent post ("${close.slice(0, 50)}…")`);
  for (const m of motifRepeats(caption, o.recent ?? [])) out.push(`uses "${m}" like a recent post (find a new moment)`);
  for (const p of [...plainCheck(caption).problems, ...voiceProblems(caption)]) if (!out.includes(p)) out.push(p);
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

/** The image model's prompt: the look and art direction, the shot, the colour and light, the moment, the words in it (exactly) or none, and what it must never look like. */
export function picturePrompt(
  c: Pick<DailyConcept, "style" | "visual" | "typography" | "message"> & { light?: DailyLight | string | null; art?: DailyArt | string | null },
  o: { faith?: boolean; fix?: string | null; reference?: boolean } = {},
): string {
  const shot = DAILY_STYLES[c.style as DailyStyle] ?? DAILY_STYLES.medium_candid;
  const light = c.light && c.light in DAILY_LIGHTS ? DAILY_LIGHTS[c.light as DailyLight] : null;
  const art = ART_STYLES[(c.art && c.art in ART_STYLES ? c.art : "graphic") as DailyArt];
  const words = c.typography.trim();
  return [
    o.reference ? STYLE_REFERENCE : null,
    FILM_LOOK,
    art.look,
    `The shot: ${shot.look}`,
    light ? `Colour and light: ${light.look}.` : null,
    `What happens in the frame: ${c.visual}`,
    `The feeling: ${c.message}`,
    "People are attractive, naturally proportioned adults with clean, sharp faces and clear, natural expressions, caught mid-moment, never posing or looking at the camera.",
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

export const REVIEW_PROMPT = `You review one daily post for a strength coach's community feed before it goes out: a picture and its caption, made for a planned message. Be an honest editor at a good magazine. Look closely at the picture.

Answer with JSON only:
{
 "medium": "what the picture actually is: hand_drawn_2d (a hand-drawn, painted 2D animated-film frame), 3d_render (CGI, Pixar-like, plastic skin, volumetric 3D models), photo (a photograph or photorealistic), vector (flat clip art or a cheap vector illustration) or other",
 "description": "two sentences: what the picture shows and how it's drawn",
 "colour": "vibrant (rich, saturated, luminous colour with strong warm-versus-cool contrast), muted (desaturated, brown or grey grading, flat) or dark (dark, gloomy or low-contrast)",
 "clarity": "crisp (clean linework, sharp, well-drawn faces) or soft (blurry, smudged, grainy or painterly faces and lines)",
 "text_seen": "every word you can clearly read in the image, exactly as written, or empty",
 "defects": ["only clear mistakes anyone would notice at a glance, each one named"],
 "scores": {"relatable": 1-5, "original": 1-5, "writing": 1-5, "audience_fit": 1-5, "aesthetic": 1-5, "storytelling": 1-5, "match": 1-5, "engaging": 1-5},
 "fix_image": "what would make the picture better, or empty",
 "fix_caption": "what would make the caption better, or empty"
}

DEFECTS are objective errors only: wrong or extra fingers or limbs, warped faces or bodies, melted or impossible objects, garbled, misspelled or extra text, a watermark or logo, obvious rendering artefacts, the subject or the words cut off at an edge. Taste is never a defect (a slightly stock look, the framing, the lighting, empty space, what could be clearer): score it and put it in fix_image or fix_caption.

SCORES: 5 = excellent, 4 = good enough to publish, 3 = needs work, 2 or 1 = poor. relatable = would someone think "that's me"; original = not a cliché or slogan; writing = natural, human, clean (a caption meant as humour that isn't actually funny is 3 or less); audience_fit = right for who it's for; aesthetic = bright, colourful and beautiful like a frame from a great hand-drawn 2D animated film, as striking as any style reference you were shown (not 3D, not a photo, not cheap vector, not childish, not dark or muddy); storytelling = the picture tells a story; match = the picture and caption tell the same story with the same details and add to each other (any contradiction, like a text in the picture while the caption says they heard it, or another place, time or person, is 3 or less); engaging = worth a like, comment or send.`;

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
  scores: Record<"relatable" | "original" | "writing" | "audience_fit" | "aesthetic" | "storytelling" | "match" | "engaging", number>;
  fix_image: string;
  fix_caption: string;
};

export function reviewPrompt(o: {
  caption: string;
  concept: Pick<DailyConcept, "message" | "situation" | "visual" | "typography" | "style"> & { art?: DailyArt | string | null; format?: DailyFormat | string | null };
  audience: DailyAudience;
  /** How many style references come before the picture. */
  references?: number;
}): string {
  const art = o.concept.art && o.concept.art in ART_STYLES ? ART_STYLES[o.concept.art as DailyArt] : null;
  return [
    o.references
      ? `THE FIRST ${o.references === 1 ? "IMAGE IS THE STYLE REFERENCE" : `${o.references} IMAGES ARE THE STYLE REFERENCES`} THE COACH CHOSE. THE LAST IMAGE IS THE ONE TO REVIEW: judge its colour, light, linework and how its people are drawn against the reference.`
      : null,
    `AUDIENCE: ${DAILY_AUDIENCE_GUIDE[o.audience]}`,
    `THE MESSAGE: ${o.concept.message}`,
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
      },
      fix_image: typeof j.fix_image === "string" ? j.fix_image.trim() : "",
      fix_caption: typeof j.fix_caption === "string" ? j.fix_caption.trim() : "",
    };
  } catch {
    return null;
  }
}

/** Words as letters only: "it's" and "its" are the same word, punctuation and line breaks don't count. */
const letters = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Each score a post has to reach. */
export const REVIEW_BARS: Review["scores"] = { relatable: 4, original: 3, writing: 4, audience_fit: 3, aesthetic: 4, storytelling: 3, match: 4, engaging: 3 };
const IMAGE_SCORES = new Set<keyof Review["scores"]>(["aesthetic", "storytelling", "match"]);

/**
 * Pass or fail, on concrete checks first: the words read off the picture are
 * exactly what was asked for (or none), no defects; then every score at its
 * bar. Says which side failed, so only that side is made again.
 */
export function reviewVerdict(r: Review, typography: string, scene = ""): { pass: boolean; image: string[]; caption: string[] } {
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

export const CAPTION_FIX_PROMPT = `You rewrite the caption of one daily post for a strength coach's community feed. The picture is already made and stays. Keep the post's message and form; fix only what the editor said. Same writing rules: plain words, lowercase like his texts, the first line earns the tap, no slogans, no hashtags, no quotation marks, at most one emoji, never a Bible verse. Answer with JSON only: {"caption": "..."}`;

export function captionFixPrompt(o: { concept: Pick<DailyConcept, "message" | "situation" | "visual" | "format">; caption: string; fix: string[] }): string {
  const f = DAILY_FORMATS[o.concept.format] ?? DAILY_FORMATS.observation;
  return [
    `THE MESSAGE: ${o.concept.message}`,
    `THE SITUATION: ${o.concept.situation}`,
    `THE PICTURE: ${o.concept.visual}`,
    `THE FORM: ${f.guide} (${f.min}-${f.max} characters)`,
    `THE CAPTION NOW:\n${o.caption}`,
    `WHAT TO FIX: ${o.fix.join("; ")}`,
  ].join("\n\n");
}

export function parseCaption(text: string): string | null {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) return null;
  try {
    const c = JSON.parse(m[0])?.caption;
    return typeof c === "string" && c.trim() ? c.trim().replace(/^["“]|["”]$/g, "").slice(0, 600) : null;
  } catch {
    return null;
  }
}

/** The review's average score (1 to 5), for the coach's card and the learning. */
export function reviewScore(r: Pick<Review, "scores">): number {
  const s = Object.values(r.scores);
  return Math.round((s.reduce((t, n) => t + n, 0) / s.length) * 10) / 10;
}
