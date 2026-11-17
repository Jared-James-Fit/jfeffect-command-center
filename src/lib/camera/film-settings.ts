/**
 * The app's own video camera (FilmCamera): what to ask the phone's camera for,
 * how hard to record it, and how long it can run. Pure, so it's all tested.
 *
 * Why the app has its own camera: iOS's "Take Video" (what a web page's file
 * picker offers) records at 480 × 360 under 1 Mbps, with no settings at all.
 * Every set video filmed that way in Nov 2026 came in at 360 × 480, while the
 * same phones' own Camera app gave 4K. The live camera (getUserMedia +
 * MediaRecorder) records 1080p by default, 4K or 60 fps where the phone can,
 * with its lenses, the light and the sound up to the person.
 */

/** Whether this phone can film in the app (a live camera and a recorder). */
export function canFilmInApp(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof (window as { MediaRecorder?: unknown }).MediaRecorder === "function"
    );
  } catch {
    return false;
  }
}

export type FilmQuality = "720p" | "1080p" | "4k";
export type FilmFps = 30 | 60;
export type Facing = "environment" | "user";

export type FilmSettings = {
  quality: FilmQuality;
  fps: FilmFps;
  /** Record the mic (off keeps their music playing: iOS stops it to record sound). */
  sound: boolean;
  /** Rule-of-thirds lines over the picture. */
  grid: boolean;
  facing: Facing;
};

export const DEFAULT_FILM_SETTINGS: FilmSettings = { quality: "1080p", fps: 30, sound: true, grid: false, facing: "environment" };

export const FILM_QUALITIES: Record<FilmQuality, { long: number; short: number; label: string }> = {
  "720p": { long: 1280, short: 720, label: "720p" },
  "1080p": { long: 1920, short: 1080, label: "1080p" },
  "4k": { long: 3840, short: 2160, label: "4K" },
};

/** Recordings are held in memory until they stop: past this the phone can run out (4K for minutes). */
export const RECORD_MEMORY_BYTES = 320 * 1024 * 1024;

/** The longest a set is filmed (the trimmer and the lift finder cut it to the set). */
export const SET_RECORD_MAX_SECONDS = 5 * 60;

/** Where it's kept on the phone (per device: cameras differ phone to phone). */
export const FILM_SETTINGS_KEY = "jf-film-camera-v1";

const QUALITY_KEYS = Object.keys(FILM_QUALITIES) as FilmQuality[];

/** Anything stored that isn't a setting falls back to the default, field by field. */
export function sanitizeFilmSettings(raw: unknown): FilmSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    quality: QUALITY_KEYS.includes(r.quality as FilmQuality) ? (r.quality as FilmQuality) : DEFAULT_FILM_SETTINGS.quality,
    fps: r.fps === 60 ? 60 : 30,
    sound: typeof r.sound === "boolean" ? r.sound : DEFAULT_FILM_SETTINGS.sound,
    grid: typeof r.grid === "boolean" ? r.grid : DEFAULT_FILM_SETTINGS.grid,
    facing: r.facing === "user" ? "user" : "environment",
  };
}

export function readFilmSettings(storage: Pick<Storage, "getItem"> | null = safeStorage()): FilmSettings {
  try {
    const raw = storage?.getItem(FILM_SETTINGS_KEY);
    return sanitizeFilmSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_FILM_SETTINGS };
  }
}

export function saveFilmSettings(s: FilmSettings, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(FILM_SETTINGS_KEY, JSON.stringify(sanitizeFilmSettings(s)));
  } catch {
    /* private mode / blocked storage: the settings last for this visit */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * What to ask the camera for. Ideal values, never exact: a phone that can't
 * do 4K60 gives the nearest it can, and the screen then says what it got
 * (`describeTrack`). Width / height are the landscape sizes: phones turn them
 * to the way they're held.
 */
export function videoConstraints(s: Pick<FilmSettings, "quality" | "fps" | "facing">, deviceId?: string | null): MediaTrackConstraints {
  const q = FILM_QUALITIES[s.quality];
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: s.facing } }),
    width: { ideal: q.long },
    height: { ideal: q.short },
    frameRate: { ideal: s.fps },
  };
}

/** The asks in order: everything, then without the frame rate, then just the camera. */
export function constraintLadder(s: Pick<FilmSettings, "quality" | "fps" | "facing">, deviceId?: string | null): MediaTrackConstraints[] {
  const full = videoConstraints(s, deviceId);
  const { frameRate: _fr, ...noFps } = full;
  const plain: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: s.facing };
  return [full, noFps, plain];
}

/**
 * How hard to record (bits a second). Close to what the phone's own camera
 * uses for the same picture (an iPhone films 1080p30 at ~10 Mbps in H.264,
 * 4K30 at ~25+): the clip is cut and shrunk for where it goes later, so the
 * recording itself should be clean.
 */
export function recorderBitrate(width: number, height: number, fps: number): number {
  const px = Math.max(1, width) * Math.max(1, height);
  const rate = Math.min(Math.max(fps || 30, 15), 60);
  // bits per pixel: a little less as the picture grows (4K compresses better)
  const bpp = px >= 3840 * 2160 * 0.9 ? 0.1 : px >= 1920 * 1080 * 0.9 ? 0.135 : 0.17;
  return Math.round(Math.min(40_000_000, Math.max(4_000_000, px * rate * bpp)));
}

