export type ExerciseVideoSource =
  | { provider: "vimeo"; url: string; status: "ready" }
  | { provider: "youtube"; url: string; status: "fallback" }
  | { provider: null; url: null; status: "coming_soon" };

export function buildCleanVimeoEmbedUrl(vimeoVideoId: string): string {
  const params = new URLSearchParams({
    title: "0",
    byline: "0",
    portrait: "0",
    badge: "0",
    dnt: "1",
  });
  return `https://player.vimeo.com/video/${vimeoVideoId}?${params.toString()}`;
}

export function vimeoUrlFromId(vimeoVideoId: string): string {
  return `https://vimeo.com/${vimeoVideoId}`;
}

export function getExerciseVideoSource(exercise: any): ExerciseVideoSource {
  if (
    exercise?.video_provider === "vimeo" &&
    exercise?.vimeo_embed_url &&
    exercise?.video_migration_status === "published_with_vimeo"
  ) {
    return { provider: "vimeo", url: exercise.vimeo_embed_url, status: "ready" };
  }
  if (exercise?.youtube_fallback_allowed === true && exercise?.youtube_url) {
    return { provider: "youtube", url: exercise.youtube_url, status: "fallback" };
  }
  return { provider: null, url: null, status: "coming_soon" };
}

export const MIGRATION_STATUSES = [
  "youtube_pending",
  "vimeo_uploaded",
  "ready_for_review",
  "published_with_vimeo",
  "missing_vimeo",
  "quality_warning",
  "youtube_fallback_enabled",
] as const;

export type MigrationStatus = (typeof MIGRATION_STATUSES)[number];