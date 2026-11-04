/**
 * How easy an automated post is to read, and whether it sounds like the coach.
 *
 * Every post the app writes for the coach (lessons, the daily series, Wins,
 * the Recap, Tuesday's numbers, birthdays, holidays) has to read at about a
 * 5th grade level (`readingGrade`, the Flesch-Kincaid grade) and in his own
 * texting voice (`voiceProblems`: none of his never-say words, no em dashes or
 * semicolons, no "fr"). The tests hold the library and the templates to it.
 */

/** The grade every automated post stays at or under. */
export const PLAIN_GRADE_MAX = 5;

/** Words and marks that never sound like the coach (his My Voice never-say list, plus writing tics). */
export const NEVER_SAY = [
  "navigating",
  "it's clear that",
  "solid win",
  "momentum",
  "journey",
  "dial in",
  "a strong start",
  "keep it up",
  "significantly",
  "metabolic flexibility",
  "ensure",
  "crucial",
  "optimal",
  "prioritize",
  "best read",
  "furthermore",
  "moreover",
  "utilize",
  "leverage",
] as const;

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

/** A word's syllables, by its vowel groups (a close guess, the same one readability tools use). */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** The text's words (numbers count as one short word, emojis don't count). */
export function words(text: string): string[] {
  return text
    .replace(EMOJI, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

/** Its sentences: a line break ends one as much as a full stop does (the posts are written in short lines). */
export function sentences(text: string): string[] {
  return text
    .replace(EMOJI, " ")
    .split(/\n+|(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0);
}

/** Flesch-Kincaid grade level: 5 reads like a 5th grader's book. */
export function readingGrade(text: string): number {
  const ws = words(text);
  const ss = sentences(text);
  if (!ws.length || !ss.length) return 0;
  // a number reads as one word; a name (capitalized in his lowercase posts) as at most two
  const syl = ws.reduce(
    (n, w) =>
      n + (/^\d/.test(w) ? 1 : /^\p{Lu}\p{Ll}/u.test(w) ? Math.min(2, syllables(w)) : syllables(w)),
    0,
  );
  const grade = 0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59;
  return Math.round(Math.max(0, grade) * 10) / 10;
}

/** What in a post doesn't sound like him (empty when it does). */
export function voiceProblems(text: string): string[] {
  const out: string[] = [];
  const lower = ` ${text.toLowerCase()} `;
  for (const w of NEVER_SAY) if (lower.includes(w)) out.push(`says "${w}"`);
  if (/[—–]/.test(text)) out.push("has a dash");
  if (text.includes(";")) out.push("has a semicolon");
  if (/(^|[^\p{L}])fr([^\p{L}]|$)/iu.test(text)) out.push('says "fr"');
  return out;
}

/** The longest sentence, in words (a sentence over ~16 words is hard to follow on a phone). */
export function longestSentence(text: string): number {
  return Math.max(0, ...sentences(text).map((s) => words(s).length));
}

/**
 * Words a 5th grader (or a new lifter) wouldn't know, with what to say instead.
 * RPE, PR, reps and sets stay: everyone in the app logs them.
 */
export const JARGON: Record<string, string> = {
  "1rm": "your max",
  hypertrophy: "muscle growth",
  "compound lift": "big lifts like squats",
  eccentric: "the way down",
  concentric: "the way up",
  isometric: "holding still",
  emg: "how hard a muscle fires",
  "meta-analysis": "a big look at lots of studies",
  "moment arm": "how far the weight sits from the joint",
  velocity: "speed",
  adaptation: "getting better at it",
  stimulus: "a reason to grow",
  periodization: "how the plan changes week to week",
  participants: "people",
  subjects: "people",
  recreational: "regular gym-goers",
  approximately: "about",
  "on average": "most of the time",
  protocol: "plan",
  glycogen: "stored carbs",
  rir: "reps left in the tank",
  "range of motion": "how deep you go",
  "lengthened partial": "half reps at the stretched end",
  "motor unit": "muscle fibres",
  neuromuscular: "nerve and muscle",
  "systemic fatigue": "whole-body tired",
  "volume landmark": "how many sets you can recover from",
  "progressive overload": "adding a little over time",
  biomechanic: "how your body moves the weight",
  physiolog: "how your body works",
};

export type PlainCheck = {
  grade: number;
  longest: number;
  numbers: number;
  studies: number;
  jargon: string[];
  voice: string[];
  problems: string[];
};

/** Shorter than this, a grade is noise (a 6-word line with one long word reads as grade 8). */
export const GRADE_MIN_WORDS = 25;
/** A sentence longer than this is hard to follow on a phone. */
export const LONGEST_SENTENCE_MAX = 16;
/** More numbers than this and a post reads like a spreadsheet. */
export const NUMBERS_MAX = 8;
/** More studies than this and it reads like a paper. */
export const STUDIES_MAX = 2;

/**
 * Everything that makes a post hard to read or not him: the grade, a long
 * sentence, too many numbers or studies, jargon, his never-say list.
 */
export function plainCheck(text: string): PlainCheck {
  const grade = readingGrade(text);
  const longest = longestSentence(text);
  const numbers = (text.match(/\d+(?:[.,]\d+)?%?/g) ?? []).length;
  const studies = (text.toLowerCase().match(/\b(study|studies|review|trial|paper)\b/g) ?? [])
    .length;
  const lower = ` ${text.toLowerCase()} `;
  // a stem ("biomechanic", "physiolog") matches its endings too
  const jargon = Object.keys(JARGON).filter((j) =>
    new RegExp(
      `[^\\p{L}\\p{N}]${j}${/(c|g)$/.test(j) ? "\\p{L}*" : "s?"}[^\\p{L}\\p{N}]`,
      "u",
    ).test(lower),
  );
  const voice = voiceProblems(text);
  const problems = [
    // the grade formula needs a few sentences to mean anything: a one-liner is judged on its words
    ...(grade > PLAIN_GRADE_MAX && words(text).length >= GRADE_MIN_WORDS
      ? [`grade ${grade} (aim ${PLAIN_GRADE_MAX} or under)`]
      : []),
    ...(longest > LONGEST_SENTENCE_MAX
      ? [`a ${longest}-word sentence (${LONGEST_SENTENCE_MAX} at most)`]
      : []),
    ...(numbers > NUMBERS_MAX ? [`${numbers} numbers (${NUMBERS_MAX} at most)`] : []),
    ...(studies > STUDIES_MAX ? [`${studies} mentions of studies (${STUDIES_MAX} at most)`] : []),
    ...jargon.map((j) => `"${j}" (say "${JARGON[j]}")`),
    ...voice,
  ];
  return { grade, longest, numbers, studies, jargon, voice, problems };
}
