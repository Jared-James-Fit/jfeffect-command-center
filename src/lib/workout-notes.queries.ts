import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WorkoutNoteEntry } from "@/lib/workout-notes";

const sb = supabase as any;

/** Everything a client has told their coach in workouts, newest first (staff, or the client). */
export function useClientWorkoutNotes(clientId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["client-workout-notes", clientId ?? null],
    enabled: enabled && !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<WorkoutNoteEntry[]> => {
      const { data, error } = await sb.rpc("client_workout_notes", { _client_id: clientId, _limit: 300 });
      if (error) throw error;
      return (data ?? []) as WorkoutNoteEntry[];
    },
  });
}
