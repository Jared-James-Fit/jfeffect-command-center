/**
 * The app's one capture and selection layer (Nov 25 2026): what each place
 * that takes a photo or video asks of the camera and the library, and the
 * camera's own settings. Pure, so it's tested (src/test/media-capture.test.ts).
 *
 * One camera (FilmCamera, components/camera/film-camera.tsx) serves every
 * place that captures: the set videos (its own flow, unchanged), and, through
 * `CaptureCamera`, New post, chat, progress and check-in photos and profile
 * photos, each with its purpose's defaults (`PURPOSES`). The story camera
 * (ShareStudio) keeps its live filters and reads the same defaults.
 *
 * What a camera captures and what a post shows are separate: the capture
 * ratio (`CaptureRatio`) is the guide on the viewfinder and the framing the
 * shot starts with; the photo itself is kept whole on the phone and the
 * post's own shape is applied only when it's exported (photo-frame.ts), so
 * it can be moved, pinched, turned and straightened afterwards.
 */

import type { CameraCaps, Facing, FilmFps, FilmQuality } from "@/lib/camera/film-settings";
import { availableFps, availableQualities } from "@/lib/camera/film-settings";
import { CENTRED, clampFraming, coverScale, type Framing } from "@/lib/photo-frame";

export type Size = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };

/* ---- purposes ------------------------------------------------------------ */

export type MediaPurpose = "post" | "story" | "progress" | "checkin" | "chat" | "profile";

export type CaptureRatio = "screen" | "original" | "9:16" | "4:5" | "3:4" | "1:1" | "16:9";

export const CAPTURE_RATIOS: CaptureRatio[] = ["screen", "original", "9:16", "4:5", "3:4", "1:1", "16:9"];

export const CAPTURE_RATIO_LABEL: Record<CaptureRatio, string> = {
  screen: "Full screen",
  original: "Original",
  "9:16": "9:16",
  "4:5": "4:5",
  "3:4": "3:4",
  "1:1": "1:1",
  "16:9": "16:9",
};

const FIXED: Partial<Record<CaptureRatio, number>> = {
  "9:16": 9 / 16,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "1:1": 1,
  "16:9": 16 / 9,
};

export type PurposeDefaults = {
  /** What the camera's guide starts at. */
  ratio: CaptureRatio;
  facing: Facing;
  photo: boolean;
  video: boolean;
  /** How many one pick can bring. */
  max: number;
  /** The grid on to start (progress photos line up the same way each time). */
  grid: boolean;
  /** The longest clip filmed here, seconds. */
  maxSeconds: number;
  /** What the camera says it's for. */
  title: string;
};

/**
 * Each place's defaults. A post fills the screen (the camera edge to edge,
 * Instagram's), a story is 9:16, progress and check-in photos are 3:4 with
 * the grid on (the same framing every time), a profile photo is a square
 * selfie, and chat keeps the picture as it is.
 */
export const PURPOSES: Record<MediaPurpose, PurposeDefaults> = {
  post: { ratio: "screen", facing: "environment", photo: true, video: true, max: 10, grid: false, maxSeconds: 180, title: "New post" },
  story: { ratio: "9:16", facing: "environment", photo: true, video: true, max: 1, grid: false, maxSeconds: 60, title: "Story" },
  progress: { ratio: "3:4", facing: "environment", photo: true, video: false, max: 1, grid: true, maxSeconds: 60, title: "Progress photo" },
  checkin: { ratio: "3:4", facing: "environment", photo: true, video: true, max: 10, grid: true, maxSeconds: 120, title: "Check-in" },
  chat: { ratio: "original", facing: "environment", photo: true, video: true, max: 10, grid: false, maxSeconds: 300, title: "Camera" },
  profile: { ratio: "1:1", facing: "user", photo: true, video: false, max: 1, grid: false, maxSeconds: 0, title: "Profile photo" },
};

