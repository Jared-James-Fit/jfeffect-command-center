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

export type CachedExercise = { id: string; name?: string | null; archived?: boolean | null } & Record<string, unknown>;

export type ExerciseLibraryChange = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  newRow: CachedExercise | null;
  oldRow: Pick<CachedExercise, "id"> | null;
};

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
export function removeExerciseFromLibraryCaches(qc: QueryClient, exerciseId: string): void {
  qc.setQueriesData<CachedExercise[]>(
    {
      predicate: (query) => {
        const first = query.queryKey[0];
        return typeof first === "string" && RAW_EXERCISE_LIST_PREFIXES.has(first);
      },
    },
    (current) => Array.isArray(current) ? current.filter((row) => row?.id !== exerciseId) : current,
  );
}

/**
 * Apply a Supabase realtime exercise mutation to the currently mounted search
 * pools before refetching derived lists. This keeps an open client add/swap
 * sheet usable immediately when another tab or coach creates an exercise.
 */
export function reconcileExerciseLibraryChange(
  qc: QueryClient,
  change: ExerciseLibraryChange,
): void {
  const id = change.newRow?.id ?? change.oldRow?.id;
  if (!id) return;

  if (change.eventType === "DELETE" || change.newRow?.archived === true) {
    removeExerciseFromLibraryCaches(qc, id);
  } else if (change.newRow) {
    upsertExerciseInLibraryCaches(qc, change.newRow);
  }

  // Suggestions and any cache projection that does not hold raw exercise rows
  // are refreshed immediately after the local raw-pool reconciliation.
  void invalidateExerciseLibrary(qc);
}

export async function invalidateExerciseLibrary(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({
    predicate: (q) => isExerciseLibraryQueryKey(q.queryKey),
    refetchType: "all",
  });
}
