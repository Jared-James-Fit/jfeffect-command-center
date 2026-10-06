import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setExerciseAliasIndex } from "@/lib/exercise-search";
import type { ExerciseAlias } from "@/lib/exercise-library";

/**
 * Loads the exercise aliases once and registers them with the shared exercise
 * search, so "low bar" finds Competition Squat, "comp bench" finds Competition
 * Bench Press and "RDL" finds Romanian Deadlift in EVERY picker (builder, swap
 * sheet, add-exercise, inline editor, library) without each one loading them.
 *
 * Shares the ["exercise-aliases"] query with the library control center, so
 * editing an alias there refreshes the index here.
 */
export function useExerciseAliasIndex(): void {
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
  });

  useEffect(() => {
    if (data) setExerciseAliasIndex(data);
  }, [data]);
}

export default useExerciseAliasIndex;
