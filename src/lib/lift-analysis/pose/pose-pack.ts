/**
 * The body's read, stored (pure, tested in pose-pack.test.ts).
 *
 * The server reads every analysable set video's body once, on upload
 * (scripts/velocity-worker: the app's own runPose in headless Chromium) and
 * keeps the track in `pl_set_video_poses`, so Technique opens on it at once
 * instead of downloading a 24 MB model and reading the clip on the phone.
 *
 * A track is 33 landmarks a frame (x, y and visibility), packed as Int16:
 * positions to 1/16000 of the frame (well under a pixel at any phone size, and
 * room for a landmark the model puts off the edge), visibility to 1/32000.
 * A frame with no body is every value at -32768. Times are seconds to the ms.
 */
import { LANDMARKS, type PoseFrame, type PoseTrack } from "@/lib/lift-analysis/pose/skeleton";
import type { TechniqueRead } from "@/lib/lift-analysis/pose/technique";

export const POSE_PACK_VERSION = 1;
/** What a stored read is called (bump when the read itself changes). */
export const POSE_ENGINE = "pose/1";

const POS_SCALE = 16000;
const VIS_SCALE = 32000;
const NONE = -32768;
const PER_FRAME = 3 * LANDMARKS;

export type PackedPose = {
  v: typeof POSE_PACK_VERSION;
  /** The frame the shares are of (px). */
  w: number;
  h: number;
  t: number[];
  /** Base64 of Int16 values, PER_FRAME a frame. */
  f: string;
};

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const clamp16 = (n: number) => Math.max(-32767, Math.min(32767, Math.round(n)));

export function packPose(track: PoseTrack): PackedPose {
  const n = track.frames.length;
  const vals = new Int16Array(n * PER_FRAME);
  for (let i = 0; i < n; i++) {
    const f = track.frames[i];
    const o = i * PER_FRAME;
    if (!f) {
      vals.fill(NONE, o, o + PER_FRAME);
      continue;
    }
    for (let j = 0; j < LANDMARKS; j++) {
      const x = f[3 * j];
      const y = f[3 * j + 1];
      const v = f[3 * j + 2];
      vals[o + 3 * j] = Number.isFinite(x) ? clamp16(x * POS_SCALE) : 0;
      vals[o + 3 * j + 1] = Number.isFinite(y) ? clamp16(y * POS_SCALE) : 0;
      // a landmark the model didn't give is visibility 0 (never -1: that's "no body")
      vals[o + 3 * j + 2] = Number.isFinite(v) && v > 0 ? clamp16(v * VIS_SCALE) : 0;
    }
  }
  // little-endian on every platform that runs this (and fixed here so a server and a phone agree)
  const bytes = new Uint8Array(vals.length * 2);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < vals.length; i++) dv.setInt16(i * 2, vals[i], true);
  return {
    v: POSE_PACK_VERSION,
    w: track.frame.w,
    h: track.frame.h,
    t: track.t.map((x) => Math.round(x * 1000) / 1000),
    f: toBase64(bytes),
  };
}

/** The track back from what was stored; null when it isn't one this app can read. */
export function unpackPose(p: unknown): PoseTrack | null {
  if (!p || typeof p !== "object") return null;
  const q = p as Partial<PackedPose>;
  if (q.v !== POSE_PACK_VERSION || !Array.isArray(q.t) || typeof q.f !== "string") return null;
  const w = Number(q.w);
  const h = Number(q.h);
  if (!(w > 0) || !(h > 0)) return null;
  const bytes = fromBase64(q.f);
  const n = q.t.length;
  if (bytes.length !== n * PER_FRAME * 2) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: (PoseFrame | null)[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * PER_FRAME;
    if (dv.getInt16(o * 2, true) === NONE) {
      frames.push(null);
      continue;
    }
    const f = new Float32Array(PER_FRAME);
    for (let j = 0; j < LANDMARKS; j++) {
      f[3 * j] = dv.getInt16((o + 3 * j) * 2, true) / POS_SCALE;
      f[3 * j + 1] = dv.getInt16((o + 3 * j + 1) * 2, true) / POS_SCALE;
      f[3 * j + 2] = dv.getInt16((o + 3 * j + 2) * 2, true) / VIS_SCALE;
    }
    frames.push(f);
  }
  return { frame: { w, h }, t: q.t.map(Number), frames };
}

