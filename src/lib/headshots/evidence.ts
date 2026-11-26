/**
 * The evidence a headshot capture sends, and the server's own reading of it
 * (pure, tested in headshots.test.ts). The app sends the photo (a JPEG for the
 * coach) and one PNG strip of small face-centred frames: the final, straight-
 * on frame, then one frame per challenge step in the order the server asked
 * (eyes closed for the blink, head turned for the turn). The server decodes
 * the strip itself and checks what a still picture can't fake: the eyes
 * changing between the straight frame and the blink while the rest of the
 * face doesn't, and the face changing for the turn. It also measures light,
 * contrast and sharpness, and fingerprints the straight frame (dHash) to find
 * the same photo sent twice or from another account.
 *
 * Honest about its limits: this stops a printed photo, a screenshot or the
 * same frames sent again. It can't stop a determined attacker who feeds the
 * browser a fake camera, and it never proves who someone is, so the coach can still review or request a retake.
 */
import type { ChallengeStep } from "./rules";
import { toGray, type DecodedImage } from "./png";

/** Each frame is a square of this many pixels, side by side in the strip. */
export const TILE = 160;
/** The display photo the coach sees. */
export const PHOTO_PX = 720;

/** Frame 0 is straight on; frames 1.. follow the challenge order. */
export function stripTiles(challenge: ChallengeStep[]): number {
  return 1 + challenge.length;
}

export type TileMeta = {
  /** the eye band, as a share of the tile's height (from the face model on the device) */
  eyeTop?: number;
  eyeBottom?: number;
};

export type FrameStats = { mean: number; std: number; sharpness: number };

/** One tile's grey pixels out of the strip. */
export function tileGray(gray: Uint8Array, stripWidth: number, index: number, side = TILE): Uint8Array {
  const out = new Uint8Array(side * side);
  const x0 = index * side;
  for (let y = 0; y < side; y++) out.set(gray.subarray(y * stripWidth + x0, y * stripWidth + x0 + side), y * side);
  return out;
}

/** Brightness, contrast and sharpness (variance of the Laplacian) over the middle of a tile. */
export function frameStats(t: Uint8Array, side = TILE): FrameStats {
  const m0 = Math.round(side * 0.15);
  const m1 = side - m0;
  let sum = 0;
  let sq = 0;
  let n = 0;
  let lapSum = 0;
  let lapSq = 0;
  let ln = 0;
  for (let y = m0; y < m1; y++) {
    for (let x = m0; x < m1; x++) {
      const v = t[y * side + x]!;
      sum += v;
      sq += v * v;
      n++;
      const lap = 4 * v - t[(y - 1) * side + x]! - t[(y + 1) * side + x]! - t[y * side + x - 1]! - t[y * side + x + 1]!;
      lapSum += lap;
      lapSq += lap * lap;
      ln++;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  const lapMean = lapSum / ln;
  const sharpness = Math.max(0, lapSq / ln - lapMean * lapMean);
  return { mean, std, sharpness };
}

/** Mean absolute difference between two tiles over a band of rows (shares of the height), the middle 70% of columns. */
export function bandDiff(a: Uint8Array, b: Uint8Array, top: number, bottom: number, side = TILE): number {
  const y0 = Math.max(0, Math.floor(side * Math.min(top, bottom)));
  const y1 = Math.min(side, Math.ceil(side * Math.max(top, bottom)));
  const x0 = Math.round(side * 0.15);
  const x1 = side - x0;
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      s += Math.abs(a[y * side + x]! - b[y * side + x]!);
      n++;
    }
  }
  return n ? s / n : 0;
}

/**
 * The small shift (in pixels) that best lines `b` up with `a` over the face
 * outside the eye band, so a head that moved a little between frames isn't
 * read as a blink, and a picture slid sideways isn't read as a head turn.
 */
