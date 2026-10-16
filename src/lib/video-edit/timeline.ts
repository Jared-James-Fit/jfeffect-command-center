/**
 * The trimmer's timeline math (pure, unit tested): what part of the video the
 * filmstrip shows, where the handles can go, and how a drag moves them.
 *
 * Short videos show whole. A long one (a full session, up to 20 minutes)
 * shows a window 1.5x the longest selection, so the handles stay big and
 * precise, with the whole video in a thin overview strip under it for
 * jumping to the right set.
 */
import { MIN_CLIP_SECONDS } from "@/lib/video-edit/limits";
import type { VideoTrim } from "@/lib/video-edit/plan";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Seconds the filmstrip shows at once. */
export function viewSpan(duration: number, maxLen: number): number {
  if (duration <= Math.max(maxLen * 1.6, 15)) return duration;
  return Math.min(duration, Math.max(maxLen * 1.5, 10));
}

/** Whether the whole-video overview strip is needed. */
export function needsOverview(duration: number, maxLen: number): boolean {
  return viewSpan(duration, maxLen) < duration - 0.01;
}

export function clampView(viewStart: number, span: number, duration: number): number {
  return clamp(viewStart, 0, Math.max(0, duration - span));
}

/** The window centred on the selection. */
export function viewAround(sel: VideoTrim, span: number, duration: number): number {
  return clampView((sel.start + sel.end) / 2 - span / 2, span, duration);
}

export function timeToX(t: number, viewStart: number, span: number, width: number): number {
  return span > 0 ? ((t - viewStart) / span) * width : 0;
}

export function xToTime(x: number, viewStart: number, span: number, width: number): number {
  return width > 0 ? viewStart + (x / width) * span : viewStart;
}

/** Move the start handle to `t`: never past the end, never longer than allowed. */
export function setStart(sel: VideoTrim, t: number, maxLen: number, duration: number, minLen = MIN_CLIP_SECONDS): VideoTrim {
  const min = Math.min(minLen, duration);
  return { start: clamp(t, Math.max(0, sel.end - maxLen), Math.max(0, sel.end - min)), end: sel.end };
}

export function setEnd(sel: VideoTrim, t: number, maxLen: number, duration: number, minLen = MIN_CLIP_SECONDS): VideoTrim {
  const min = Math.min(minLen, duration);
  return { start: sel.start, end: clamp(t, Math.min(duration, sel.start + min), Math.min(duration, sel.start + maxLen)) };
}

/** Slide the whole selection, keeping its length. */
export function shiftSelection(sel: VideoTrim, delta: number, duration: number): VideoTrim {
  const len = sel.end - sel.start;
  const start = clamp(sel.start + delta, 0, Math.max(0, duration - len));
  return { start, end: start + len };
}

/** Put the selection's middle at `t` (a tap on the overview or outside the selection). */
export function centerSelectionOn(sel: VideoTrim, t: number, duration: number): VideoTrim {
  const len = sel.end - sel.start;
  return shiftSelection({ start: t - len / 2, end: t + len / 2 }, 0, duration);
}

/** A sane selection: inside the video, at least the minimum, at most the limit. */
export function normalizeSelection(sel: VideoTrim | null | undefined, maxLen: number, duration: number): VideoTrim {
  const s = sel ?? { start: 0, end: Math.min(duration, maxLen) };
  const start = clamp(s.start, 0, duration);
  let end = clamp(s.end, start, duration);
  if (end - start > maxLen) end = start + maxLen;
  if (end - start < Math.min(MIN_CLIP_SECONDS, duration)) end = Math.min(duration, start + Math.min(MIN_CLIP_SECONDS, duration));
  return { start: Math.max(0, Math.min(start, end - Math.min(MIN_CLIP_SECONDS, duration))), end };
}

/**
 * The filmstrip's frames: a fixed grid over the whole video (so frames stay
 * put and reuse what's made as the strip pans), just the ones in view.
 */
export function tileGrid(viewStart: number, span: number, tiles: number, duration: number): { t: number; at: number; step: number }[] {
  const n = Math.max(1, Math.round(tiles));
  const step = span / n;
  if (!(step > 0)) return [];
  const first = Math.max(0, Math.floor(viewStart / step));
  const out: { t: number; at: number; step: number }[] = [];
  for (let k = first; k * step < Math.min(duration, viewStart + span) + 1e-6; k++) {
    out.push({ t: Math.min(duration, (k + 0.5) * step), at: k * step, step });
  }
  return out;
}

/** How fast the strip pans while a handle is held at its edge (seconds per frame). */
export function edgePan(x: number, width: number, span: number, zone = 28): number {
  if (x < zone) return -span * 0.012 * ((zone - Math.max(0, x)) / zone + 0.3);
  if (x > width - zone) return span * 0.012 * ((Math.min(width, x) - (width - zone)) / zone + 0.3);
  return 0;
}
