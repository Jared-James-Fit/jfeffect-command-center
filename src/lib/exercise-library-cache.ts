import type { QueryClient } from "@tanstack/react-query";

/**
 * Canonical exercise library cache keys.
 *
 * Every surface that reads `public.exercises` (admin library, program
 * builder, workout builder, Quick Swap search + suggestions, client
 * portal library, membership builder) caches its own projection under
 * one of these keys. Creating/editing/archiving an exercise must
 * refresh ALL of them, otherwise the new row appears on one surface and
 * not another until a hard refresh.
 */
export const EXERCISE_LIBRARY_QUERY_PREFIXES = [
  "exercises",                  // admin library + client portal library (select *)
  "exercises-min",              // program builder / block editor projection
  "exercise-search-pool",       // Quick Swap search pool
  "exercise-search-pool-lite",  // inline workout editor search pool
  "quick-swap-suggestions",     // ranked swap suggestions (server-filtered)
  "pl-maxes-exercise-library",  // block maxes picker
  "day-preview-exercises",      // workout day preview rows
] as const;

export function isExerciseLibraryQueryKey(queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  return (
    typeof first === "string" &&
    (EXERCISE_LIBRARY_QUERY_PREFIXES as readonly string[]).includes(first)
  );
}

const RAW_EXERCISE_LIST_PREFIXES = new Set([
  "exercises",
  "exercises-min",
  "exercise-search-pool",
  "exercise-search-pool-lite",
]);

type CachedExercise = { id: string; name?: string | null; archived?: boolean | null } & Record<string, unknown>;

/**
 * Put a newly-created exercise into every raw list immediately. Invalidating
 * alone leaves a visible delay on mobile (and can be superseded by a hydrated
 * cache), so the success toast must only appear after the current cache
 * already contains the returned database row.
 */
export function upsertExerciseInLibraryCaches(
  qc: QueryClient,
  exercise: CachedExercise,
): void {
  qc.setQueriesData<CachedExercise[]>(
    {
      predicate: (query) => {
        const first = query.queryKey[0];
        return typeof first === "string" && RAW_EXERCISE_LIST_PREFIXES.has(first);
      },
    },
    (current) => {
      if (!Array.isArray(current)) return current;
      const existing = current.find((row) => row?.id === exercise.id);
      const next = existing
        ? current.map((row) => row?.id === exercise.id ? { ...row, ...exercise } : row)
        : [...current, exercise];
      return next.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    },
  );
}

/**
 * Invalidate + refetch every exercise-library consumer, including the
 * ones that are currently unmounted (`refetchType: "all"`), so reopening
 * a swap sheet or the program builder never serves a stale pool.
 */
export async function invalidateExerciseLibrary(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({
    predicate: (q) => isExerciseLibraryQueryKey(q.queryKey),
    refetchType: "all",
  });
}
