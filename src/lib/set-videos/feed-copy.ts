/**
 * A set video's copy for Crew (pure, tested). The coach gets the clip the
 * fastest way the phone can send it, which for an iPhone's 4K clip is the
 * original (its encoder can't shrink 4K in time: render.ts, encodeTooSlow),
 * ~50 MB for 30 seconds. Once the coach has it, the phone makes a 720p copy
 * of the same selection in the background for the workout film
 * (uploader.ts), sized for a workout post: 90 seconds, 50 MB.
 */
import { planVideo, type SourceInfo, type VideoPlan, type VideoTrim } from "@/lib/video-edit/plan";
import { setVideoStem } from "@/lib/set-videos/label";

export type FeedCopyPlan = Extract<VideoPlan, { mode: "transcode" }>;

/** Tries at a copy before the film just keeps the original. */
export const FEED_COPY_TRIES = 3;
/** A copy still encoding after this is given up on (the original stays on the film). */
export const FEED_COPY_MAX_MS = 10 * 60_000;
/** A copy only goes up when it's at most this share of what was sent (else nothing's gained). */
export const FEED_COPY_MAX_SHARE = 0.75;

/**
 * The copy to make, or null when what the coach got is already fit for the
 * feed (it was re-encoded to 720p, or it's small or lean), it's too long for
 * a workout post, or this phone can't encode video. Never falls back to the
 * original part way (there's no one waiting on it: slow is fine).
 */
export function feedCopyPlan(
  sentMode: "original" | "copy" | "transcode",
  info: SourceInfo,
  trim: VideoTrim | null | undefined,
  canEncode: boolean,
): FeedCopyPlan | null {
  if (sentMode === "transcode" || !canEncode) return null;
  const plan = planVideo(info, trim, "workout", { canEncode });
  if (plan.mode !== "transcode") return null;
  return { ...plan, copyFallback: null };
}

/** Whether a made copy is worth sending instead of what the coach got. */
export function feedCopyWorthIt(copyBytes: number, sentBytes: number): boolean {
  return copyBytes > 0 && copyBytes <= sentBytes * FEED_COPY_MAX_SHARE;
}

/** Next to the original in the coach chat's folder: <client>/set-videos/<job>-feed.<ext>. */
export function feedCopyPath(clientId: string, jobId: string, ext: string): string {
  return `${setVideoStem(clientId, jobId)}-feed.${ext}`;
}
