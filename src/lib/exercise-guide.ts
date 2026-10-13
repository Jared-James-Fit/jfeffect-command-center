import { supabase } from "@/integrations/supabase/client";
import { getExerciseVideoSource, type VideoSet } from "@/lib/exercise-video";

/**
 * The How To guide for one exercise: its demo video, cues and mistakes. One
 * fetch (cached 10 min) that the How To button starts on touch-down, so the
 * sheet opens with the video already on its way.
 */
const VIDEO_COLUMNS =
  "video_url,vimeo_embed_url,secondary_vimeo_embed_url,youtube_url,active_video_set,video_provider,video_migration_status,youtube_fallback_allowed";
const GUIDE_COLUMNS = `id,name,${VIDEO_COLUMNS},cues,common_mistakes,muscle_group,category,demo_exercise_id`;

type VideoFields = {
  video_url: string | null;
  vimeo_embed_url: string | null;
  secondary_vimeo_embed_url: string | null;
  youtube_url: string | null;
  active_video_set: string | null;
  video_provider: string | null;
  video_migration_status: string | null;
  youtube_fallback_allowed: boolean | null;
};

export type ExerciseGuide = VideoFields & {
  id: string;
  name: string | null;
  cues: string | string[] | null;
  common_mistakes: string | string[] | null;
  muscle_group: string | null;
  category: string | null;
  demo_exercise_id: string | null;
  /** Its own video isn't uploaded yet: the closest exercise's demo stands in. */
  borrowed: (VideoFields & { name: string }) | null;
};

export const exerciseGuideKey = (exerciseId: string | null, fallbackName: string) =>
  ["workout-exercise-guide", exerciseId ?? fallbackName] as const;

const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";

/** True when the row carries no playable video of its own. */
export function hasNoOwnVideo(e: Partial<VideoFields> | null | undefined): boolean {
  return !e || (blank(e.video_url) && blank(e.vimeo_embed_url) && blank(e.secondary_vimeo_embed_url) && blank(e.youtube_url));
}

export async function fetchExerciseGuide(exerciseId: string | null, fallbackName: string): Promise<ExerciseGuide | null> {
  const db = supabase as any;
  // Unlinked rows resolve through the library (exact name or alias) so an
  // alias shows its canonical exercise's demo video.
  let id = exerciseId ?? null;
  if (!id && fallbackName) {
    const { data: resolved } = await db.rpc("resolve_exercise_id", { _name: fallbackName });
    id = (resolved as string | null) ?? null;
  }
  const query = db.from("exercises").select(GUIDE_COLUMNS);
  const { data, error } = id ? await query.eq("id", id).maybeSingle() : await query.eq("name", fallbackName).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  let borrowed: ExerciseGuide["borrowed"] = null;
  if (hasNoOwnVideo(data) && data.demo_exercise_id) {
    const { data: demo } = await db.from("exercises").select(`name,${VIDEO_COLUMNS}`).eq("id", data.demo_exercise_id).maybeSingle();
    if (demo && !hasNoOwnVideo(demo)) borrowed = demo;
  }
  return { ...data, borrowed } as ExerciseGuide;
}

/**
 * The URL to play: the published source (Vimeo, or the YouTube fallback when
 * allowed), else whatever link is on the row. Null = no demo yet.
 */
export function guideVideoUrl(e: Partial<VideoFields> | null | undefined, globalSet: VideoSet | null = null): string | null {
  if (!e) return null;
  const src = getExerciseVideoSource(e, { globalOverride: globalSet });
  if (src.status !== "coming_soon" && src.url) return src.url;
  const direct = [e.vimeo_embed_url, e.video_url, e.youtube_url].find((u) => !blank(u));
  return direct ? String(direct).trim() : null;
}
