import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildCardioStory, type CardioStoryData } from "@/lib/cardio-story";

/**
 * The athlete's own cardio for the Cardio story overlays: their recent
 * cardio_completions and active cardio_targets (the same tables the cardio
 * card and analytics read), read once per minute while the story camera is
 * open. Null when they've never completed a session (the overlays then show
 * only their line and the brand, never invented numbers).
 */
export function useCardioStory(enabled: boolean): CardioStoryData | null {
  const { data } = useQuery({
    queryKey: ["cardio-story-data"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<CardioStoryData | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data: client } = await supabase.from("clients").select("id").eq("user_id", auth.user.id).maybeSingle();
      if (!client) return null;
      const since = new Date(Date.now() - 60 * 86_400_000);
      const sinceISO = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
      const [comp, targets] = await Promise.all([
        supabase
          .from("cardio_completions")
          .select("completed_date, completed, skipped, duration_minutes, incline, avg_speed, avg_heart_rate, steps, distance, distance_unit, cardio_target_id")
          .eq("client_id", client.id)
          .eq("completed", true)
          .gte("completed_date", sinceISO)
          .order("completed_date", { ascending: false })
          .limit(120),
        supabase.from("cardio_targets").select("id, frequency_per_week, heart_rate_zone").eq("client_id", client.id).eq("enabled", true).eq("status", "Active").is("program_name", null),
      ]);
      if (comp.error) return null;
      return buildCardioStory({ completions: comp.data ?? [], targets: targets.data ?? [], now: new Date() });
    },
  });
  return data ?? null;
}