/** What a file input for this purpose accepts. */
export function purposeAccept(p: MediaPurpose): string {
  const d = PURPOSES[p];
  return [d.photo && "image/*", d.video && "video/*"].filter(Boolean).join(",") || "image/*";
}

/**
 * The capture ratio as width / height. `screen` is the viewfinder's own
 * shape (what's on the screen), `original` the camera's whole picture (null
 * when it isn't known yet).
 */
export function ratioValue(r: CaptureRatio, ctx: { screen?: Size | null; picture?: Size | null }): number | null {
  const fixed = FIXED[r];
  if (fixed) return fixed;
  const s = r === "screen" ? ctx.screen : ctx.picture;
  return s && s.w > 0 && s.h > 0 ? s.w / s.h : null;
}

/* ---- the camera's settings ----------------------------------------------- */

/**
 * Auto (the default) takes a photo from the live picture at the quality the
 * camera's giving; Maximum quality asks the camera for the most it can do
 * (4K where it says it can) and takes the still through the camera's own
 * photo path where the browser has one; Fast capture keeps 1080p and takes
 * the frame on screen at once (the shortest shutter lag).
 */
export type CaptureMode = "auto" | "max" | "fast";
export const CAPTURE_MODES: CaptureMode[] = ["auto", "max", "fast"];
export const CAPTURE_MODE_LABEL: Record<CaptureMode, string> = { auto: "Auto", max: "Maximum quality", fast: "Fast capture" };

export type CaptureTimer = 0 | 3 | 10;

export type CaptureSettings = {
  mode: CaptureMode;
  timer: CaptureTimer;
  grid: boolean;
  level: boolean;
  /** The video quality picked by hand (null: what the mode picks). */
  quality: FilmQuality | null;
  fps: FilmFps;
  /** Each place's last ratio. */
  ratios: Partial<Record<MediaPurpose, CaptureRatio>>;
  /** Each place's last side (a selfie stays a selfie). */
  facing: Partial<Record<MediaPurpose, Facing>>;
};

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = { mode: "auto", timer: 0, grid: false, level: false, quality: null, fps: 30, ratios: {}, facing: {} };

export const CAPTURE_SETTINGS_KEY = "jf-capture-camera-v1";

const PURPOSE_KEYS = Object.keys(PURPOSES) as MediaPurpose[];

export function sanitizeCaptureSettings(raw: unknown): CaptureSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = CAPTURE_MODES.includes(o.mode as CaptureMode) ? (o.mode as CaptureMode) : "auto";
  const timer = o.timer === 3 || o.timer === 10 ? (o.timer as CaptureTimer) : 0;
  const quality = o.quality === "720p" || o.quality === "1080p" || o.quality === "4k" ? (o.quality as FilmQuality) : null;
  const fps = o.fps === 60 ? 60 : 30;
  const ratios: CaptureSettings["ratios"] = {};
  const facing: CaptureSettings["facing"] = {};
  const r = (o.ratios && typeof o.ratios === "object" ? o.ratios : {}) as Record<string, unknown>;
  const f = (o.facing && typeof o.facing === "object" ? o.facing : {}) as Record<string, unknown>;
  for (const p of PURPOSE_KEYS) {
    if (CAPTURE_RATIOS.includes(r[p] as CaptureRatio)) ratios[p] = r[p] as CaptureRatio;
    if (f[p] === "user" || f[p] === "environment") facing[p] = f[p] as Facing;
  }
  return { mode, timer, grid: o.grid === true, level: o.level === true, quality, fps, ratios, facing };
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readCaptureSettings(storage: Pick<Storage, "getItem"> | null = safeStorage()): CaptureSettings {
  try {
    const raw = storage?.getItem(CAPTURE_SETTINGS_KEY);
    return sanitizeCaptureSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_CAPTURE_SETTINGS };
  }
}

export function saveCaptureSettings(s: CaptureSettings, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(CAPTURE_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode: this visit only */
  }
}

