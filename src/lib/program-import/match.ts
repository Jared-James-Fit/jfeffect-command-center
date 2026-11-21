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
    const found = searchExercises(live, name, { limit: 8 }).results.filter((r) => !r.alternative);
    const options = found
      .filter((r) => r.complete && r.tier <= SEARCH_TIER.metadataComplete)
      .map((r) => r.exercise)
      .filter((e) => e.id !== exact?.id)
      .slice(0, 3);
    if (exact) {
      out.set(key, { status: "exact", exercise: exact, options });
      continue;
    }
    const best = found.find((r) => r.complete && r.tier <= SEARCH_TIER.allTokensInName);
    if (best) {
      out.set(key, {
        status: best.tier <= SEARCH_TIER.tokenEquivalent ? "exact" : "close",
        exercise: best.exercise,
        options: options.filter((e) => e.id !== best.exercise.id),
      });
      continue;
    }
    out.set(key, {
      status: "none",
      exercise: null,
      options: found.slice(0, 3).map((r) => r.exercise),
    });
  }
  return out;
}
