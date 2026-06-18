import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { VideoSet } from "@/lib/exercise-video";

const KEY = "exercise_video_set";

/**
 * Reads the global admin override for which exercise video set to display
 * across the app. Returns null when no override is set (per-exercise
 * `active_video_set` is used instead).
 */
export function useExerciseVideoSetGlobal() {
  return useQuery({
    queryKey: ["app_settings", KEY],
    staleTime: 60_000,
    queryFn: async (): Promise<VideoSet | null> => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", KEY)
        .maybeSingle();
      const raw = (data?.value as any) ?? null;
      const v = typeof raw === "string" ? raw : raw?.value;
      return v === "primary" || v === "secondary" ? v : null;
    },
  });
}

export async function setExerciseVideoSetGlobal(value: VideoSet | null) {
  if (value === null) {
    const { error } = await supabase.from("app_settings").delete().eq("key", KEY);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: KEY, value: value as any }, { onConflict: "key" });
  if (error) throw error;
}