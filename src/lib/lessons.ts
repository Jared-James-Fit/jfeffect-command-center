/**
 * Coach lessons (20261129110000_community_lessons.sql): the educational posts
 * in the Crew. A lesson every day, each from the coach's own library, planned
 * two weeks ahead and reviewed by the coach before they go out. Wednesday's is
 * an uncomfortable truth (a belief most lifters hold, struck out, and what's
 * actually true) alongside Wednesday Wins, and Sunday's a short reset for the
 * week ahead alongside Sunday Recap (20261225090000_lesson_truth_reset.sql).
 * Saturday is the Powerlifting Technique & Troubleshooting series: problem →
 * why → fix → when it applies, by lift and by level, with a beginner, an
 * advanced and an elite post every month.
 *
 * Also the story stickers (poll, slider, question box) any post can carry:
 * lessons get theirs from the library, anyone can add one to their own story.
 */
import type { CSSProperties } from "react";
import type { CommunityAuthor, CommunityPost } from "@/lib/community";

export type LessonTrack = "strength" | "hypertrophy" | "truth" | "methods" | "mind" | "fix" | "reset";
export type LessonLevel = "beginner" | "advanced" | "elite";
export type LessonLift = "squat" | "bench" | "deadlift";

export const LESSON_TRACKS: LessonTrack[] = ["strength", "hypertrophy", "truth", "methods", "mind", "fix", "reset"];
export const LESSON_LEVELS: LessonLevel[] = ["beginner", "advanced", "elite"];
export const LESSON_LIFTS: LessonLift[] = ["squat", "bench", "deadlift"];

/** What each lesson day teaches (Winnipeg weekdays). */
export const LESSON_TRACK: Record<LessonTrack, { name: string; day: string; isoDay: number; blurb: string }> = {
  strength: { name: "Strength science", day: "Mon", isoDay: 1, blurb: "Technique, biomechanics, strength curves, programming" },
  hypertrophy: { name: "Hypertrophy", day: "Tue", isoDay: 2, blurb: "Bodybuilding technique and the science of growth" },
  truth: { name: "Uncomfortable truth", day: "Wed", isoDay: 3, blurb: "Challenge an assumption, create tension, give them something worth thinking about" },
  methods: { name: "Methods & cues", day: "Thu", isoDay: 4, blurb: "Bodybuilding cues and advanced methods" },
  mind: { name: "Mind & recovery", day: "Fri", isoDay: 5, blurb: "Psychology, research, recovery, experiments" },
  fix: { name: "Technique fix", day: "Sat", isoDay: 6, blurb: "Powerlifting troubleshooting: problem, why, fix, when" },
  reset: { name: "Sunday reset", day: "Sun", isoDay: 7, blurb: "A short mental and practical reset for the next seven days" },
};

export const LEVEL_LABEL: Record<LessonLevel, string> = { beginner: "Beginner", advanced: "Advanced", elite: "Elite" };
export const LIFT_LABEL: Record<LessonLift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

export type LessonVisualKind =
  | "bar_path"
  | "squat_torso"
  | "squat_balance"
  | "squat_rise"
  | "squat_depth"
  | "deadlift_start"
  | "bench_touch"
  | "sticking_point"
  | "strength_curve"
  | "length_tension"
  | "force_velocity"
  | "fitness_fatigue"
  | "sra"
  | "rpe_rir"
  | "dose_response"
  | "velocity_loss"
  | "set_structure"
  | "truth"
  | "reset";

export const LESSON_VISUAL_KINDS: LessonVisualKind[] = [
  "bar_path", "squat_torso", "squat_balance", "squat_rise", "squat_depth", "deadlift_start", "bench_touch", "sticking_point",
  "strength_curve", "length_tension", "force_velocity", "fitness_fatigue", "sra", "rpe_rir", "dose_response", "velocity_loss",
  "set_structure", "truth", "reset",
];

export type LessonVisual = {
  kind: LessonVisualKind;
  lift?: LessonLift | null;
  /** bar_path: forward | loop | none · deadlift_start: hips_high | hips_low | bar_forward */
  fault?: string | null;
  /** strength_curve: ascending | descending | bell */
  shape?: string | null;
  /**
   * squat_torso: build (default) | lean · bench_touch: tuck/flare (default) | consistency ·
   * sticking_point: window (shades fastest → slowest: where the push is under the bar's weight) ·
   * sra: stress · velocity_loss: cluster · set_structure: myo
   */
  variant?: string | null;
  /** truth: the belief most lifters hold (it's struck out on the card) */
  belief?: string | null;
  /** truth: what's actually true (the card's big line) */
  truth?: string | null;
  /** reset: the week's checklist, 2 to 4 short lines */
  items?: string[] | null;
};