export function bestShift(a: Uint8Array, b: Uint8Array, eyeTop: number, eyeBottom: number, side = TILE, reach = 16): { dx: number; dy: number } {
  const y0 = Math.round(side * 0.2);
  const y1 = Math.round(side * 0.9);
  const x0 = Math.round(side * 0.18);
  const x1 = side - x0;
  const e0 = Math.floor(side * eyeTop);
  const e1 = Math.ceil(side * eyeBottom);
  let best = { dx: 0, dy: 0 };
  let bestErr = Infinity;
  for (let dy = -reach; dy <= reach; dy += 2) {
    for (let dx = -reach; dx <= reach; dx += 2) {
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        if (y >= e0 && y < e1) continue;
        const yb = y + dy;
        if (yb < 0 || yb >= side) continue;
        for (let x = x0; x < x1; x += 2) {
          const xb = x + dx;
          if (xb < 0 || xb >= side) continue;
          s += Math.abs(a[y * side + x]! - b[yb * side + xb]!);
          n++;
        }
      }
      const err = n ? s / n : Infinity;
      if (err < bestErr - 1e-9) {
        bestErr = err;
        best = { dx, dy };
      }
    }
  }
  return best;
}

/** bandDiff with `b` read through a shift (pixels outside the tile are skipped). */
export function shiftedBandDiff(a: Uint8Array, b: Uint8Array, top: number, bottom: number, shift: { dx: number; dy: number }, side = TILE): number {
  const y0 = Math.max(0, Math.floor(side * Math.min(top, bottom)));
  const y1 = Math.min(side, Math.ceil(side * Math.max(top, bottom)));
  const x0 = Math.round(side * 0.15);
  const x1 = side - x0;
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const yb = y + shift.dy;
    if (yb < 0 || yb >= side) continue;
    for (let x = x0; x < x1; x++) {
      const xb = x + shift.dx;
      if (xb < 0 || xb >= side) continue;
      s += Math.abs(a[y * side + x]! - b[yb * side + xb]!);
      n++;
    }
  }
  return n ? s / n : 0;
}