/** The longest this recording can run: the place's limit, or what fits in memory at this bitrate. */
export function recordLimitSeconds(bitrate: number, placeMaxSeconds: number, memoryBytes = RECORD_MEMORY_BYTES): number {
  const fit = Math.floor((memoryBytes * 8) / Math.max(1, bitrate + 128_000));
  return Math.max(15, Math.min(placeMaxSeconds, fit));
}

/**
 * The recorder formats to try, best first. H.264 MP4 plays on every phone and
 * in every browser (HEVC doesn't on Android or Chrome), at the profile level
 * the picture needs; Android's Chrome records WebM.
 */
export function recorderTypes(width: number, height: number, fps: number): string[] {
  const long = Math.max(width, height);
  const level = long > 1920 ? "640033" : fps > 31 && long > 1280 ? "64002a" : long > 1280 ? "640028" : "64001f";
  return [
    `video/mp4;codecs=avc1.${level},mp4a.40.2`,
    `video/mp4;codecs=avc1.${level}`,
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
}

export function pickType(types: string[], isSupported: (t: string) => boolean): string | null {
  for (const t of types) {
    try {
      if (isSupported(t)) return t;
    } catch {
      /* some web views throw for types they don't know */
    }
  }
  return null;
}

type Range = { min?: number; max?: number };
export type CameraCaps = { width?: Range; height?: Range; frameRate?: Range; zoom?: Range; torch?: boolean };

/** The qualities this camera can give (from what it says it can do; 720p and 1080p when it won't say). */
export function availableQualities(caps: CameraCaps | null | undefined): FilmQuality[] {
  const long = Math.max(caps?.width?.max ?? 0, caps?.height?.max ?? 0);
  if (!long) return ["720p", "1080p"];
  const out: FilmQuality[] = ["720p"];
  if (long >= 1920) out.push("1080p");
  if (long >= 3840) out.push("4k");
  return out;
}

/** 60 fps only where the camera says it can. */
export function availableFps(caps: CameraCaps | null | undefined): FilmFps[] {
  return (caps?.frameRate?.max ?? 0) >= 59 ? [30, 60] : [30];
}

/** The setting the camera can actually do: a quality it can't is the best one it can. */
export function fitSettings(s: FilmSettings, caps: CameraCaps | null | undefined): FilmSettings {
  const qs = availableQualities(caps);
  const quality = qs.includes(s.quality) ? s.quality : qs[qs.length - 1];
  const fps = availableFps(caps).includes(s.fps) ? s.fps : 30;
  return { ...s, quality, fps };
}

/** "1080p · 30", read from what the camera is actually giving (never what was asked for). */
export function describeTrack(t: { width?: number; height?: number; frameRate?: number } | null | undefined): string {
  if (!t?.width || !t?.height) return "";
  const short = Math.min(t.width, t.height);
  const res = short >= 2100 ? "4K" : short >= 1070 ? "1080p" : short >= 710 ? "720p" : `${short}p`;
  const fps = t.frameRate ? Math.round(t.frameRate) : null;
  return fps ? `${res} · ${fps}` : res;
}

export type Lens = { deviceId: string; label: string; zoom: number };

/**
 * The back lenses, from the camera names iPhones give (after the camera's
 * been allowed): Ultra Wide (0.5), the main camera (1), Telephoto. The
 * combined "Dual" / "Triple" cameras and the front one aren't lenses to pick.
 * Phones that don't name their lenses get none (one camera, as before).
 */
export function lensesFrom(devices: Array<{ deviceId: string; label: string; kind: string }>): Lens[] {
  const back = devices.filter((d) => d.kind === "videoinput" && d.deviceId && /back/i.test(d.label) && !/dual|triple/i.test(d.label));
  const ultra = back.find((d) => /ultra\s*wide/i.test(d.label));
  const tele = back.find((d) => /tele/i.test(d.label));
  const main = back.find((d) => d !== ultra && d !== tele);
  if (!main || (!ultra && !tele)) return [];
  const out: Lens[] = [];
  if (ultra) out.push({ deviceId: ultra.deviceId, label: "0.5", zoom: 0.5 });
  out.push({ deviceId: main.deviceId, label: "1×", zoom: 1 });
  if (tele) out.push({ deviceId: tele.deviceId, label: "Tele", zoom: 2 });
  return out;
}

/** A pinch's zoom, kept inside what the camera allows. */
export function clampZoom(z: number, range: Range | null | undefined): number {
  const min = range?.min ?? 1;
  const max = Math.min(range?.max ?? 1, 10);
  return Math.round(Math.min(max, Math.max(min, z)) * 10) / 10;
}

/** "0:42" while recording. */
export function recordClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The file a recording becomes (named so it counts as filmed here: offered to Photos, looksFilmedInApp). */
export function filmFileName(mime: string, now = Date.now()): string {
  return `jf-film-${now}.${/mp4/i.test(mime) ? "mp4" : "webm"}`;
}
