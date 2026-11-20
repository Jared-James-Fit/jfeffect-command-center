/**
 * Exercise search for a picker (Nov 20 2026): the shared engine over the list
 * the screen already has, on every keystroke, plus the AI's read of a
 * description once typing pauses.
 *
 *   const s = useExerciseSearch(pool, query, { boost: recentBoost, limit: 60 });
 *   s.results            ranked local matches (instant)
 *   s.described          library exercises the AI says a description means
 *   s.describeState      "idle" | "loading" | "done" | "none" | "unavailable"
 *
 * The AI is asked only for a description (or a few words nothing matches by
 * name), after `DESCRIBE_PAUSE_MS` without a keystroke, once per description
 * (cached), and its names are found in `pool`, so it can only ever suggest an
 * exercise the picker would have offered anyway.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  searchEligibleExercises,
  warmExerciseSearchIndex,
  type SearchableExercise,
  type SearchResult,
} from "@/lib/exercise-search";
import {
  descriptionKey,
  matchGuesses,
  shouldAskAi,
  type DescribedMatch,
} from "@/lib/exercise-identify";
import { identifyExerciseFn } from "@/lib/exercise-identify.functions";

export const DESCRIBE_PAUSE_MS = 650;

export type DescribeState = "idle" | "loading" | "done" | "none" | "unavailable" | "busy";

export type DescribedResult<T extends SearchableExercise> = {
  described: DescribedMatch<T>[];
  describeState: DescribeState;
};

/** Index a pool's names in idle time, so the first keystroke is as fast as the rest. */
export function useWarmExerciseIndex(pool: readonly SearchableExercise[] | null | undefined): void {
  useEffect(() => {
    if (!pool || pool.length === 0 || typeof window === "undefined") return;
    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void, o?: { timeout: number }) => number)
      | undefined;
    const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
    if (idle) {
      const id = idle(() => warmExerciseSearchIndex(pool), { timeout: 1500 });
      return () => cancelIdle?.(id);
    }
    const t = window.setTimeout(() => warmExerciseSearchIndex(pool), 200);
    return () => window.clearTimeout(t);
  }, [pool]);
}

function usePaused(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * The AI half on its own, for a picker that runs its own local search
 * (QuickSwap): give it the pool, the query and the local result.
 */
export function useDescribedExercises<T extends SearchableExercise>(
  pool: readonly T[],
  query: string,
  local: SearchResult<T> | null,
  opts: { enabled?: boolean } = {},
): DescribedResult<T> {
  const enabled = opts.enabled !== false;
  const paused = usePaused(query.trim(), DESCRIBE_PAUSE_MS);
  const settled = paused === query.trim();
  const wanted =
    enabled && !!local && local.parsed.raw.trim() === query.trim() && shouldAskAi(query, local);
  const identify = useServerFn(identifyExerciseFn);
  const key = descriptionKey(paused);
  const ask = useQuery({
    queryKey: ["exercise-identify", key],
    enabled: wanted && settled && key.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 0,
    queryFn: () => identify({ data: { text: paused } }),
  });
  const described = useMemo(() => {
    if (!wanted || !ask.data || !ask.data.ok) return [];
    return matchGuesses(pool, ask.data.guesses);
  }, [wanted, ask.data, pool]);

  let describeState: DescribeState = "idle";
  if (wanted) {
    if (!settled) describeState = ask.data ? "loading" : "idle";
    else if (ask.isFetching) describeState = "loading";
    else if (ask.isError || (ask.data && !ask.data.ok && ask.data.reason === "unavailable"))
      describeState = "unavailable";
    else if (ask.data && !ask.data.ok && ask.data.reason === "busy") describeState = "busy";
    else if (ask.data?.ok) describeState = described.length ? "done" : "none";
  }
  return { described, describeState };
}

export type ExerciseSearchOptions = {
  limit?: number;
  boost?: ReadonlyMap<string, number> | null;
  excludeId?: string | null;
  /** Fewest characters before searching (else `results` is null). */
  minChars?: number;
  /** Ask the AI about descriptions (default on). */
  describe?: boolean;
};

export function useExerciseSearch<T extends SearchableExercise>(
  pool: readonly T[],
  query: string,
  opts: ExerciseSearchOptions = {},
): { local: SearchResult<T> | null } & DescribedResult<T> {
  const { limit = 60, boost = null, excludeId = null, minChars = 2, describe = true } = opts;
  useWarmExerciseIndex(pool);
  const q = query.trim();
  const local = useMemo(
    () =>
      q.length >= minChars
        ? searchEligibleExercises(pool, query, { limit, boost, excludeId })
        : null,
    [pool, query, q, minChars, limit, boost, excludeId],
  );
  const eligible = useMemo(
    () =>
      excludeId
        ? pool.filter((e) => e.id !== excludeId && e.archived !== true)
        : pool.filter((e) => e.archived !== true),
    [pool, excludeId],
  );
  const ai = useDescribedExercises(eligible, query, local, { enabled: describe });
  return { local, ...ai };
}

/** Recent exercise ids as a boost map: the newest counts most. */
export function recentBoost(ids: readonly string[] | null | undefined): Map<string, number> | null {
  if (!ids || ids.length === 0) return null;
  const m = new Map<string, number>();
  ids.forEach((id, i) => m.set(id, Math.max(0.3, 1 - i * 0.05)));
  return m;
}

/**
 * The one quiet line over a picker's list, when it needs one: under the AI's
 * suggestions, what the list is; for a description or a name the library
 * doesn't have, that these are only the closest.
 */
export function resultsNote(local: SearchResult<SearchableExercise> | null, describedCount: number): string | null {
  if (!local) return null;
  if (describedCount > 0) return "Other close matches";
  if (local.parsed.descriptive) return "Closest names for your description";
  if (!local.hasExactMatches) return "No exact match. The closest:";
  return null;
}
