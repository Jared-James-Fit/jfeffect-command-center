/**
 * How long a video may be, where.
 *
 * Two different limits: what you may PICK (a whole training session off the
 * phone, up to 20 minutes) and what gets PUBLISHED (the part you trim it to,
 * which depends on where it's going). Only the trimmed part ever leaves the
 * phone. The server re-reads every uploaded video and the database refuses a
 * post or message whose video is longer than its place allows
 * (20261210090000_video_limits.sql: media_video_checks + media_video_allowed),
 * so these numbers must match that migration.
 */

export type VideoContext = "post" | "story" | "workout" | "comment" | "dm" | "coach" | "demo";

/** The longest recording you can pick to trim from. */
export const SOURCE_MAX_SECONDS = 20 * 60;
/** Never read a file bigger than this (a 20 minute 4K60 clip is ~8 GB). */
export const SOURCE_MAX_BYTES = 16 * 1024 * 1024 * 1024;
/** The camera's hold-to-film clip (a story's length). */
export const RECORD_MAX_SECONDS = 60;
/** Shortest selection the trimmer allows. */
export const MIN_CLIP_SECONDS = 1;

type Budget = { target: number; max: number };
const MiB = 1024 * 1024;

/**
 * Bytes a published video may take. `target` is what we encode for, `max`
 * is the hard limit (the server's, and for Crew the storage bucket's own
 * 50 MB). 720p H.264 at ~2 Mbps is ~15 MB a minute, so every published
 * length fits with room to spare.
 */
export const VIDEO_BUDGETS = {
  crew: { target: 44 * MiB, max: 50 * MiB },
  dm: { target: 90 * MiB, max: 120 * MiB },
  coach: { target: 140 * MiB, max: 200 * MiB },
} satisfies Record<string, Budget>;

export const VIDEO_LIMITS: Record<VideoContext, { seconds: number; budget: keyof typeof VIDEO_BUDGETS; label: string }> = {
  post: { seconds: 180, budget: "crew", label: "Posts" },
  story: { seconds: 60, budget: "crew", label: "Stories" },
  workout: { seconds: 90, budget: "crew", label: "Workout recaps" },
  comment: { seconds: 60, budget: "crew", label: "Comments" },
  dm: { seconds: 300, budget: "dm", label: "Messages" },
  coach: { seconds: 600, budget: "coach", label: "Messages with your coach" },
  // exercise demos are links today (Vimeo / YouTube); kept so an upload path gets the same rule
  demo: { seconds: 180, budget: "coach", label: "Exercise demos" },
};

/** Seconds a published video may run in this place. */
export function videoLimit(ctx: VideoContext): number {
  return VIDEO_LIMITS[ctx].seconds;
}

export function videoBudget(ctx: VideoContext): Budget {
  return VIDEO_BUDGETS[VIDEO_LIMITS[ctx].budget];
}

/** "0:42", "3:00", "12:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "60 seconds", "90 seconds", "3 minutes", "10 minutes", "20 minutes". */
export function limitWords(seconds: number): string {
  if (seconds <= 90) return `${Math.round(seconds)} seconds`;
  const m = seconds / 60;
  return Number.isInteger(m) ? `${m} minutes` : `${formatClock(seconds)}`;
}
