/**
 * Who sees a workout's film, saved on the account
 * (community_profiles.auto_post_film): Crew or Coach only. Kept apart from
 * workout-film-client so Crew settings can read it without the logger's code.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useViewingAsClient } from "@/lib/client-impersonation";

const db = supabase as any;
const AUTO_KEY = ["community-film-auto"] as const;

/** Their choice: true = Crew (a finished workout's film posts by itself), false = Coach only. Crew until they pick. */
export function useFilmAutoPost(enabled = true) {
  const viewingAsClient = useViewingAsClient();
  const { data } = useQuery({
    queryKey: AUTO_KEY,
    enabled: enabled && !viewingAsClient,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data: on, error } = await db.rpc("community_auto_post_film");
      if (error) throw error;
      return on !== false;
    },
  });
  return data;
}

export function useSetFilmAutoPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await db.rpc("community_set_auto_post_film", { _on: on });
      if (error) throw error;
    },
    onMutate: (on) => qc.setQueryData(AUTO_KEY, on),
    onSettled: () => qc.invalidateQueries({ queryKey: AUTO_KEY }),
  });
}
