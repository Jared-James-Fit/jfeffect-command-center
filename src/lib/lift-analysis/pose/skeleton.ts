/**
 * The athlete's body through a set, from an on-device pose model
 * (pose-run.ts: MediaPipe's BlazePose, 33 landmarks a frame), and what can be
 * read from it honestly (pure, tested in pose-technique.test.ts).
 *
 * A landmark is where the model puts a joint's centre, with how visible it
 * thinks the joint is. Nothing here is a measurement of a joint the camera
 * didn't see: an angle needs every point it's made of over `VIS_MIN`, a gap
 * longer than `MAX_GAP_S` is left empty, and sagittal angles (knee, hip,
 * elbow, torso, shin) only mean what they say when the camera is side-on
 * (`viewOf`): a front or rear view can show side-to-side movement instead.
 * Positions are shares of the analysed frame (0…1), the bar path's own
 * units, so both draw on the same canvas.
 */

/** BlazePose's landmark numbers for the joints a lift is read from. */
export const J = {
  nose: 0,
  lEar: 7,
  rEar: 8,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lToe: 31,
  rToe: 32,
} as const;

export const LANDMARKS = 33;

/** A joint's visibility (the model's own 0…1) below which it's never used for a number. */
export const VIS_MIN = 0.6;
/** Below this it isn't drawn either. */
export const DRAW_VIS_MIN = 0.45;
/** A gap in the body's track longer than this (s) is left empty, never bridged. */
export const MAX_GAP_S = 0.35;

/** The lines of the skeleton, drawn thin between joint dots. */
export const BONES: [number, number][] = [
  [J.lShoulder, J.rShoulder],
  [J.lShoulder, J.lElbow],
  [J.lElbow, J.lWrist],
  [J.rShoulder, J.rElbow],
  [J.rElbow, J.rWrist],
  [J.lShoulder, J.lHip],
  [J.rShoulder, J.rHip],
  [J.lHip, J.rHip],
  [J.lHip, J.lKnee],
  [J.lKnee, J.lAnkle],
  [J.rHip, J.rKnee],
  [J.rKnee, J.rAnkle],
  [J.lAnkle, J.lHeel],
  [J.lHeel, J.lToe],
  [J.lAnkle, J.lToe],
  [J.rAnkle, J.rHeel],
  [J.rHeel, J.rToe],
  [J.rAnkle, J.rToe],
];

/** The joints drawn as dots. */
export const DOTS = [
  J.nose,
  J.lShoulder,
  J.rShoulder,
  J.lElbow,
  J.rElbow,
  J.lWrist,
  J.rWrist,
  J.lHip,
  J.rHip,
  J.lKnee,
  J.rKnee,
  J.lAnkle,
  J.rAnkle,
  J.lHeel,
  J.rHeel,
  J.lToe,
  J.rToe,
];

/** One frame's landmarks: x, y (shares of the frame) and visibility, 3 numbers a landmark. */
export type PoseFrame = Float32Array;

export type PoseTrack = {
  /** The frame the shares are of (px), for angles and lengths. */
  frame: { w: number; h: number };
  t: number[];
  /** null: no body found in that frame. */
  frames: (PoseFrame | null)[];
};

export type Side = "left" | "right";
export type CameraView = "side" | "front" | "oblique" | "unknown";

export type Pt = { x: number; y: number; v: number };

export function point(f: PoseFrame | null, j: number): Pt | null {
  if (!f) return null;
  const v = f[3 * j + 2];
  if (!(v >= 0)) return null;
  return { x: f[3 * j], y: f[3 * j + 1], v };
}

/** A joint that's visible enough to read a number from. */
export function seen(f: PoseFrame | null, j: number, min = VIS_MIN): Pt | null {
  const p = point(f, j);
  return p && p.v >= min ? p : null;
}

const SIDE_JOINTS: Record<Side, number[]> = {
  left: [J.lShoulder, J.lElbow, J.lWrist, J.lHip, J.lKnee, J.lAnkle],
  right: [J.rShoulder, J.rElbow, J.rWrist, J.rHip, J.rKnee, J.rAnkle],
};

/**
 * The side nearer the camera: the one the model sees better over the set
 * (the far side's joints are hidden behind the body). Null when neither side
 * is clearly better (a front or rear view: both are seen).
 */
