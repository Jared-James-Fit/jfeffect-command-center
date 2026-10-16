/**
 * What to do with a picked video before it uploads. Pure (no browser APIs),
 * so every decision here is unit tested.
 *
 *   original   send the file as it is: nothing trimmed off and it's already
 *              small or lean (no work, nothing to gain).
 *   copy       cut the selection out without re-encoding (a remux: ~instant,
 *              works on any phone, the start stays frame-exact through an MP4
 *              edit list). Used when the result is already lean or the phone
 *              can't encode video.
 *   transcode  cut the selection and re-encode it to 720p H.264 sized for the
 *              place it's going (the phone's own hardware encoder, WebCodecs).
 *   reject     can't be published from this phone as selected (the trimmer
 *              prevents this; it's the backstop).
 */
import { MIN_CLIP_SECONDS, SOURCE_MAX_BYTES, SOURCE_MAX_SECONDS, videoBudget, videoLimit, formatClock, limitWords, type VideoContext } from "@/lib/video-edit/limits";

export type SourceInfo = {
  duration: number;
  bytes: number;
  /** As displayed (rotation applied). */
  width: number;
  height: number;
  codec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  fps: number | null;
  container: "mp4" | "mov" | "webm" | "other";
};

/** The part of a video to publish, in seconds of the original. */
export type VideoTrim = { start: number; end: number };

/** 720p: sharp enough to judge depth and bar path, small enough for a gym's signal. */
export const TARGET_LONG_EDGE = 1280;
/** The long edge when a long clip has to squeeze into its budget. */
export const SMALL_LONG_EDGE = 960;
export const TARGET_VIDEO_BITRATE = 2_500_000;
export const MIN_VIDEO_BITRATE = 700_000;
export const AUDIO_BITRATE = 128_000;
export const MAX_FPS = 30;
/** Below this, sending as is beats any amount of work on the phone. */
export const MIN_BYTES_TO_COMPRESS = 4 * 1024 * 1024;
/** Container overhead (index, headers) on top of the media bytes. */
const MUX_OVERHEAD = 1.02;

export type VideoPlan =
  | { mode: "original" }
  | { mode: "copy"; start: number; end: number; estBytes: number }
  | {
      mode: "transcode";
      start: number;
      end: number;
      width: number;
      height: number;
      videoBitrate: number;
      frameRate?: number;
      estBytes: number;
      /** A copy of the selection also fits: if this phone encodes too slowly, send that instead. */
      copyFallback: { estBytes: number } | null;
    }
  | { mode: "reject"; reason: string };

export function bytesPerSecond(src: Pick<SourceInfo, "bytes" | "duration">): number {
  return src.duration > 0 ? src.bytes / src.duration : Infinity;
}

/** The selection as given, or the whole clip; always inside the clip. */
export function selectionOf(src: Pick<SourceInfo, "duration">, trim: VideoTrim | null | undefined): VideoTrim {
  if (!trim) return { start: 0, end: src.duration };
  const start = Math.max(0, Math.min(trim.start, src.duration));
  const end = Math.max(start, Math.min(trim.end, src.duration));
  return { start, end };
}

export function isWhole(src: Pick<SourceInfo, "duration">, trim: VideoTrim | null | undefined): boolean {
  if (!trim) return true;
  return trim.start <= 0.05 && trim.end >= src.duration - 0.05;
}

/** Roughly what a copy of the selection weighs. */
export function copyBytes(src: Pick<SourceInfo, "bytes" | "duration">, trim: VideoTrim | null | undefined): number {
  const sel = selectionOf(src, trim);
  if (isWhole(src, trim)) return src.bytes;
  return Math.ceil(bytesPerSecond(src) * (sel.end - sel.start) * MUX_OVERHEAD) + 64 * 1024;
}

/** Lean already: no bigger than 720p-ish at a modest bitrate (re-encoding would only cost time and quality). */
export function isLean(src: SourceInfo): boolean {
  const longEdge = Math.max(src.width, src.height);
  const bitrate = bytesPerSecond(src) * 8;
  const highFps = !!src.fps && src.fps > MAX_FPS + 2;
  return longEdge <= TARGET_LONG_EDGE && !highFps && bitrate <= TARGET_VIDEO_BITRATE * 1.5;
}

/** Plays as it is in the app's players. */
function sendable(src: SourceInfo): boolean {
  return src.container !== "other";
}

/**
 * The longest selection this phone can publish here: the place's limit, or
 * (a phone that can't encode video, so only a copy can go) as much as fits
 * its byte budget at the clip's own bitrate.
 */
export function maxSelectable(src: Pick<SourceInfo, "bytes" | "duration">, ctx: VideoContext, canEncode: boolean): number {
  const limit = Math.min(videoLimit(ctx), src.duration || videoLimit(ctx));
  if (canEncode) return limit;
  const fit = (videoBudget(ctx).target / MUX_OVERHEAD - 64 * 1024) / bytesPerSecond(src);
  return Math.max(Math.min(MIN_CLIP_SECONDS, src.duration), Math.min(limit, Math.floor(fit * 10) / 10));
}

