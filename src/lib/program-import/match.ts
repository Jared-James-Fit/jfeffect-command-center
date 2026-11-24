/**
 * An imported program's exercise names matched to the app's library, on the
 * phone with the same search the pickers use (exercise-search.ts), so a
 * program's exercises keep their history, demos and analytics: the same
 * exercise by its canonical name or an alias is taken as it is; a close
 * match ("DB RDL" → Dumbbell Romanian Deadlift) is taken and marked to check;
 * nothing close leaves it for the person to pick, never a new exercise. Pure.
 */
import {
  findCanonicalExerciseMatch,
  normalizeText,
  searchExercises,
  singularizeSearchToken,
  SEARCH_TIER,
  type SearchableExercise,
} from "@/lib/exercise-search";

export type NameMatch<T extends SearchableExercise = SearchableExercise> = {
  status: "exact" | "close" | "none";
  exercise: T | null;
  /** A few others it might be (the picker's first suggestions). */
  options: T[];
};

/** The key a name is matched by (case and spacing don't count). */
export const nameKey = (name: string) => normalizeText(name);

/**
 * Words a library name may add to what a program wrote and still be the same
 * exercise: the default equipment of a barbell lift, a machine, a plain grip.
 * Anything else it adds (archer, lying, band, landmine, sit up, cable fly)
 * makes it another movement, so it's offered, never taken (Nov 24 2026).
 */
const NEUTRAL_EXTRA = new Set([
  "machine",
  "lever",
  "normal",
  "grip",
  "standard",
  "regular",
  "conventional",
  "press",
  "exercise",
  "the",
  "with",
  "on",
  "a",
]);

/**
 * The equipment (and set-up words) a movement means when a program doesn't say:
 * a pushdown is on a cable, a hammer curl uses dumbbells, a row or a squat is
 * a barbell's, a leg curl is a machine's. A library name that adds only these
 * is still what the program wrote.
 */
const DEFAULT_GEAR: Array<[RegExp, string[]]> = [
  [/\b(pushdown|push down|face pull|crossover|cable row|cable crunch)\b/, ["cable", "seated", "rope"]],
  [/\b(hammer curl|farmer|lateral raise|db)\b/, ["dumbbell"]],
  [/\b(squat|bench|deadlift|dl|row|press|ohp|good morning|rack pull|block pull|hip thrust|rdl|bb)\b/, ["barbell", "bb", "conventional"]],
  [/\brow\b/, ["bent", "over", "pronated"]],
  [/\b(leg curl|leg extension|leg press|calf raise|pec deck|hamstring curl)\b/, ["machine", "lying", "seated", "standing"]],
  [/\bblock pull\b/, ["deadlift"]],
  [/\bjm press\b/, ["bench"]],
];

/** The words that don't change an exercise for this name. */
export function neutralFor(name: string): Set<string> {
  const q = normalizeText(name).split(" ").map(singularizeSearchToken).join(" ");
  const out = new Set(NEUTRAL_EXTRA);
  for (const [re, words] of DEFAULT_GEAR) if (re.test(q)) for (const w of words) out.add(w);
  return out;
}

/** The words a library name adds beyond what the search matched (normalized, singular). */
export function extraWords(libraryName: string, highlights: readonly string[]): string[] {
  const covered = new Set(
    highlights.flatMap((h) => normalizeText(h).split(" ")).filter(Boolean).map(singularizeSearchToken),
  );
  return normalizeText(libraryName)
    .split(" ")
    .filter(Boolean)
    .map(singularizeSearchToken)
    .filter((w) => !covered.has(w));
}

/** Whether a close match only adds neutral words (so it's the same exercise). */
export function onlyNeutralExtras(libraryName: string, highlights: readonly string[], query = ""): boolean {
  const neutral = neutralFor(query);
  return extraWords(libraryName, highlights).every((w) => neutral.has(w));
}

export function matchExerciseNames<T extends SearchableExercise>(
  library: readonly T[],
  names: readonly string[],
  aliases: ReadonlyArray<{ exercise_id: string; alias_name: string }> = [],
): Map<string, NameMatch<T>> {
  const out = new Map<string, NameMatch<T>>();
  const live = library.filter((e) => !e.archived);
  for (const name of names) {
    const key = nameKey(name);
    if (!key || out.has(key)) continue;
    const exact = findCanonicalExerciseMatch(live, name, aliases);
    const found = searchExercises(live, name, { limit: 24 }).results.filter((r) => !r.alternative);
    const neutral = neutralFor(name);
    // the plainest version first: the fewest words beyond what the program wrote
    const plain = (r: (typeof found)[number]) => extraWords(r.exercise.name, r.highlights).length;
    const strange = (r: (typeof found)[number]) =>
      extraWords(r.exercise.name, r.highlights).filter((w) => !neutral.has(w)).length;
    const ranked = found
      .filter((r) => r.complete)
      .slice()
      .sort((a, b) => strange(a) - strange(b) || a.tier - b.tier || plain(a) - plain(b) || b.score - a.score);
    const options = ranked
      .filter((r) => r.tier <= SEARCH_TIER.metadataComplete)
      .map((r) => r.exercise)
      .filter((e) => e.id !== exact?.id)
      .slice(0, 3);
    if (exact) {
      out.set(key, { status: "exact", exercise: exact, options });
      continue;
    }
    const best = ranked.find((r) => r.tier <= SEARCH_TIER.nameSubstring && strange(r) === 0);
    if (best) {
      out.set(key, {
        status: best.tier <= SEARCH_TIER.tokenEquivalent ? "exact" : "close",
        exercise: best.exercise,
        options: options.filter((e) => e.id !== best.exercise.id),
      });
      continue;
    }
    // something else, or a different version of it: the person picks, the likeliest first
    out.set(key, {
      status: "none",
      exercise: null,
      options: (ranked.length ? ranked : found).slice(0, 3).map((r) => r.exercise),
    });
  }
  return out;
}
