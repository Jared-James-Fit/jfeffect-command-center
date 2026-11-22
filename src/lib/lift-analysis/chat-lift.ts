/**
 * Which set a video sent in the coach chat shows (pure). The athlete films a
 * set, then sends it to their coach with a few words ("Last set comp bench",
 * "1st set close grip bench", or nothing): this reads those words, when the
 * sets were logged and, once the bar has been read, which way the reps went
 * and how many there were, against the sets the athlete logged around the
 * time it was sent.
 *
 *   link     sure which set: the read goes on it (and its speed with it)
 *   suggest  the workout is clear and one set is likely: kept on no set,
 *            with that set offered for one tap ("Comp Bench · Set 3?")
 *   day      the workout is clear, the set isn't: the athlete picks
 *   none     no barbell set logged around then and the words name none:
 *            not read as a lift at all (a question, a machine, the dog)
 *
 * It never links on a guess: a set is linked only when two independent
 * signals agree (the words or the logging time name one exercise, and the
 * words or the logging time name one set of it) and nothing contradicts
 * them (the bar's direction, the number of reps).
 */
import { analysableExercise, repDirection } from "@/lib/lift-analysis/exercise";

export type ChatLiftSet = {
  rowId: string;
  dayId: string;
  setIndex: number;
  exercise: string;
  /** When the set was logged (ISO), or null when it's only planned. */
  completedAt: string | null;
  reps: number | null;
  /** Its name in the workout ("Top set", "Backoff 2"), when known. */
  setName?: string | null;
};

export type ChatLiftVideo = { dir: "lower_first" | "lift_first" | null; reps: number | null };

export type ChatLiftMatch =
  | { kind: "link"; set: ChatLiftSet; why: string[] }
  | { kind: "suggest"; dayId: string; set: ChatLiftSet; why: string[] }
  | { kind: "day"; dayId: string; why: string[] }
  | { kind: "none"; why: string[] };

/**
 * Sets logged this long before the video was sent (or a little after: some
 * film, send, then log) can be the one it shows. Real chat videos (Nov 2026)
 * came minutes after the set, in a batch after the workout, or the same
 * evening (up to 13 hours later), so the workout is looked for across the
 * day; a set is only ever linked on the stricter rules below.
 */
export const LOGGED_WINDOW_MIN = 14 * 60;
export const LOGGED_AFTER_MIN = 20;
/** A set logged this close to sending (either side) is "the set just done". */
export const JUST_DONE_MIN = 12;
/** Barbell lifts logged this close to sending: only one of them, and it's the lift the video shows. */
export const ONE_LIFT_MIN = 45;

const ALIASES: Record<string, string> = {
  comp: "competition",
  comps: "competition",
  cg: "close",
  cgbp: "close",
  sq: "squat",
  squats: "squat",
  dl: "deadlift",
  dls: "deadlift",
  deadlifts: "deadlift",
  deads: "deadlift",
  bp: "bench",
  benching: "bench",
  rdl: "romanian",
  rdls: "romanian",
  ohp: "overhead",
  hb: "high",
  ssb: "safety",
  paused: "pause",
  pauses: "pause",
  tempos: "tempo",
  presses: "press",
};

/** Words that make one variation of a lift another. */
const VARIATION_WORDS = new Set([
  "competition",
  "close",
  "wide",
  "pause",
  "tempo",
  "pin",
  "spoto",
  "larsen",
  "incline",
  "decline",
  "floor",
  "sumo",
  "conventional",
  "high",
  "lowbar",
  "front",
  "box",
  "deficit",
  "block",
  "romanian",
  "stiff",
  "safety",
  "board",
  "slingshot",
  "feet",
  "dead",
  "touch",
]);

