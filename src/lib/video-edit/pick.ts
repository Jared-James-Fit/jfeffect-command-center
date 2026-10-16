/**
 * A video was picked: read it, and if it's longer than its place allows (or
 * than this phone can send), open the trimmer before anything uploads.
 * Clips that already fit go straight through: no extra step.
 */
import { type VideoContext } from "@/lib/video-edit/limits";
import { isWhole, needsTrim, sourceProblem, type SourceInfo, type VideoTrim } from "@/lib/video-edit/plan";
import { keyframeFinder, loadMediabunny, probeVideo } from "@/lib/video-edit/probe";

export type PickedVideo = {
  file: File;
  info: SourceInfo;
  /** This phone can re-encode it (otherwise only a straight cut can go). */
  canEncode: boolean;
  /** The part to publish; null = all of it. */
  trim: VideoTrim | null;
};

export type TrimRequest = {
  file: File;
  info: SourceInfo;
  canEncode: boolean;
  context: VideoContext;
  /** Where the handles start (a re-edit keeps the last selection). */
  initial: VideoTrim | null;
  /** "Clip 2 of 3" when several were picked at once. */
  step?: { index: number; count: number };
  /**
   * Set when this clip can only be cut on keyframes (a WebM on a phone that
   * can't re-encode): the start snaps back to the keyframe at or before it, so
   * what the trimmer shows is exactly what goes (and nothing is lost).
   */
  snapStart?: ((t: number) => Promise<number>) | null;
};

/** Opens the trimmer; resolves the selection, or null when they backed out. */
export type TrimFn = (req: TrimRequest) => Promise<VideoTrim | null>;

export type PickVideoResult = { ok: true; video: PickedVideo } | { ok: false; reason: string; cancelled?: boolean };

/** Start loading the media library while the picker is open, so the first clip doesn't wait on it. */
export function preloadVideoEngine() {
  if (typeof window !== "undefined") void loadMediabunny().catch(() => {});
}

/** Only a WebM that can't be re-encoded is cut on keyframes (an MP4 / MOV cut starts on the exact frame). */
function snapFor(file: File, info: SourceInfo, canEncode: boolean) {
  return !canEncode && info.container === "webm" ? keyframeFinder(file) : null;
}

export function looksLikeVideo(file: { type: string; name?: string }): boolean {
  const type = (file.type.split(";")[0] ?? "").trim().toLowerCase();
  return type.startsWith("video/") || (!type && !!file.name && /\.(mp4|m4v|mov|qt|webm|3gp|mkv)$/i.test(file.name));
}

export async function pickVideo(file: File, context: VideoContext, opts: { trim?: TrimFn; step?: { index: number; count: number } } = {}): Promise<PickVideoResult> {
  const probe = await probeVideo(file);
  if (!probe) return { ok: false, reason: "Couldn't read that video. Try an MP4 or MOV clip." };
  const problem = sourceProblem(probe.info);
  if (problem) return { ok: false, reason: problem };
  const base: PickedVideo = { file, info: probe.info, canEncode: probe.canEncode, trim: null };
  if (!needsTrim(probe.info, context, probe.canEncode)) return { ok: true, video: base };
  if (!opts.trim) return { ok: false, reason: "That video's too long for here. Trim it and pick it again." };
  const sel = await opts.trim({ file, info: probe.info, canEncode: probe.canEncode, context, initial: null, step: opts.step, snapStart: snapFor(file, probe.info, probe.canEncode) });
  if (!sel) return { ok: false, reason: "", cancelled: true };
  return { ok: true, video: { ...base, trim: isWhole(probe.info, sel) ? null : sel } };
}

/** Change an already picked clip's selection (the trimmer opens on the current one). */
export async function retrimVideo(v: PickedVideo, context: VideoContext, trim: TrimFn): Promise<PickedVideo | null> {
  const sel = await trim({ file: v.file, info: v.info, canEncode: v.canEncode, context, initial: v.trim ?? { start: 0, end: v.info.duration }, snapStart: snapFor(v.file, v.info, v.canEncode) });
  if (!sel) return null;
  return { ...v, trim: isWhole(v.info, sel) ? null : sel };
}