/** Over what can go as it is: the trimmer has to open before anything uploads. */
export function needsTrim(src: Pick<SourceInfo, "bytes" | "duration">, ctx: VideoContext, canEncode: boolean): boolean {
  return src.duration > maxSelectable(src, ctx, canEncode) + 0.25;
}

/** What the trimmer starts on: the first stretch that can go (Instagram's default). */
export function defaultTrim(src: Pick<SourceInfo, "bytes" | "duration">, ctx: VideoContext, canEncode: boolean): VideoTrim {
  return { start: 0, end: Math.min(src.duration, maxSelectable(src, ctx, canEncode)) };
}

/** A picked file we can't take at all (before anything is decoded). */
export function sourceProblem(src: Pick<SourceInfo, "bytes" | "duration">): string | null {
  if (src.bytes > SOURCE_MAX_BYTES) return "That video is too big to open here.";
  if (!Number.isFinite(src.duration) || src.duration <= 0) return "Couldn't read that video. Try an MP4 or MOV clip.";
  if (src.duration > SOURCE_MAX_SECONDS + 1) return `Pick a video under ${limitWords(SOURCE_MAX_SECONDS)}, then trim it to the part you want.`;
  return null;
}

/** 720p (960 for a long clip squeezed into a small budget), never upscaled, even numbers. */
export function outputSize(src: Pick<SourceInfo, "width" | "height">, longEdge: number): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(src.width, src.height));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(src.width), height: even(src.height) };
}

export function planVideo(src: SourceInfo, trim: VideoTrim | null | undefined, ctx: VideoContext, caps: { canEncode: boolean }): VideoPlan {
  const sel = selectionOf(src, trim);
  const len = sel.end - sel.start;
  const limit = videoLimit(ctx);
  const budget = videoBudget(ctx);
  if (len > limit + 0.5) return { mode: "reject", reason: `${limitWords(limit)} max here. Trim it to the part you want.` };
  if (len < Math.min(MIN_CLIP_SECONDS, src.duration) - 0.05) return { mode: "reject", reason: "That's too short to post." };
  const whole = isWhole(src, trim);
  const copy = copyBytes(src, trim);
  const copyFits = copy <= budget.target && sendable(src);
  const small = copy < MIN_BYTES_TO_COMPRESS;
  // An MP4 / MOV copy starts on the exact frame (an edit list hides the lead-in from
  // the keyframe before it); WebM has no edit lists, so its copy starts on that keyframe.
  const exactCopy = whole || src.container !== "webm";

  // Nothing to gain from work on the phone.
  if (copyFits && (small || isLean(src)) && (exactCopy || !caps.canEncode)) {
    return whole ? { mode: "original" } : { mode: "copy", start: sel.start, end: sel.end, estBytes: copy };
  }
  if (!caps.canEncode) {
    if (copyFits) return whole ? { mode: "original" } : { mode: "copy", start: sel.start, end: sel.end, estBytes: copy };
    const most = maxSelectable(src, ctx, false);
    return { mode: "reject", reason: `This phone can't shrink video, so up to ${formatClock(most)} of this one can go. Trim it shorter.` };
  }

  // Re-encode, sized for its budget.
  const audio = src.hasAudio ? AUDIO_BITRATE : 0;
  const fitBitrate = Math.floor((budget.target * 8) / MUX_OVERHEAD / Math.max(len, 1)) - audio;
  let videoBitrate = Math.min(TARGET_VIDEO_BITRATE, fitBitrate);
  let longEdge = TARGET_LONG_EDGE;
  if (videoBitrate < 1_200_000) longEdge = SMALL_LONG_EDGE;
  if (videoBitrate < MIN_VIDEO_BITRATE) videoBitrate = MIN_VIDEO_BITRATE;
  const { width, height } = outputSize(src, longEdge);
  const estBytes = Math.ceil((((videoBitrate + audio) * len) / 8) * MUX_OVERHEAD);
  const frameRate = src.fps && src.fps > MAX_FPS + 2 ? MAX_FPS : undefined;
  return {
    mode: "transcode",
    start: sel.start,
    end: sel.end,
    width,
    height,
    videoBitrate,
    ...(frameRate ? { frameRate } : {}),
    estBytes,
    copyFallback: copyFits && exactCopy ? { estBytes: copy } : null,
  };
}

/**
 * Whether a re-encode still pays, from its measured pace. Sending the copy
 * instead wins once the encode is projected to take much longer than the
 * upload time it saves (bandwidth counts double: it's the athlete's data and
 * our storage). Never decided in the first few seconds (encoders warm up).
 */
export function encodeTooSlow(a: { elapsedMs: number; progress: number; copyBytes: number; outBytes: number; uplinkBytesPerSec: number }): boolean {
  if (a.elapsedMs < 4_000 || a.progress <= 0.02) return false;
  const projectedMs = a.elapsedMs / a.progress;
  const savedMs = (Math.max(0, a.copyBytes - a.outBytes) / Math.max(1, a.uplinkBytesPerSec)) * 1000;
  return projectedMs > Math.max(15_000, savedMs * 2);
}

/** Every encoder we try for, in order: H.264 plays everywhere. */
export const OUTPUT_VIDEO_CODEC = "avc" as const;