/** Words that say nothing about which exercise. */
const FILLER = new Set([
  "the",
  "a",
  "an",
  "my",
  "of",
  "on",
  "for",
  "and",
  "with",
  "this",
  "that",
  "is",
  "was",
  "set",
  "sets",
  "rep",
  "reps",
  "lb",
  "lbs",
  "kg",
  "kgs",
  "rpe",
  "top",
  "last",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "final",
  "backoff",
  "back",
  "off",
  "barbell",
  "bar",
  "video",
  "here",
  "today",
  "felt",
  "heavy",
  "light",
  "easy",
  "hard",
  "pr",
  "form",
  "check",
  "how",
  "it",
  "look",
  "looks",
  "did",
  "do",
  "i",
  "me",
  "coach",
  "count",
  "ct",
  "x",
]);

export function captionTokens(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/close[\s-]+grip/g, "close")
    .replace(/high[\s-]+bar/g, "high")
    .replace(/low[\s-]+bar/g, "lowbar")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ALIASES[w] ?? w)
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function nameTokens(name: string): string[] {
  return captionTokens(name).filter((w) => !FILLER.has(w) && !/^\d+$/.test(w));
}

/**
 * How well the words name an exercise (0…1): the share of the exercise's own
 * words the caption says, its family word ("bench", "squat", "deadlift")
 * required.
 */
export function exerciseScore(caption: string, exercise: string): number {
  const cap = new Set(captionTokens(caption));
  const ex = nameTokens(exercise);
  if (!ex.length) return 0;
  const family = ex.find((w) => /^(bench|squat|deadlift|press|row|romanian|overhead)$/.test(w));
  const saysFamily = family
    ? cap.has(family) ||
      (family === "deadlift" && (cap.has("pull") || cap.has("sumo"))) ||
      (family === "romanian" && cap.has("deadlift"))
    : true;
  const hit = ex.filter((w) => cap.has(w)).length;
  // the words name another family outright: not this one
  const otherFamily = ["bench", "squat", "deadlift"].some(
    (f) => f !== family && cap.has(f) && !ex.includes(f),
  );
  if (otherFamily) return 0;
  // the words name a variation this exercise isn't ("close grip" against the competition bench)
  const exSet = new Set(ex);
  const otherVariation = [...cap].some((w) => VARIATION_WORDS.has(w) && !exSet.has(w));
  const base = saysFamily ? hit / ex.length : 0.5 * (hit / ex.length);
  return otherVariation ? base * 0.5 : base;
}