export function nearSide(track: PoseTrack): Side | null {
  let l = 0;
  let r = 0;
  let n = 0;
  for (const f of track.frames) {
    if (!f) continue;
    n++;
    for (const j of SIDE_JOINTS.left) l += f[3 * j + 2];
    for (const j of SIDE_JOINTS.right) r += f[3 * j + 2];
  }
  if (!n) return null;
  l /= n * 6;
  r /= n * 6;
  if (Math.abs(l - r) < 0.04) return null;
  return l > r ? "left" : "right";
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/**
 * Where the camera is, from the body itself: side-on, the two shoulders (and
 * the two hips) sit nearly on top of each other; face-on or from behind they
 * are a shoulder width apart. Read as the median over the frames of the
 * shoulders' and hips' horizontal spread against the torso's length.
 */
export function viewOf(track: PoseTrack): CameraView {
  const { w, h } = track.frame;
  const spreads: number[] = [];
  for (const f of track.frames) {
    const ls = seen(f, J.lShoulder, 0.3);
    const rs = seen(f, J.rShoulder, 0.3);
    const lh = seen(f, J.lHip, 0.3);
    const rh = seen(f, J.rHip, 0.3);
    if (!ls || !rs || !lh || !rh) continue;
    const torso = Math.hypot(
      ((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2) * w,
      ((ls.y + rs.y) / 2 - (lh.y + rh.y) / 2) * h,
    );
    if (torso < 4) continue;
    const spread = (Math.abs(ls.x - rs.x) * w + Math.abs(lh.x - rh.x) * w) / 2;
    spreads.push(spread / torso);
  }
  if (spreads.length < 3) return "unknown";
  const m = median(spreads);
  if (m < 0.32) return "side";
  if (m > 0.55) return "front";
  return "oblique";
}

/**
 * The track smoothed joint by joint: a centred average over `half` frames
 * either side of the frames where the joint is seen, never across a gap
 * longer than `MAX_GAP_S`, its visibility the smallest it was in the window
 * (a smoothed point is only as sure as the least sure frame in it).
 */
export function smoothTrack(track: PoseTrack, half = 2): PoseTrack {
  const n = track.frames.length;
  const out: (PoseFrame | null)[] = track.frames.map((f) => (f ? new Float32Array(f) : null));
  for (let j = 0; j < LANDMARKS; j++) {
    for (let i = 0; i < n; i++) {
      const fi = track.frames[i];
      if (!fi || !(fi[3 * j + 2] >= DRAW_VIS_MIN)) continue;
      let sx = 0;
      let sy = 0;
      let c = 0;
      let vmin = fi[3 * j + 2];
      for (let k = i - half; k <= i + half; k++) {
        if (k < 0 || k >= n) continue;
        const fk = track.frames[k];
        if (!fk || !(fk[3 * j + 2] >= DRAW_VIS_MIN)) continue;
        if (Math.abs(track.t[k] - track.t[i]) > MAX_GAP_S) continue;
        sx += fk[3 * j];
        sy += fk[3 * j + 1];
        vmin = Math.min(vmin, fk[3 * j + 2]);
        c++;
      }
      const o = out[i]!;
      o[3 * j] = sx / c;
      o[3 * j + 1] = sy / c;
      o[3 * j + 2] = vmin;
    }
  }
  return { ...track, frames: out };
}

/** The frame nearest time t, when one is within half a frame gap or `MAX_GAP_S`. */
export function frameAt(track: PoseTrack, t: number): PoseFrame | null {
  const ts = track.t;
  if (!ts.length) return null;
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ts[m] <= t) lo = m;
    else hi = m;
  }
  const i = Math.abs(ts[lo] - t) <= Math.abs(ts[hi] - t) ? lo : hi;
  return Math.abs(ts[i] - t) <= MAX_GAP_S ? track.frames[i] : null;
}

/** Index of the frame nearest t (or -1). */
export function indexAt(track: PoseTrack, t: number): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < track.t.length; i++) {
    const d = Math.abs(track.t[i] - t);
    if (d < bd && track.frames[i]) {
      bd = d;
      best = i;
    }
  }
  return bd <= MAX_GAP_S ? best : -1;
}