export type LessonRef = { label: string; url?: string | null };

/** What a published lesson carries besides its words (the post's series_extra). */
export type LessonExtra = {
  key?: string;
  track: LessonTrack;
  title: string;
  level?: LessonLevel | null;
  lift?: LessonLift | null;
  tags?: string[];
  visual?: LessonVisual | null;
  refs?: LessonRef[];
};

export function isLessonTrack(t: unknown): t is LessonTrack {
  return typeof t === "string" && (LESSON_TRACKS as string[]).includes(t);
}

export function isLessonVisual(v: unknown): v is LessonVisual {
  return !!v && typeof v === "object" && (LESSON_VISUAL_KINDS as string[]).includes((v as { kind?: unknown }).kind as string);
}

/** A lesson post's card data, or null for anything else. */
export function extraLesson(post: Pick<CommunityPost, "series" | "series_extra">): LessonExtra | null {
  if (post.series !== "lesson") return null;
  const e = post.series_extra as unknown as Partial<LessonExtra> | null | undefined;
  if (!e || !isLessonTrack(e.track) || typeof e.title !== "string") return null;
  return {
    ...e,
    track: e.track,
    title: e.title,
    level: e.level && (LESSON_LEVELS as string[]).includes(e.level) ? e.level : null,
    lift: e.lift && (LESSON_LIFTS as string[]).includes(e.lift) ? e.lift : null,
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [],
    visual: isLessonVisual(e.visual) ? e.visual : null,
    refs: Array.isArray(e.refs) ? e.refs.filter((r): r is LessonRef => !!r && typeof r.label === "string") : [],
  };
}

/** The little line over a lesson: "Technique fix · Squat · Beginner", "Hypertrophy". */
export function lessonKicker(l: Pick<LessonExtra, "track" | "lift" | "level">): string {
  return [LESSON_TRACK[l.track].name, l.lift ? LIFT_LABEL[l.lift] : null, l.level ? LEVEL_LABEL[l.level] : null].filter(Boolean).join(" · ");
}

