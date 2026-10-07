/**
 * Pre- / Post-Workout meal tags. The tag lives in the meal header itself
 * ("Meal 2 (Pre-Workout)"), so pasted plans, the AI, the coach editor, the
 * client view and the PDF all share one source of truth.
 */

export type MealTiming = "pre" | "post" | "pre_post" | null;

export const MEAL_TIMING_LABEL: Record<Exclude<MealTiming, null>, string> = {
  pre: "Pre-Workout",
  post: "Post-Workout",
  pre_post: "Pre / Post-Workout",
};

/** Short client-facing "when" for each tag. */
export const MEAL_TIMING_HINT: Record<Exclude<MealTiming, null>, string> = {
  pre: "Eat this 1–2 hours before you train",
  post: "Eat this within 2 hours after you train",
  pre_post: "Eat this around your workout",
};

/**
 * Plain-language explainer behind the (i) next to a workout meal and in
 * Nutrition Help. One source so the wording is identical everywhere.
 */
export const WORKOUT_MEAL_EXPLAINER = {
  title: "Pre-Workout & Post-Workout meals",
  pre: {
    term: "Pre-Workout",
    text: "the meal you eat 1–2 hours before you train. Mostly carbs with some protein and not much fat, so you have energy to lift hard without feeling heavy or bloated.",
  },
  post: {
    term: "Post-Workout",
    text: "the meal you eat within 2 hours after you train. Protein and carbs help your muscles recover and grow, and refill the energy you just used.",
  },
  move: "Training at a different time today? Just move these two meals with your workout.",
  optional: "Eating them at these times is the best way to do it, but it's not a must. What matters most is eating ALL your meals and hitting your daily numbers.",
} as const;

/** The explainer as one paragraph (FAQ answers, plain text surfaces). */
export function workoutMealExplainerText(): string {
  const x = WORKOUT_MEAL_EXPLAINER;
  return `${x.pre.term} = ${x.pre.text} ${x.post.term} = ${x.post.text} ${x.move} ${x.optional}`;
}

const PRE = /\bpre[\s-]*(?:workout|training|lift|gym|session)\b|\bpre\s*\/\s*post[\s-]*(?:workout|training)\b/i;
const POST = /\bpost[\s-]*(?:workout|training|lift|gym|session)\b|\bpre\s*\/\s*post[\s-]*(?:workout|training)\b/i;

/** Detect a timing tag anywhere in a header / subtitle. */
export function detectMealTiming(text: string | null | undefined): MealTiming {
  const t = String(text ?? "");
  const pre = PRE.test(t);
  const post = POST.test(t);
  if (pre && post) return "pre_post";
  if (pre) return "pre";
  if (post) return "post";
  return null;
}

/** Meal header lines the editor can tag ("Meal 2", "Meal 2 (Pre-Workout)", "Breakfast"…). */
const MEAL_LINE = /^\s*[-*•·]?\s*(meal\s*\d+|breakfast|lunch|dinner|snack\s*\d*|pre[- ]?workout(?:\s*meal)?|post[- ]?workout(?:\s*meal)?)\b(.*)$/i;

export type MealHeader = { lineIndex: number; base: string; extra: string; timing: MealTiming };

/** Meal headers in one day's text, in order. */
export function listMealHeaders(text: string | null | undefined): MealHeader[] {
  const out: MealHeader[] = [];
  String(text ?? "").replace(/\r\n/g, "\n").split("\n").forEach((line, i) => {
    const m = line.match(MEAL_LINE);
    if (!m) return;
    // Skip "Approximate macros" etc. that can't match anyway; skip totals.
    const base = m[1].replace(/\s+/g, " ").trim();
    const rest = m[2] ?? "";
    out.push({ lineIndex: i, base, extra: stripTimingText(rest), timing: detectMealTiming(line) });
  });
  return out;
}

/** Remove any timing words / their brackets from a header remainder. */
export function stripTimingText(s: string): string {
  return s
    .replace(/\(\s*(?:pre\s*\/\s*post|pre|post)[\s-]*(?:workout|training|lift|gym|session)(?:\s*meal)?\s*\)/gi, "")
    .replace(/[–—-]?\s*(?:pre\s*\/\s*post|pre|post)[\s-]*(?:workout|training|lift|gym|session)(?:\s*meal)?/gi, "")
    .replace(/^\s*[:–—-]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Set (or clear) the timing tag on the Nth meal header of a day's text.
 * Rewrites only that header line; everything else is untouched.
 */
export function setMealTiming(text: string, mealIndex: number, timing: MealTiming): string {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const headers = listMealHeaders(text);
  const h = headers[mealIndex];
  if (!h) return text;
  // A standalone "Pre-Workout" header becomes a plain meal so the tag is explicit.
  const isTimingOnlyBase = /^(pre|post)[- ]?workout/i.test(h.base);
  const base = isTimingOnlyBase ? `Meal ${mealIndex + 1}` : capitalise(h.base);
  const extra = h.extra.trim();
  const joined = !extra ? "" : /^[:–—-]/.test(extra) ? extra.replace(/^([:–—-])\s*/, "$1 ") : ` ${extra}`;
  const tag = timing ? ` (${MEAL_TIMING_LABEL[timing]})` : "";
  lines[h.lineIndex] = `${base}${joined}${tag}`;
  return lines.join("\n");
}

function capitalise(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