/** Degrees between the vectors a→b and c→b, at b (0…180). */
function angleAt(a: Pt, b: Pt, c: Pt, w: number, h: number): number {
  const ux = (a.x - b.x) * w;
  const uy = (a.y - b.y) * h;
  const vx = (c.x - b.x) * w;
  const vy = (c.y - b.y) * h;
  const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (d < 1e-6) return NaN;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Degrees a segment from `from` up to `to` leans from vertical (0 = upright, 90 = flat). */
function fromVertical(from: Pt, to: Pt, w: number, h: number): number {
  const dx = (to.x - from.x) * w;
  const dy = (from.y - to.y) * h; // up is positive
  if (Math.hypot(dx, dy) < 1e-6) return NaN;
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}

export type JointAngles = {
  /** Flexion: 0 = straight, more = bent (180 − the inside angle). */
  knee: number | null;
  hip: number | null;
  elbow: number | null;
  /** Lean from vertical: shoulder above hip = 0. */
  torso: number | null;
  /** Shin lean from vertical: knee above ankle = 0. */
  shin: number | null;
  /** The thigh against horizontal: positive = hip below knee (below parallel). */
  thigh: number | null;
};

export function sideJoints(side: Side) {
  return side === "left"
    ? {
        shoulder: J.lShoulder,
        elbow: J.lElbow,
        wrist: J.lWrist,
        hip: J.lHip,
        knee: J.lKnee,
        ankle: J.lAnkle,
        heel: J.lHeel,
        toe: J.lToe,
      }
    : {
        shoulder: J.rShoulder,
        elbow: J.rElbow,
        wrist: J.rWrist,
        hip: J.rHip,
        knee: J.rKnee,
        ankle: J.rAnkle,
        heel: J.rHeel,
        toe: J.rToe,
      };
}

/**
 * One frame's sagittal angles on the near side, each only when every joint
 * it's made of is seen. Callers show them only for a side-on camera.
 */
export function anglesOf(
  f: PoseFrame | null,
  side: Side,
  frame: { w: number; h: number },
): JointAngles {
  const { w, h } = frame;
  const s = sideJoints(side);
  const sh = seen(f, s.shoulder);
  const el = seen(f, s.elbow);
  const wr = seen(f, s.wrist);
  const hp = seen(f, s.hip);
  const kn = seen(f, s.knee);
  const an = seen(f, s.ankle);
  const flex = (a: Pt | null, b: Pt | null, c: Pt | null) =>
    a && b && c ? fin(180 - angleAt(a, b, c, w, h)) : null;
  let thigh: number | null = null;
  if (hp && kn) {
    const dx = Math.abs(kn.x - hp.x) * w;
    const dy = (hp.y - kn.y) * h; // positive: hip lower on screen than knee
    if (Math.hypot(dx, dy) > 1e-6) thigh = fin((Math.atan2(dy, dx) * 180) / Math.PI);
  }
  return {
    knee: flex(hp, kn, an),
    hip: flex(sh, hp, kn),
    elbow: flex(sh, el, wr),
    torso: hp && sh ? fin(fromVertical(hp, sh, w, h)) : null,
    shin: an && kn ? fin(fromVertical(an, kn, w, h)) : null,
    thigh,
  };
}

const fin = (v: number) => (Number.isFinite(v) ? v : null);

/**
 * Which way the athlete faces in the picture (+1 right, −1 left): the toes
 * point ahead of the heels. Null when the feet weren't seen.
 */
export function facing(track: PoseTrack, side: Side): 1 | -1 | null {
  const s = sideJoints(side);
  const ds: number[] = [];
  for (const f of track.frames) {
    const toe = seen(f, s.toe, 0.5);
    const heel = seen(f, s.heel, 0.5);
    if (toe && heel) ds.push(toe.x - heel.x);
  }
  if (ds.length < 3) return null;
  const m = median(ds);
  if (Math.abs(m) < 0.004) return null;
  return m > 0 ? 1 : -1;
}

/** Share of frames with a body found. */
export function poseCoverage(track: PoseTrack): number {
  if (!track.frames.length) return 0;
  return track.frames.filter(Boolean).length / track.frames.length;
}