/** The ratio, side and grid a place opens with: what was last used there, else its defaults. */
export function purposeStart(p: MediaPurpose, s: CaptureSettings): { ratio: CaptureRatio; facing: Facing; grid: boolean } {
  const d = PURPOSES[p];
  return { ratio: s.ratios[p] ?? d.ratio, facing: s.facing[p] ?? d.facing, grid: s.grid || d.grid };
}

/**
 * What the camera is asked for under a mode: a quality and frame rate it says
 * it can do (never more: nothing is upscaled), and how a still is taken.
 * A quality picked by hand wins where the camera can do it.
 */
export function captureProfile(
  s: Pick<CaptureSettings, "mode" | "quality" | "fps">,
  caps: CameraCaps | null | undefined,
  hasPhotoPath: boolean,
): { quality: FilmQuality; fps: FilmFps; still: "photo" | "frame" } {
  const qs = availableQualities(caps);
  const best = qs[qs.length - 1];
  const upTo1080 = qs.includes("1080p") ? "1080p" : best;
  const picked = s.quality && qs.includes(s.quality) ? s.quality : null;
  const fpsOk = availableFps(caps);
  const fps: FilmFps = fpsOk.includes(s.fps) ? s.fps : 30;
  if (s.mode === "max") return { quality: picked ?? best, fps, still: hasPhotoPath ? "photo" : "frame" };
  if (s.mode === "fast") return { quality: picked && picked !== "4k" ? picked : upTo1080, fps, still: "frame" };
  return { quality: picked ?? upTo1080, fps, still: "frame" };
}

/* ---- the viewfinder: what the screen shows, the guide, focus ------------- */

/** The part of the camera's picture a box shows it filling (object-fit: cover), in picture px. */
export function coverView(picture: Size, box: Size): Rect {
  if (!(picture.w > 0 && picture.h > 0 && box.w > 0 && box.h > 0)) return { x: 0, y: 0, w: picture.w, h: picture.h };
  const s = Math.max(box.w / picture.w, box.h / picture.h);
  const w = box.w / s;
  const h = box.h / s;
  return { x: (picture.w - w) / 2, y: (picture.h - h) / 2, w, h };
}

/** The guide's band inside the box, in box px (the middle part of the ratio's shape; the whole box for none). */
export function guideRect(box: Size, aspect: number | null): Rect {
  if (!aspect || !(box.w > 0 && box.h > 0)) return { x: 0, y: 0, w: box.w, h: box.h };
  const w = Math.min(box.w, box.h * aspect);
  const h = w / aspect;
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
}

/**
 * What a shot keeps of the camera's picture for this ratio, in picture px:
 * `original` the whole picture; `screen` what the screen showed; any other
 * shape the guide's band of what the screen showed (or, for a shape wider
 * than the screen, the widest band of the picture at that shape).
 */
export function captureCrop(picture: Size, box: Size, ratio: CaptureRatio): Rect {
  if (ratio === "original") return { x: 0, y: 0, w: picture.w, h: picture.h };
  const view = coverView(picture, box);
  if (ratio === "screen") return view;
  const a = ratioValue(ratio, {})!;
  const band = guideRect({ w: view.w, h: view.h }, a);
  // a shape wider than the screen (16:9 on an upright phone): its band of the whole picture, so nothing is upscaled
  if (band.w >= view.w - 0.5 && a > view.w / view.h) {
    const g = guideRect(picture, a);
    return g;
  }
  return { x: view.x + band.x, y: view.y + band.y, w: band.w, h: band.h };
}

/** A tap on the viewfinder (box px) as a point of the picture (0–1 each way), for focus and exposure. */
export function focusPoint(tap: { x: number; y: number }, box: Size, picture: Size, mirrored = false): { x: number; y: number } {
  const view = coverView(picture, box);
  const bx = mirrored ? box.w - tap.x : tap.x;
  const px = view.x + (bx / Math.max(1, box.w)) * view.w;
  const py = view.y + (tap.y / Math.max(1, box.h)) * view.h;
  const c = (n: number) => Math.min(1, Math.max(0, n));
  return { x: c(px / Math.max(1, picture.w)), y: c(py / Math.max(1, picture.h)) };
}

