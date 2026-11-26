/**
 * What the face model's landmarks say about a headshot frame, and what to tell
 * the person (pure, tested in headshots-face.test.ts). The model is MediaPipe's
 * Face Landmarker (478 points, normalised to the raw camera frame, which for a
 * front camera is NOT mirrored: the person's left is the frame's right). It runs
 * on the device; nothing here is a biometric template, nothing is stored.
 */
import { EVIDENCE_LIMITS } from "./evidence";
import type { ChallengeStep } from "./rules";

export type Pt = { x: number; y: number; z?: number };

/** Face-mesh indices used here. */
export const LM = {
  noseTip: 1,
  forehead: 10,
  chin: 152,
  /** the face's edge on the frame's left (the person's right) and right (the person's left) */
  edgeL: 234,
  edgeR: 454,
  eyeL: { outer: 33, inner: 133, upper: 159, lower: 145 },
  eyeR: { outer: 263, inner: 362, upper: 386, lower: 374 },
} as const;

export type FaceMetrics = {
  /** face box, normalised to the frame */
  box: { x: number; y: number; w: number; h: number };
  /** the face's centre, normalised */
  cx: number;
  cy: number;
  /** degrees; positive = turned to the person's own left */
  yaw: number;
  /** degrees; positive = head tilted toward the person's right shoulder (frame-left eye lower) */
  roll: number;
  /** nose height between the eyes and the chin (≈0.31 level; real frontal faces read 0.25–0.36) */
  noseRatio: number;
  /** eye opening relative to eye width, averaged (≈0.25+ open, under ≈0.12 closed) */
  eyeOpen: number;
  /** face height as a share of the frame height */
  share: number;
};

const D = (a: Pt, b: Pt, w: number, h: number) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
const DEG = 180 / Math.PI;

/** The numbers a frame's landmarks give (`w`/`h` are the frame's pixels, for true angles). */
export function faceMetrics(lm: Pt[], w: number, h: number): FaceMetrics | null {
  if (!lm || lm.length < 468) return null;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const p of lm) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const nose = lm[LM.noseTip]!;
  const eL = lm[LM.edgeL]!;
  const eR = lm[LM.edgeR]!;
  const mid = (eL.x + eR.x) / 2;
  const half = Math.abs(eR.x - eL.x) / 2 || 1e-6;
  const yaw = Math.asin(Math.max(-1, Math.min(1, (nose.x - mid) / half))) * DEG;
  const oL = lm[LM.eyeL.outer]!;
  const oR = lm[LM.eyeR.outer]!;
  const roll = Math.atan2((oR.y - oL.y) * h, (oR.x - oL.x) * w) * DEG;
  const eyeY = (lm[LM.eyeL.upper]!.y + lm[LM.eyeL.lower]!.y + lm[LM.eyeR.upper]!.y + lm[LM.eyeR.lower]!.y) / 4;
  const chin = lm[LM.chin]!;
  const noseRatio = (nose.y - eyeY) / Math.max(1e-6, chin.y - eyeY);
  const openL = D(lm[LM.eyeL.upper]!, lm[LM.eyeL.lower]!, w, h) / Math.max(1e-6, D(lm[LM.eyeL.outer]!, lm[LM.eyeL.inner]!, w, h));
  const openR = D(lm[LM.eyeR.upper]!, lm[LM.eyeR.lower]!, w, h) / Math.max(1e-6, D(lm[LM.eyeR.outer]!, lm[LM.eyeR.inner]!, w, h));
  return {
    box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    yaw,
    roll,
    noseRatio,
    eyeOpen: (openL + openR) / 2,
    share: y1 - y0,
  };
}

/** The square to crop around a face (frame pixels): centred a touch above the face's middle, with room for hair and shoulders. */
export function faceCrop(m: FaceMetrics, w: number, h: number): { sx: number; sy: number; side: number } {
  const faceH = m.box.h * h;
  let side = Math.min(Math.round(faceH * 1.9), w, h);
  side = Math.max(side, Math.min(w, h, 64));
  const cx = m.cx * w;
  const cy = m.cy * h - faceH * 0.04;
  const sx = Math.round(Math.min(Math.max(0, cx - side / 2), w - side));
  const sy = Math.round(Math.min(Math.max(0, cy - side / 2), h - side));
  return { sx, sy, side };
}

/** The eye band inside a crop, as shares of its height (for the server's blink check). */
export function eyeBandIn(lm: Pt[], crop: { sx: number; sy: number; side: number }, h: number): { eyeTop: number; eyeBottom: number } {
  const ys = [LM.eyeL.upper, LM.eyeL.lower, LM.eyeR.upper, LM.eyeR.lower].map((i) => lm[i]!.y * h);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const pad = (bottom - top) * 0.9 + crop.side * 0.02;
  const r = (v: number) => Math.round(Math.min(1, Math.max(0, (v - crop.sy) / crop.side)) * 1000) / 1000;
  return { eyeTop: r(top - pad), eyeBottom: r(bottom + pad) };
}

/** Blink: the model's own eye-blink scores, or the eyes' opening against their open baseline. */
export function eyesClosed(blink: { left: number; right: number } | null, eyeOpen: number, openBaseline: number | null): boolean {
  if (blink && Math.min(blink.left, blink.right) >= 0.5) return true;
  return openBaseline != null && openBaseline > 0 && eyeOpen < openBaseline * 0.55;
}