/** Which set the words name, by its place: "1st set", "set 2", "last", "top set", "backoff". */
export function captionSetPlace(
  caption: string,
):
  | { kind: "index"; n: number }
  | { kind: "last" }
  | { kind: "top" }
  | { kind: "backoff"; n: number | null }
  | { kind: "warmup" }
  | null {
  const s = (caption ?? "").toLowerCase();
  // a warm-up is never one of the working sets ("Last warm up for comp bench")
  if (/\bwarm[\s-]?ups?\b/.test(s)) return { kind: "warmup" };
  const ord: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
  };
  let m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+(?:working\s+|work\s+)?set\b/);
  if (m) return { kind: "index", n: Number(m[1]) };
  m = s.match(/\bset\s*#?\s*(\d{1,2})\b/);
  if (m) return { kind: "index", n: Number(m[1]) };
  m = s.match(/\b(first|second|third|fourth|fifth|sixth)\s+(?:working\s+|work\s+)?set\b/);
  if (m) return { kind: "index", n: ord[m[1]] };
  if (/\b(last|final)\s+(set|one)\b/.test(s) || /\blast\b/.test(s)) return { kind: "last" };
  m = s.match(/\bback[\s-]?offs?\s*#?\s*(\d)?\b/);
  if (m) return { kind: "backoff", n: m[1] ? Number(m[1]) : null };
  if (/\btop\s+(set|single|double|triple)\b/.test(s)) return { kind: "top" };
  return null;
}

const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

/** One lift however many rows the program gives it (a top single, then back-offs): by its name. */
export const liftKey = (exercise: string) =>
  captionTokens(exercise)
    .filter((w) => !FILLER.has(w))
    .join(" ");

/**
 * A lift's sets in the order they were done: row by row (by when the row's
 * first set was logged; unlogged rows after), then by set number. Logging
 * time alone can't order them: a fill-down logs a whole row in one moment.
 */
function liftOrder(sets: readonly ChatLiftSet[]): ChatLiftSet[] {
  const firstAt = new Map<string, number>();
  for (const s of sets)
    if (s.completedAt) {
      const t = Date.parse(s.completedAt);
      if (t < (firstAt.get(s.rowId) ?? Infinity)) firstAt.set(s.rowId, t);
    }
  return [...sets].sort(
    (a, b) =>
      (firstAt.get(a.rowId) ?? Infinity) - (firstAt.get(b.rowId) ?? Infinity) ||
      a.rowId.localeCompare(b.rowId) ||
      a.setIndex - b.setIndex,
  );
}

/** The set a video sent at `sentAt` with these words shows (see the file's header). */
export function matchChatLift(input: {
  caption: string;
  sentAt: string;
  sets: readonly ChatLiftSet[];
  video?: ChatLiftVideo | null;
}): ChatLiftMatch {
  const { caption, sentAt } = input;
  const video = input.video ?? null;
  const barbell = input.sets.filter((s) => analysableExercise(s.exercise));
  const logged = barbell.filter(
    (s) =>
      s.completedAt &&
      minutesBetween(s.completedAt, sentAt) >= -LOGGED_AFTER_MIN &&
      minutesBetween(s.completedAt, sentAt) <= LOGGED_WINDOW_MIN,
  );
  const why: string[] = [];
  // how well the words name each lift (a lift on two rows is one lift)
  const named = new Map<string, number>();
  for (const s of barbell) {
    const k = liftKey(s.exercise);
    const sc = exerciseScore(caption, s.exercise);
    if (sc > (named.get(k) ?? 0)) named.set(k, sc);
  }
  const ranked = [...named.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const runnerUp = ranked[1];
  const wordsLift =
    top && top[1] >= 0.5 && (!runnerUp || top[1] - runnerUp[1] >= 0.2) ? top[0] : null;
  if (!logged.length && !wordsLift)
    return { kind: "none", why: ["no barbell set logged around then"] };
  const days = new Set(logged.map((s) => s.dayId));
  const latestLogged = logged.length
    ? logged.reduce((b, s) => (Date.parse(s.completedAt!) > Date.parse(b.completedAt!) ? s : b))
    : null;
  const dayId =
    (wordsLift &&
      (
        logged.find((s) => liftKey(s.exercise) === wordsLift) ??
        barbell.find((s) => liftKey(s.exercise) === wordsLift)
      )?.dayId) ||
    (days.size === 1 ? [...days][0] : null) ||
    latestLogged?.dayId ||
    null;
  if (!dayId) return { kind: "none", why: ["no workout"] };
  const inDay = barbell.filter((s) => s.dayId === dayId);
  const loggedInDay = logged.filter((s) => s.dayId === dayId);

  // the lift: named, else the barbell lift logged closest to sending
  const near = (s: ChatLiftSet, min: number) =>
    Math.abs(minutesBetween(s.completedAt!, sentAt)) <= min;
  const closest = loggedInDay.length
    ? loggedInDay.reduce((b, s) =>
        Math.abs(minutesBetween(s.completedAt!, sentAt)) <
        Math.abs(minutesBetween(b.completedAt!, sentAt))
          ? s
          : b,
      )
    : null;
  const justDone = closest && near(closest, JUST_DONE_MIN) ? closest : null;
  // the only barbell lift being done around then: no other lift it could be
  const liftsNear = new Set(
    loggedInDay.filter((s) => near(s, ONE_LIFT_MIN)).map((s) => liftKey(s.exercise)),
  );
  const onlyLift = justDone && liftsNear.size === 1 ? justDone : null;
  let lift = wordsLift;
  let exerciseSignals = 0;
  if (wordsLift) {
    exerciseSignals++;
    why.push("named in the message");
  }
  if (justDone) {
    const jl = liftKey(justDone.exercise);
    if (!lift) lift = jl;
    // a lift logged just before counts on its own only when it's the only one being done: in a batch
    // sent after the workout, "1st working set" with no lift named could be any of them
    if (jl === lift && (wordsLift || onlyLift)) {
      exerciseSignals++;
      why.push(
        onlyLift
          ? "the only barbell lift being done when it was sent"
          : "logged just before it was sent",
      );
    }
  }
  // the bar's own direction rules out a lift going the other way
  if (lift && video?.dir) {
    const ex = inDay.find((s) => liftKey(s.exercise) === lift)?.exercise;
    const d = ex ? repDirection(ex) : null;
    if (d && d !== video.dir) {
      why.push("the bar moved the other way");
      return { kind: "day", dayId, why };
    }
  }
  if (!lift) return { kind: "day", dayId, why: ["several lifts, none named"] };

  const place = captionSetPlace(caption);
  if (place?.kind === "warmup") return { kind: "day", dayId, why: [...why, "a warm-up"] };
  const ofLift = liftOrder(inDay.filter((s) => liftKey(s.exercise) === lift));
  const loggedOfLift = ofLift.filter((s) => s.completedAt);
  let set: ChatLiftSet | null = null;
  let setSignals = 0;
  if (place?.kind === "index") set = ofLift[place.n - 1] ?? null;
  else if (place?.kind === "last")
    set = loggedOfLift.length ? loggedOfLift[loggedOfLift.length - 1] : null;
  else if (place?.kind === "top")
    set = ofLift.find((s) => /top/i.test(s.setName ?? "")) ?? ofLift[0] ?? null;
  else if (place?.kind === "backoff") {
    const backs = ofLift.filter((s) => /back/i.test(s.setName ?? ""));
    set = backs.length ? (place.n ? (backs[place.n - 1] ?? null) : null) : null;
  }
  if (set) {
    setSignals++;
    why.push("its place in the message");
  }
  // the set logged just before sending (the last in order among those logged in the same moment)
  const recent = loggedOfLift.filter((s) => near(s, JUST_DONE_MIN));
  const newest = recent.length ? Math.max(...recent.map((s) => Date.parse(s.completedAt!))) : null;
  const timeSet =
    newest != null
      ? ([...recent].reverse().find((s) => newest - Date.parse(s.completedAt!) <= 2000) ?? null)
      : null;
  if (timeSet) {
    if (!set) set = timeSet;
    if (timeSet.rowId === set.rowId && timeSet.setIndex === set.setIndex) {
      setSignals++;
      why.push("the last set logged before it was sent");
    }
  }
  if (!set) return { kind: "day", dayId, why };
  // the reps: a set logged with another rep count isn't this video
  if (video?.reps != null && set.reps != null && video.reps !== set.reps) {
    why.push(`${video.reps} reps in the video, ${set.reps} logged`);
    return { kind: "suggest", dayId, set, why };
  }
  if (video?.reps != null && set.reps != null && video.reps === set.reps)
    why.push("same rep count");
  const sure = exerciseSignals >= 1 && setSignals >= 1 && exerciseSignals + setSignals >= 3;
  const repsAgree = video?.reps != null && set.reps != null && video.reps === set.reps;
  // a set that isn't logged yet is never linked from words alone: nothing to check the video against
  if (!set.completedAt) return { kind: "suggest", dayId, set, why };
  if (sure || (exerciseSignals >= 1 && setSignals >= 1 && repsAgree))
    return { kind: "link", set, why };
  return { kind: "suggest", dayId, set, why };
}

/** The key a chat video's running read is kept under before it has a row (store.ts). */
export const chatRunKey = (storagePath: string) => `chat:${storagePath}`;

/** Chat videos older than this aren't read without a tap. */
export const CHAT_LIFT_AUTO_HOURS = 48;

/** The words name one of these barbell lifts (or a squat / bench / deadlift at all). */
export function captionNamesLift(caption: string, sets: readonly ChatLiftSet[]): boolean {
  const cap = new Set(captionTokens(caption));
  if (cap.has("squat") || cap.has("bench") || cap.has("deadlift") || cap.has("sumo")) return true;
  return sets.some(
    (s) => analysableExercise(s.exercise) && exerciseScore(caption, s.exercise) >= 0.5,
  );
}