type FocusCaps = { focusMode?: string[]; exposureMode?: string[] };

/**
 * Tap to focus and expose, where the camera and the browser say they can
 * (a point of interest and a focus or exposure mode to use it with). Null
 * where they can't: then no focus square is shown, since it would do nothing.
 */
export function focusAt(
  point: { x: number; y: number },
  caps: FocusCaps | null | undefined,
  supported: { pointsOfInterest?: boolean } | null | undefined,
): MediaTrackConstraintSet | null {
  if (!supported?.pointsOfInterest) return null;
  const focus = caps?.focusMode ?? [];
  const exposure = caps?.exposureMode ?? [];
  const f = focus.includes("single-shot") ? "single-shot" : focus.includes("continuous") ? "continuous" : null;
  const e = exposure.includes("single-shot") ? "single-shot" : exposure.includes("continuous") ? "continuous" : null;
  if (!f && !e) return null;
  return {
    pointsOfInterest: [{ x: point.x, y: point.y }],
    ...(f ? { focusMode: f } : {}),
    ...(e ? { exposureMode: e } : {}),
  } as unknown as MediaTrackConstraintSet;
}

/* ---- the level ----------------------------------------------------------- */

/**
 * How far the phone is turned off level, degrees (−45…45), from gravity
 * across the screen (`x`, `y`: accelerationIncludingGravity). An upright
 * phone and one on its side both read 0 when they're straight.
 */
export function levelAngle(x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 3) return null;
  const a = (Math.atan2(x, -y) * 180) / Math.PI;
  const off = ((((a + 45) % 90) + 90) % 90) - 45;
  return Math.round(off * 10) / 10;
}

/** Within a degree: the line turns yellow, Apple's. */
export const LEVEL_TOLERANCE = 1;

/* ---- hold to record, slide to zoom --------------------------------------- */

/** A press longer than this on the shutter films instead of taking a photo. */
export const HOLD_TO_RECORD_MS = 320;

/** A finger sliding up while it films zooms in (doubling every `px`), down zooms out, within the camera's range. */
export function slideZoom(start: number, dy: number, range: { min?: number; max?: number } | null | undefined, px = 180): number {
  const min = range?.min ?? 1;
  const max = Math.min(range?.max ?? 1, 10);
  const z = start * Math.pow(2, -dy / px);
  return Math.round(Math.min(max, Math.max(min, z)) * 10) / 10;
}

/* ---- thumbnails first ---------------------------------------------------- */

/** The long side of a pick's first preview: on screen at once, the full picture decoded only when it's edited or posted. */
export const PREVIEW_LONG = 1280;

/** A preview's size: the picture brought down to `long` on its long side, never up. */
export function previewSize(w: number, h: number, long = PREVIEW_LONG): Size {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, long / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/* ---- a shot's framing: kept whole, framed non-destructively ------------- */

/**
 * The framing (photo-frame.ts) that shows a shot's crop in a frame of
 * `aspect`: centred on the crop, zoomed so the frame's shape fits inside it.
 * The photo itself stays whole; this is only where it starts in the editor.
 */
export function framingForCrop(img: Size, crop: Rect, aspect: number): Framing {
  if (!(img.w > 0 && img.h > 0 && crop.w > 0 && crop.h > 0 && aspect > 0)) return CENTRED;
  const frame = { w: aspect, h: 1 };
  const visW = Math.min(crop.w, crop.h * aspect);
  const z = aspect / (coverScale(img, frame) * visW);
  return clampFraming({ z, cx: (crop.x + crop.w / 2) / img.w, cy: (crop.y + crop.h / 2) / img.h }, img, frame);
}
