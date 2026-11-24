import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ExerciseAlias } from "@/lib/exercise-library";

/** How long after the shell mounts the aliases wait, so the screen's own data goes first. */
const ALIAS_LOAD_AFTER_MS = 3000;

/**
 * Loads the exercise aliases once and registers them with the shared exercise
 * search, so "low bar" finds Competition Squat, "comp bench" finds Competition
 * Bench Press and "RDL" finds Romanian Deadlift in EVERY picker (builder, swap
 * sheet, add-exercise, inline editor, library) without each one loading them.
 *
 * Shares the ["exercise-aliases"] query with the library control center, so
 * editing an alias there refreshes the index here.
 *
 * It runs from the app shell on every screen, so it stays out of the way of a
 * launch: the read waits until the app has been idle a moment (no picker opens
 * in the first seconds of a launch), and the search engine (exercise-search.ts,
 * ~11 KB compressed) is loaded only to hand it the aliases, never with the shell.
 */
export function useExerciseAliasIndex(): void {
  const ready = useAfterIdle(ALIAS_LOAD_AFTER_MS);
  const { data } = useQuery({
    queryKey: ["exercise-aliases"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("exercise_aliases")
        .select("alias_key, alias_name, exercise_id, source")
        .order("alias_name");
      if (error) throw error;
      return (data ?? []) as ExerciseAlias[];
    },
    staleTime: 10 * 60_000,
    enabled: ready,
  });

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    void import("@/lib/exercise-search").then((m) => {
      if (!cancelled) m.setExerciseAliasIndex(data);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);
}

/** True once `ms` have passed and the browser has had an idle moment (a timer where there's no idle callback). */
function useAfterIdle(ms: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let idleId: number | null = null;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const t = window.setTimeout(() => {
      if (w.requestIdleCallback) idleId = w.requestIdleCallback(() => setReady(true), { timeout: 2000 });
      else setReady(true);
    }, ms);
    return () => {
      window.clearTimeout(t);
      if (idleId !== null) w.cancelIdleCallback?.(idleId);
    };
  }, [ms]);
  return ready;
}

export default useExerciseAliasIndex;