/** A reference link is only ever a web page (https), never anything that runs. */
export function safeRefUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The first line of a caption: what a lesson's story leads with. */
export function hookLine(caption: string | null | undefined): string {
  return (caption ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

/* ---- story stickers ------------------------------------------------- */

export type StickerOption = { label: string; tag?: string };
export type StickerSpec = (
  | { type: "poll"; q: string; options: StickerOption[] }
  | { type: "slider"; q: string; emoji: string }
  | { type: "question"; q: string }
) & {
  /** Where it sits on the story: its middle, as a share of the screen's height (stickerY). Missing = just above the reply bar. */
  y?: number;
};
export type StickerType = StickerSpec["type"];

export type StickerAnswer = CommunityAuthor & {
  choice?: number;
  value?: number;
  body?: string;
  at?: string;
  /** A question response the poster answered on their story (and which story). */
  answered_at?: string;
  answered_post_id?: string;
};

/** A question's responses as the poster works through them: not answered yet first, newest first in each (tested). */
export function questionResponses(answers: StickerAnswer[]): StickerAnswer[] {
  const t = (a: StickerAnswer) => (a.at ? Date.parse(a.at) : 0);
  return answers
    .filter((a) => !!a.body)
    .slice()
    .sort((a, b) => Number(!!a.answered_post_id) - Number(!!b.answered_post_id) || t(b) - t(a));
}

/** A sticker as a viewer gets it: the tallies, their own answer, and (the poster) who answered. */
export type PostSticker = (
  | { type: "poll"; q: string; options: (StickerOption & { votes: number })[] }
  | { type: "slider"; q: string; emoji: string; average?: number | null }
  | { type: "question"; q: string }
) & {
  /** Where the poster put it (StickerSpec.y). */
  y?: number;
  total: number;
  is_mine: boolean;
  mine?: { choice?: number; value?: number; body?: string } | null;
  answers?: StickerAnswer[];
};

export const STICKER_Q_MAX = 80;

/**
 * The band a sticker can be moved within on a story (its middle, as a share of
 * the screen's height): clear of the name and progress at the top and of the
 * reply bar at the bottom. The database keeps it to the same band
 * (community_sticker_clean).
 */
export const STICKER_Y_MIN = 0.2;
export const STICKER_Y_MAX = 0.66;

/** A sticker's spot, kept in the band and to 2 places; anything else means "the usual spot" (tested). */
export function stickerY(y: unknown): number | undefined {
  if (typeof y !== "number" || !Number.isFinite(y)) return undefined;
  return Math.round(Math.min(STICKER_Y_MAX, Math.max(STICKER_Y_MIN, y)) * 100) / 100;
}

/** Moved up into the top half: the story's words go underneath it instead of on top. */
export function stickerUpTop(y: number | undefined): boolean {
  return y !== undefined && y < 0.45;
}

/**
 * Where a story's sticker sits (tested): the spot its poster dragged it to (its
 * middle, as a share of the screen's height), or just above the reply bar of
 * `barH` px (its top 40px is the bar's fade, not buttons).
 */
export function stickerSpot(y: number | undefined, barH: number | null): CSSProperties {
  if (y !== undefined) return { top: `${y * 100}%`, transform: "translateY(-50%)" };
  return { bottom: barH ? `${barH - 40 + 12}px` : "calc(env(safe-area-inset-bottom) + 132px)" };
}
/**
 * Where a story's words may go (tested): below the progress + name row and
 * above the reply bar, on every phone. The story viewer sets
 * --story-safe-top / --story-safe-bottom from the phone's own safe areas
 * (notch / Dynamic Island, home bar); the coach's preview sets an iPhone's, so
 * what he arranges is where the crew sees it. The name row ends ~53px under
 * the top inset (3px progress, 10px gap, 40px row), so 72px leaves ~19px air.
 */
export const STORY_SAFE_TOP = "calc(var(--story-safe-top, 0.6rem) + 72px)";
export const STORY_SAFE_BOTTOM = "calc(var(--story-safe-bottom, 0.85rem) + 100px)";
/** The phone's own safe areas, for the story viewer's root. */
export const STORY_DEVICE_INSETS = { "--story-safe-top": "max(env(safe-area-inset-top), 0.6rem)", "--story-safe-bottom": "max(env(safe-area-inset-bottom), 0.85rem)" } as CSSProperties;
/** An iPhone with a Dynamic Island, for the coach's full-size preview. */
export const STORY_PREVIEW_INSETS = { "--story-safe-top": "59px", "--story-safe-bottom": "34px" } as CSSProperties;

/**
 * How a story frame's words sit (lesson, words, a workout win): centred
 * between the header and the reply bar; with a sticker, up top so the sticker
 * has the middle; with the sticker moved up top, underneath it.
 */
export function storyFrameLayout(sticker: { y?: number } | null | undefined): { place: "center" | "top" | "bottom"; style: CSSProperties } {
  if (!sticker) return { place: "center", style: { paddingTop: STORY_SAFE_TOP, paddingBottom: STORY_SAFE_BOTTOM } };
  if (stickerUpTop(sticker.y)) return { place: "bottom", style: { paddingTop: STORY_SAFE_TOP, paddingBottom: "calc(var(--story-safe-bottom, 0.85rem) + 124px)" } };
  return { place: "top", style: { paddingTop: STORY_SAFE_TOP, paddingBottom: STORY_SAFE_BOTTOM } };
}

export const STICKER_OPTION_MAX = 24;
export const STICKER_ANSWER_MAX = 300;

/**
 * A sticker ready to save, or the reason it isn't (the same rules the
 * database holds it to: community_sticker_clean).
 */
export function cleanSticker(s: StickerSpec): { ok: true; sticker: StickerSpec } | { ok: false; error: string } {
  const q = s.q.trim();
  if (!q) return { ok: false, error: "Ask something" };
  if (q.length > STICKER_Q_MAX) return { ok: false, error: `Keep the question to ${STICKER_Q_MAX} characters` };
  const y = stickerY(s.y);
  const at = y !== undefined ? { y } : {};
  if (s.type === "poll") {
    const options = s.options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
    if (options.length < 2 || options.length > 4) return { ok: false, error: "A poll needs 2 to 4 answers" };
    if (options.some((o) => o.label.length > STICKER_OPTION_MAX)) return { ok: false, error: `Keep each answer to ${STICKER_OPTION_MAX} characters` };
    if (new Set(options.map((o) => o.label.toLowerCase())).size !== options.length) return { ok: false, error: "Each answer needs to be different" };
    return { ok: true, sticker: { type: "poll", q, options, ...at } };
  }
  if (s.type === "slider") return { ok: true, sticker: { type: "slider", q, emoji: s.emoji?.trim() || "🔥", ...at } };
  return { ok: true, sticker: { type: "question", q, ...at } };
}

/** Whole-number shares that add up to 100 (largest remainder), for a poll's bars. */
export function stickerPercents(votes: number[]): number[] {
  const total = votes.reduce((a, b) => a + b, 0);
  if (!total) return votes.map(() => 0);
  const raw = votes.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem)
    .forEach(({ i }) => {
      if (left > 0) {
        out[i] += 1;
        left -= 1;
      }
    });
  return out;
}

/** The viewer's answer applied at once (before the server says so), like a poll vote. */
export function answerSticker(s: PostSticker, a: { choice?: number | null; value?: number; body?: string }): PostSticker {
  const had = !!s.mine;
  if (s.type === "poll") {
    const before = s.mine?.choice;
    const next = a.choice ?? null;
    const options = s.options.map((o, i) => ({
      ...o,
      votes: Math.max(0, o.votes - (before === i ? 1 : 0) + (next === i ? 1 : 0)),
    }));
    if (next == null) return { ...s, options, mine: null, total: Math.max(0, s.total - (had ? 1 : 0)) };
    return { ...s, options, mine: { choice: next }, total: s.total + (had ? 0 : 1) };
  }
  if (s.type === "slider" && typeof a.value === "number") {
    const n = s.total + (had ? 0 : 1);
    const prevSum = (s.average ?? 0) * s.total - (had && typeof s.mine?.value === "number" ? s.mine.value : 0);
    return { ...s, mine: { value: a.value }, total: n, average: Math.round((prevSum + a.value) / Math.max(1, n)) };
  }
  if (s.type === "question" && a.body) return { ...s, mine: { body: a.body }, total: s.total + (had ? 0 : 1) };
  return s;
}

/* ---- the coach's plan ------------------------------------------------ */

export type LessonItem = {
  id: string;
  key: string;
  track: LessonTrack;
  title: string;
  level: LessonLevel | null;
  lift: LessonLift | null;
  tags: string[];
  visual: LessonVisual | null;
  refs: LessonRef[];
  story: StickerSpec | null;
  body: string;
  active: boolean;
  use_count: number;
  last_used_at: string | null;
  media?: unknown[];
  /** library only: the day it's planned for, if it is */
  planned?: string | null;
};

export type LessonStatus = "planned" | "approved" | "posted" | "skipped" | "missed" | "failed";

export type LessonPlanRow = {
  id: string;
  day: string;
  track: LessonTrack;
  status: LessonStatus;
  post_at: string;
  time_set: boolean;
  body: string | null;
  edited: boolean;
  media: unknown[];
  sticker: StickerSpec | null;
  sticker_set: boolean;
  posted_as: "lesson" | "data" | null;
  post_id: string | null;
  posted_at: string | null;
  error: string | null;
  attempts: number;
  approved_at: string | null;
  item: LessonItem | null;
};

/** What the coach's story preview steps through (tested): every lesson from today on that will be (or is) a story. */
export function storyRows(plan: LessonPlanRow[], today: string): LessonPlanRow[] {
  return plan.filter((r) => r.day >= today && !!r.item && r.status !== "skipped" && r.posted_as !== "data");
}

export type LessonStats = {
  posts: number;
  by_track: { track: LessonTrack | "data"; posts: number; views: number; reactions: number; comments: number; answers: number }[];
  recent: {
    post_id: string;
    created_at: string;
    track: LessonTrack | "data";
    title: string | null;
    level: LessonLevel | null;
    lift: LessonLift | null;
    views: number;
    reactions: number;
    comments: number;
    answers: number;
    sticker: StickerType | null;
  }[];
  interest: { tag: string; answers: number }[];
};

export type LessonsOverview = {
  today: string;
  mode: "review" | "auto";
  paused: boolean;
  author: CommunityAuthor | null;
  time: { fixed: string | null; learned: { time: string; learned: boolean; views: number } };
  plan: LessonPlanRow[];
  coverage: { month: string; levels: Record<LessonLevel, number> }[];
  library: Record<LessonTrack, { active: number; fresh: number }>;
  observation: { caption: string; observation: string } | null;
  stats: LessonStats;
};

/** What a plan row needs from the coach, in a word. */
export function lessonStatusLabel(r: Pick<LessonPlanRow, "status" | "item" | "posted_as">, mode: "review" | "auto"): string {
  if (r.status === "posted") return r.posted_as === "data" ? "Posted · crew data" : "Posted";
  if (r.status === "skipped") return r.item ? "Skipped" : "Cleared";
  if (r.status === "missed") return "Missed";
  if (r.status === "failed") return "Didn't post";
  if (!r.item) return "Nothing picked";
  if (r.status === "approved") return "Approved";
  return mode === "auto" ? "Goes out on its own" : "Needs your OK";
}

/** Rows that need the coach before they can go out (review mode). */
export function needsReview(rows: LessonPlanRow[], mode: "review" | "auto"): LessonPlanRow[] {
  if (mode !== "review") return [];
  return rows.filter((r) => r.status === "planned" && !!r.item);
}

/** The month's troubleshooting levels still missing: "Advanced" etc. */
export function missingLevels(levels: Record<LessonLevel, number> | null | undefined): LessonLevel[] {
  return LESSON_LEVELS.filter((l) => !(levels?.[l] ?? 0));
}

/** A 24h "HH:MM" as "5:00 pm". */
export function clockLabel(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  const mm = m[2];
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${ap}`;
}

/* ---- Winnipeg time (every coach post is planned in it) --------------- */

export const COACH_TZ = "America/Winnipeg";

/** "YYYY-MM-DD" and "HH:MM" of a moment, on the coach's clock. */
export function coachClock(iso: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: COACH_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** A Winnipeg date + time as an instant (daylight saving included). */
export function coachInstant(date: string, time: string): string {
  // the zone's offset that day (noon is clear of the 2am switch)
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: COACH_TZ, timeZoneName: "longOffset" })
      .formatToParts(new Date(`${date}T12:00:00Z`))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-06:00";
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  const off = m ? `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}` : "-06:00";
  return new Date(`${date}T${time}:00${off}`).toISOString();
}

/** "Thu, Oct 15" for a plan day. */
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "5:00 pm" on the coach's clock. */
export function coachTimeLabel(iso: string): string {
  return clockLabel(coachClock(iso).time);
}

/* ---- optional illustrations ------------------------------------------- */

/**
 * What an image model is asked for, for a lesson: the app's look, one clear
 * subject, and no text (image models garble words and numbers). Technical
 * content stays in the drawn diagrams; this is only a cover.
 */
/**
 * Which lessons can get an OpenAI cover: never a technique fix or one with a
 * drawn diagram (positions and curves need to be exact and look like the app;
 * a generated picture can't promise either). The rest (mind, methods, most
 * hypertrophy) can have an optional mood picture.
 */
export function canHaveArt(l: Pick<LessonExtra, "track" | "visual">): boolean {
  return l.track !== "fix" && !l.visual;
}

export function lessonArtPrompt(l: Pick<LessonExtra, "title" | "lift" | "track">): string {
  const subject = l.lift
    ? `a powerlifter performing a ${l.lift === "bench" ? "bench press" : l.lift}, side view, realistic proportions and technique`
    : l.track === "mind"
      ? "a lifter sitting calmly on a bench between sets, focused"
      : l.track === "hypertrophy" || l.track === "methods"
        ? "a lifter training with dumbbells or a cable machine, realistic proportions"
        : "a barbell and plates in a quiet strength gym";
  return [
    `Cover illustration for a strength coaching post titled "${l.title}".`,
    `Subject: ${subject}.`,
    "Style: minimal flat vector illustration that matches a clean fitness app: simple rounded shapes, no outlines, no texture, soft even light, dark charcoal background (#0a0a0d), warm grey and off-white shapes, one small red accent (#ef3340), lots of empty space.",
    "Plain silhouettes without facial detail, realistic proportions, no exaggerated muscles, no clutter.",
    "Absolutely no text, letters, numbers, logos or watermarks anywhere in the image.",
  ].join(" ");
}
