import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The exercise library the coach's program builder reads (the template
 * editor and a client's block editor alike): every unarchived exercise, read
 * whole page by page, under one cache key with one set of columns.
 *
 * Why: both editors used to read it as one request capped at 10,000 rows,
 * which the API cuts at 1,000. The library holds about 2,040, ordered by
 * name, so every exercise after "Dumbbell One Arm Lateral Raise" (Hip
 * Thrust, Larsen Press, Wide-Grip Lat Pulldown…) was missing and its rows
 * read "Unnamed exercise". The two editors also shared the key with
 * different columns, so whichever loaded first decided whether demo videos
 * and volume data were there ("Videos 0/6", "0 effective" sets).
 */
export const BUILDER_EXERCISE_COLUMNS = [
  "id",
  "name",
  "muscle_group",
  "category",
  "tags",
  "equipment",
  "exercise_category",
  "is_competition_lift",
  "competition_lift_type",
  "movement_family",
  "video_url",
  "youtube_url",
  "vimeo_url",
  "primary_movement_pattern",
  "muscle_groups",
  "secondary_muscle_groups",
  "lift_family",
  "variation_type",
  "counts_toward_volume",
  "volume_multiplier",
  "default_measurement_type",
].join(", ");

export const BUILDER_EXERCISE_LIBRARY_KEY = ["exercises-min"] as const;

const PAGE = 1000;

export async function fetchBuilderExerciseLibrary(): Promise<any[]> {
  const all: any[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await supabase
      .from("exercises")
      .select(BUILDER_EXERCISE_COLUMNS)
      .eq("archived", false)
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as any[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

export function useBuilderExerciseLibrary() {
  return useQuery<any[]>({
    queryKey: BUILDER_EXERCISE_LIBRARY_KEY,
    queryFn: fetchBuilderExerciseLibrary,
    staleTime: 5 * 60_000,
  });
}
