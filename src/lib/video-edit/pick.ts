/**
 * A video was picked: read it, and if it's longer than its place allows (or
 * than this phone can send), open the trimmer before anything uploads.
 * Clips that already fit go straight through: no extra step.
 */
import { type VideoContext } from "@/lib/video-edit/limits";
import { isWhole, maxSelectable, needsTrim, sourceProblem, type SourceInfo, type VideoTrim } from "@/lib/video-edit/plan";
import { normalizeSelection } from "@/lib/video-edit/timeline";
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
  /**
   * The lift, found in the background (lift.ts): the trimmer starts on the
   * whole clip and glides to it once it's found, unless a handle was already
   * moved; "Use whole clip" puts it back. Null: no clear lift.
   */
  suggest?: (() => Promise<VideoTrim | null>) | null;
  /** The trimmer's title ("Send to Jared") and Done button ("Send"). */
  title?: string;
  doneLabel?: string;
};

/**
 * Open the trimmer on every clip, not only one that's too long: a quick look
 * with the lift found for you (a set filmed for the coach), one tap to send.
 */
export type TrimOffer = { suggestLift?: boolean; title?: string; doneLabel?: string };

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

/**
 * A part picked without the trimmer (the lift in one tap, the whole clip
 * back), held to the rules the trimmer holds a hand to: the place's limit and
 * what this phone can send, and on a clip it can only cut at keyframes, the
 * start moved back to one. What goes is always what the trimmer would send.
 */
export function fixedTrim(sel: VideoTrim): TrimFn {
  return async (req) => {
    const maxLen = maxSelectable(req.info, req.context, req.canEncode);
    const s = normalizeSelection(sel, maxLen, req.info.duration);
    if (!req.snapStart) return s;
    const k = await req.snapStart(s.start).catch(() => s.start);
    return k < s.start - 0.01 ? { start: k, end: Math.min(s.end, k + maxLen) } : s;
  };
}

/** The lift, found on the phone (loaded only when it's asked for). */
export function liftFinder(file: File): () => Promise<VideoTrim | null> {
  return () => import("@/lib/video-edit/lift").then((m) => m.findLift(file)).catch(() => null);
}

export async function pickVideo(
  file: File,
  context: VideoContext,
  opts: { trim?: TrimFn; step?: { index: number; count: number }; offer?: TrimOffer } = {},
): Promise<PickVideoResult> {
  const probe = await probeVideo(file);
  if (!probe) return { ok: false, reason: "Couldn't read that video. Try an MP4 or MOV clip." };
  const problem = sourceProblem(probe.info);
  if (problem) return { ok: false, reason: problem };
  const base: PickedVideo = { file, info: probe.info, canEncode: probe.canEncode, trim: null };
  const must = needsTrim(probe.info, context, probe.canEncode);
  // offered (a set for the coach): a quick look with the lift found, even when it fits
  if (!must && !(opts.offer && opts.trim)) return { ok: true, video: base };
  if (!opts.trim) return { ok: false, reason: "That video's too long for here. Trim it and pick it again." };
  const sel = await opts.trim({
    file,
    info: probe.info,
    canEncode: probe.canEncode,
    context,
    initial: null,
    step: opts.step,
    snapStart: snapFor(file, probe.info, probe.canEncode),
    suggest: opts.offer?.suggestLift || must ? liftFinder(file) : null,
    title: opts.offer?.title,
    doneLabel: opts.offer?.doneLabel,
  });
  if (!sel) return { ok: false, reason: "", cancelled: true };
  return { ok: true, video: { ...base, trim: isWhole(probe.info, sel) ? null : sel } };
}

/** Change an already picked clip's selection (the trimmer opens on the current one). */
export async function retrimVideo(v: PickedVideo, context: VideoContext, trim: TrimFn): Promise<PickedVideo | null> {
  const sel = await trim({
    file: v.file,
    info: v.info,
    canEncode: v.canEncode,
    context,
    initial: v.trim ?? { start: 0, end: v.info.duration },
    snapStart: snapFor(v.file, v.info, v.canEncode),
    // re-opened: the lift is offered, never moved to on its own (the handles are where they were left)
    suggest: liftFinder(v.file),
  });
  if (!sel) return null;
  return { ...v, trim: isWhole(v.info, sel) ? null : sel };
}