/* ---- live guidance ----------------------------------------------------- */

export type FrameRead = {
  faces: number;
  metrics: FaceMetrics | null;
  /** the face crop's brightness, contrast and sharpness (frameStats on the 160 px tile) */
  stats: { mean: number; std: number; sharpness: number } | null;
  /** eye region brightness against the cheeks (sunglasses read very dark) */
  eyeShade: number | null;
};

/** The device's own bar for "ready", stricter than the server's refusal limits. */
export const READY = {
  minShare: 0.3,
  maxShare: 0.8,
  maxOffCentre: 0.12,
  maxYaw: 12,
  maxRoll: 12,
  /** level, measured with the model on real frontal portraits (0.25–0.36), with room either side */
  noseRatio: [0.19, 0.46] as const,
  minMean: 70,
  maxMean: 215,
  minStd: 24,
  minSharp: 55,
  minEyeShade: 0.42,
} as const;

/** Level head = this nose ratio (see READY.noseRatio); the device reports pitch against it, in rough degrees. */
export const LEVEL_NOSE = 0.31;
export function approxPitch(noseRatio: number): number {
  return Math.round((noseRatio - LEVEL_NOSE) * 1000) / 10;
}

export type Guidance = { ready: boolean; hint: string };

/** One thing to fix at a time, in the order that matters most. */
export function guidance(f: FrameRead): Guidance {
  if (f.faces === 0 || !f.metrics) return { ready: false, hint: "Look at the camera" };
  if (f.faces > 1) return { ready: false, hint: "Only you in the frame, please" };
  const m = f.metrics;
  if (m.box.x < 0.01 || m.box.y < 0.005 || m.box.x + m.box.w > 0.99 || m.box.y + m.box.h > 0.995) return { ready: false, hint: "Move your whole face into the oval" };
  if (m.share < READY.minShare) return { ready: false, hint: "Move a little closer" };
  if (m.share > READY.maxShare) return { ready: false, hint: "Move back a little" };
  if (Math.abs(m.cx - 0.5) > READY.maxOffCentre || Math.abs(m.cy - 0.48) > READY.maxOffCentre + 0.04) return { ready: false, hint: "Centre your face in the oval" };
  const s = f.stats;
  if (s && s.mean < READY.minMean) return { ready: false, hint: "Find more light, like facing a window" };
  if (s && s.mean > READY.maxMean) return { ready: false, hint: "Too bright: step out of direct light" };
  if (s && s.std < READY.minStd) return { ready: false, hint: "Face the light so your face is clear" };
  if (Math.abs(m.yaw) > READY.maxYaw || Math.abs(m.roll) > READY.maxRoll || m.noseRatio < READY.noseRatio[0] || m.noseRatio > READY.noseRatio[1])
    return { ready: false, hint: "Look straight at the camera" };
  if (f.eyeShade != null && f.eyeShade < READY.minEyeShade) return { ready: false, hint: "Remove sunglasses or anything covering your face" };
  if (s && s.sharpness < READY.minSharp) return { ready: false, hint: "Hold still" };
  return { ready: true, hint: "Hold still" };
}

/** The server would refuse this frame outright (so the device never sends it). */
export function serverWouldRefuse(s: { mean: number; std: number } | null): boolean {
  if (!s) return true;
  return s.mean < EVIDENCE_LIMITS.tooDark || s.mean > EVIDENCE_LIMITS.tooBright || s.std < EVIDENCE_LIMITS.flat;
}

/* ---- the challenge ------------------------------------------------------ */

export type StepState = {
  step: ChallengeStep;
  startedAt: number;
  /** the strongest reading so far (blink: 0–1 closure; turn: degrees) */
  peak: number;
  /** captured at the peak */
  captured: boolean;
  done: boolean;
};

export const TURN_DEGREES = 15;

/**
 * Advance one challenge step with a new reading. A blink is captured with the
 * eyes closed and done once they open again; a turn is captured past
 * TURN_DEGREES the right way and done once the head comes back toward centre.
 * Returns whether this frame is the one to keep.
 */
export function advanceStep(
  st: StepState,
  read: { yaw: number; closed: boolean; closure: number },
): { state: StepState; keepFrame: boolean } {
  if (st.done) return { state: st, keepFrame: false };
  if (st.step === "blink") {
    if (read.closed) {
      const better = read.closure > st.peak || !st.captured;
      return { state: { ...st, captured: true, peak: Math.max(st.peak, read.closure) }, keepFrame: better };
    }
    if (st.captured) return { state: { ...st, done: true }, keepFrame: false };
    return { state: st, keepFrame: false };
  }
  const want = st.step === "turn_left" ? 1 : -1;
  const v = read.yaw * want;
  if (v >= TURN_DEGREES) {
    const better = v > Math.abs(st.peak) || !st.captured;
    return { state: { ...st, captured: true, peak: better ? read.yaw : st.peak }, keepFrame: better };
  }
  if (st.captured && v < TURN_DEGREES * 0.5) return { state: { ...st, done: true }, keepFrame: false };
  return { state: st, keepFrame: false };
}