/** How far either side of the set's window the body is read (s): Technique's own padding. */
export const POSE_PAD_S = 0.5;
/** The most of a clip read when there's no set window (s): runPose's own cap. */
export const POSE_WHOLE_S = 90;

export type PoseWindow = {
  start: number;
  end: number;
  whole: boolean;
  /** The clip's length (s) when known: a window that runs to the clip's end covers anything past it. */
  duration?: number | null;
};

/**
 * The part of the clip the body is read over: the bar's set window with half a
 * second either side (what Technique reads on a phone), else the clip from its
 * start (a read with no window, or none at all).
 */
export function poseWindowFor(
  analysis: { window?: { start?: number; end?: number } | null } | null | undefined,
  durationS?: number | null,
): PoseWindow {
  const s = Number(analysis?.window?.start);
  const e = Number(analysis?.window?.end);
  if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
    const end = e + POSE_PAD_S;
    return {
      start: Math.max(0, s - POSE_PAD_S),
      end: durationS && durationS > 0 ? Math.min(end, durationS) : end,
      whole: false,
      duration: durationS && durationS > 0 ? durationS : null,
    };
  }
  const end = durationS && durationS > 0 ? Math.min(durationS, POSE_WHOLE_S) : POSE_WHOLE_S;
  return { start: 0, end, whole: true, duration: durationS && durationS > 0 ? durationS : null };
}

/** Slack (s) a stored read may fall short of the window by and still be used. */
const COVER_SLACK_S = 0.3;

/**
 * Whether a stored read covers what Technique would read for this analysis:
 * the set's window (with most of its padding), or, with no window, a read of
 * the clip from its start.
 */
export function storedPoseCovers(
  stored: PoseWindow | null | undefined,
  analysis: { window?: { start?: number; end?: number } | null } | null | undefined,
): boolean {
  if (!stored || !(stored.end > stored.start)) return false;
  const want = poseWindowFor(analysis);
  if (want.whole) {
    const end = stored.duration && stored.duration > 0 ? Math.min(POSE_WHOLE_S, stored.duration) : POSE_WHOLE_S;
    return stored.start <= 0.05 && (stored.whole || stored.end >= end - COVER_SLACK_S);
  }
  const end = stored.duration && stored.duration > 0 ? Math.min(want.end, stored.duration) : want.end;
  return stored.start <= want.start + COVER_SLACK_S && stored.end >= end - COVER_SLACK_S;
}

/** What's kept of a technique read beside the track: what was seen, never the definitions. */
export type PoseSummary = Pick<TechniqueRead, "lift" | "view" | "side" | "facing" | "coverage" | "angles" | "reps" | "observations" | "limits">;

export function poseSummary(read: TechniqueRead): PoseSummary {
  const round = (n: number | null) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
  return {
    lift: read.lift,
    view: read.view,
    side: read.side,
    facing: read.facing,
    coverage: Math.round(read.coverage * 1000) / 1000,
    angles: read.angles,
    reps: read.reps.map((r) => ({
      n: r.n,
      at: { start: round(r.at.start)!, turn: round(r.at.turn)!, end: round(r.at.end)! },
      m: Object.fromEntries(Object.entries(r.m).map(([k, v]) => [k, round(v)])),
    })),
    observations: read.observations.map((o) => ({ id: o.id, text: o.text, t: round(o.t), rep: o.rep })),
    limits: read.limits,
  };
}
