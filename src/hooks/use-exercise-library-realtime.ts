import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  reconcileExerciseLibraryChange,
  type CachedExercise,
  type ExerciseLibraryChange,
} from "@/lib/exercise-library-cache";

/**
 * Keeps every mounted exercise selector current when a coach creates, edits,
 * archives, or removes a library exercise in another tab or app session.
 *
 * Exercise search is intentionally local for mobile performance. Realtime is
 * therefore the canonical bridge between the authoritative database and those
 * in-memory search pools; it is mounted once in the authenticated app shell.
 */
export function useExerciseLibraryRealtime(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("exercise-library-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exercises" },
        (payload) => {
          const change: ExerciseLibraryChange = {
            eventType: payload.eventType as ExerciseLibraryChange["eventType"],
            newRow: payload.eventType === "DELETE" ? null : (payload.new as CachedExercise),
            oldRow: (payload.old as Pick<CachedExercise, "id">) ?? null,
          };
          reconcileExerciseLibraryChange(queryClient, change);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

export default useExerciseLibraryRealtime;