/** A 64-bit difference hash of a tile (9×8 area-averaged grey, left > right), as 16 hex digits. */
export function dHash(t: Uint8Array, side = TILE): string {
  const cols = 9;
  const rows = 8;
  const cells: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const y0 = Math.floor((r * side) / rows);
      const y1 = Math.floor(((r + 1) * side) / rows);
      const x0 = Math.floor((c * side) / cols);
      const x1 = Math.floor(((c + 1) * side) / cols);
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        s += t[y * side + x]!;
        n++;
      }
      cells.push(n ? s / n : 0);
    }
  }
  let hex = "";
  for (let r = 0; r < rows; r++) {
    let byte = 0;
    for (let c = 0; c < 8; c++) byte = (byte << 1) | (cells[r * cols + c]! > cells[r * cols + c + 1]! ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Bits that differ between two dHashes (64 when either is missing or malformed). */
export function hamming(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b || a.length !== 16 || b.length !== 16) return 64;
  let d = 0;
  for (let i = 0; i < 16; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/* ---- the server's verdict -------------------------------------------- */

/** Thresholds, on the 0–255 grey scale, read generously: a hard refusal only for what's clearly not a usable live capture. */
export const EVIDENCE_LIMITS = {
  tooDark: 28,
  tooBright: 238,
  flat: 9,
  /** every frame within this of every other: a still picture sent as frames */
  stillMax: 2.2,
  lowLight: 60,
  lowContrast: 22,
  soft: 40,
  blinkEyeMin: 5,
  blinkRatio: 1.2,
  turnMin: 7,
  /** dHash distance that reads as the same picture */
  samePicture: 6,
} as const;

export type EvidenceVerdict = {
  ok: boolean;
  /** why a capture can't be used (shown to the client as what to do) */
  fail: "unreadable" | "too_dark" | "too_bright" | "no_detail" | "still_image" | null;
  /** worth the reviewer's look; the capture still goes for review */
  flags: string[];
  dhash: string | null;
  stats: FrameStats | null;
  blink: { eye: number; other: number; confirmed: boolean } | null;
  turn: { diff: number; confirmed: boolean } | null;
};

const DEFAULT_EYE = { top: 0.36, bottom: 0.52 };
/** the reference band under the eyes (cheeks, nose, mouth) */
const OTHER_BAND = { top: 0.58, bottom: 0.78 };

/**
 * Read a decoded evidence strip against the challenge it was issued. `guided`
 * captures carry challenge frames; a plain live capture carries its frames a
 * moment apart (still checked for being one picture copied).
 */
export function readEvidence(img: DecodedImage, challenge: ChallengeStep[], meta: TileMeta[] = []): EvidenceVerdict {
  const tiles = stripTiles(challenge);
  const empty: EvidenceVerdict = { ok: false, fail: "unreadable", flags: [], dhash: null, stats: null, blink: null, turn: null };
  if (img.height !== TILE || img.width !== TILE * tiles) return empty;
  const gray = toGray(img);
  const frames = Array.from({ length: tiles }, (_, i) => tileGray(gray, img.width, i));
  const base = frames[0]!;
  const stats = frameStats(base);
  const dhash = dHash(base);
  const flags: string[] = [];
  if (stats.mean < EVIDENCE_LIMITS.tooDark) return { ...empty, fail: "too_dark", stats, dhash };
  if (stats.mean > EVIDENCE_LIMITS.tooBright) return { ...empty, fail: "too_bright", stats, dhash };
  if (stats.std < EVIDENCE_LIMITS.flat) return { ...empty, fail: "no_detail", stats, dhash };
  if (stats.mean < EVIDENCE_LIMITS.lowLight) flags.push("low_light");
  if (stats.std < EVIDENCE_LIMITS.lowContrast) flags.push("low_contrast");
  if (stats.sharpness < EVIDENCE_LIMITS.soft) flags.push("soft_focus");

  // the same picture over and over: every frame nearly identical to the first
  if (tiles > 1) {
    const most = Math.max(...frames.slice(1).map((f) => bandDiff(base, f, 0.1, 0.9)));
    if (most < EVIDENCE_LIMITS.stillMax) return { ...empty, fail: "still_image", stats, dhash };
  }

  let blink: EvidenceVerdict["blink"] = null;
  let turn: EvidenceVerdict["turn"] = null;
  challenge.forEach((step, i) => {
    const f = frames[i + 1]!;
    if (step === "blink") {
      const m = meta[i + 1] ?? meta[0] ?? {};
      const top = clampShare(m.eyeTop, DEFAULT_EYE.top);
      const bottom = clampShare(m.eyeBottom, DEFAULT_EYE.bottom);
      const eyeBottom = Math.max(bottom, top + 0.06);
      // lined up on the rest of the face first: moving isn't blinking
      const shift = bestShift(base, f, top, eyeBottom);
      const eye = shiftedBandDiff(base, f, top, eyeBottom, shift);
      const other = shiftedBandDiff(base, f, OTHER_BAND.top, OTHER_BAND.bottom, shift);
      const confirmed = eye >= EVIDENCE_LIMITS.blinkEyeMin && eye >= other * EVIDENCE_LIMITS.blinkRatio;
      blink = { eye: round1(eye), other: round1(other), confirmed };
      if (!confirmed) flags.push("blink_unconfirmed");
    } else {
      // lined up first: a picture slid sideways isn't a head turn
      const shift = bestShift(base, f, 0, 0);
      const diff = shiftedBandDiff(base, f, 0.15, 0.85, shift);
      const confirmed = diff >= EVIDENCE_LIMITS.turnMin;
      turn = { diff: round1(diff), confirmed };
      if (!confirmed) flags.push("turn_unconfirmed");
    }
  });
  return { ok: true, fail: null, flags, dhash, stats: { mean: round1(stats.mean), std: round1(stats.std), sharpness: round1(stats.sharpness) }, blink, turn };
}

function clampShare(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(0.8, Math.max(0.15, v)) : dflt;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/* ---- what the device says it saw ------------------------------------- */

export type DeviceStep = { step: ChallengeStep; ms: number; peak: number };
export type DeviceChecks = {
  /** the face model that ran, or null when it couldn't (a plain live capture) */
  model: string | null;
  delegate?: "GPU" | "CPU" | null;
  steps: DeviceStep[];
  final: { faces: number; faceShare: number; yaw: number; pitch: number; roll: number; brightness: number; sharpness: number } | null;
  tiles: TileMeta[];
  /** how long the guided part took, start to capture */
  durationMs: number;
};

/**
 * Does what the device reported hang together with the challenge it was given?
 * Client-reported, so it's never trusted on its own: inconsistencies are
 * flagged for the reviewer, and the server's own frames decide the rest.
 */
export function deviceCheckProblems(d: DeviceChecks, challenge: ChallengeStep[], method: "guided" | "live" | "coach_assisted"): string[] {
  if (method !== "guided") return [];
  const out: string[] = [];
  if (!d.model) out.push("no_model");
  if (d.steps.length !== challenge.length || d.steps.some((s, i) => s.step !== challenge[i])) out.push("steps_out_of_order");
  for (const s of d.steps) {
    if (!(s.ms >= 150 && s.ms <= 90_000)) out.push(`step_time:${s.step}`);
    if (s.step === "blink" && !(s.peak >= 0.4)) out.push("blink_weak");
    if (s.step === "turn_left" && !(s.peak >= 10)) out.push("turn_left_weak");
    if (s.step === "turn_right" && !(s.peak <= -10)) out.push("turn_right_weak");
  }
  const f = d.final;
  if (!f) out.push("no_final");
  else {
    if (f.faces !== 1) out.push("faces");
    if (!(f.faceShare >= 0.12 && f.faceShare <= 0.95)) out.push("framing");
    if (Math.abs(f.yaw) > 22 || Math.abs(f.pitch) > 22 || Math.abs(f.roll) > 22) out.push("angle");
  }
  if (!(d.durationMs >= 1200 && d.durationMs <= 10 * 60_000)) out.push("duration");
  return [...new Set(out)];
}

/** What the reviewer reads for each flag. */
export const FLAG_WORDS: Record<string, string> = {
  low_light: "A bit dark",
  low_contrast: "Low contrast",
  soft_focus: "A little soft",
  blink_unconfirmed: "The server couldn't confirm the blink",
  turn_unconfirmed: "The server couldn't confirm the head turn",
  device_inconsistent: "The device's checks don't add up",
  no_device_checks: "Taken without the automatic face checks",
  similar_other_account: "Looks like another account's photo",
  same_as_before: "Looks the same as an earlier photo",
  coach_assisted: "Taken by the coach in person",
  exif: "Contains image metadata (not proof of a file upload)",
};

export function flagWords(flag: string): string {
  return FLAG_WORDS[flag] ?? flag.replace(/_/g, " ");
}

/** What the client is told when a capture can't be used: what to do, never a score. */
export const FAIL_WORDS: Record<NonNullable<EvidenceVerdict["fail"]> | "expired" | "replay" | "missing" | "photo", string> = {
  unreadable: "Something went wrong with that photo. Please try again.",
  too_dark: "It's too dark. Face a window or a light and try again.",
  too_bright: "There's too much light behind or on you. Step out of direct light and try again.",
  no_detail: "We couldn't make out your face. Make sure the camera isn't covered and try again.",
  still_image: "That looked like a still picture. Please take it live, following the prompts.",
  expired: "That took a little too long. Please try again.",
  replay: "That photo was already sent. Please take a new one.",
  missing: "The photo didn't finish uploading. Please try again.",
  photo: "Something went wrong with that photo. Please try again.",
};
