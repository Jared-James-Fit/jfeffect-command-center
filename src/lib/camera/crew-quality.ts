/**
 * How sharp the Crew camera films (Nov 23 2026): HD (1080p) or 4K, the
 * iPhone camera's own "HD · 4K" switch, top right in the camera.
 *
 * What each means here, honestly: the camera's picture is asked for at that
 * size (`studioCameraAsk`), so a photo is taken from a 4K frame and a digital
 * zoom up to 2× still has full detail; a clip is always recorded at most
 * 1080 × 1920 (`recordSize`: a 4K camera brought down to 1080p through the
 * same canvas a digital zoom films through), the most a Crew post plays and
 * what goes up untouched (plan.ts `caps.hd`), so 4K films a sharper 1080p,
 * never a 4K file a post can't take. A photo is posted 1080 wide either way
 * (Instagram's width), drawn down from whatever the camera gave.
 *
 * Remembered on the phone (cameras differ phone to phone), apart from the
 * set camera's own settings (film-settings.ts). Pure, so it's tested.
 */

export type CrewQuality = "hd" | "4k";

export const CREW_QUALITY_KEY = "jf-crew-camera-quality-v1";
/** HD to start: every phone films it smoothly, and it's what a post plays. */
export const DEFAULT_CREW_QUALITY: CrewQuality = "hd";

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readCrewQuality(storage: Pick<Storage, "getItem"> | null = safeStorage()): CrewQuality {
  try {
    return storage?.getItem(CREW_QUALITY_KEY) === "4k" ? "4k" : DEFAULT_CREW_QUALITY;
  } catch {
    return DEFAULT_CREW_QUALITY;
  }
}

export function saveCrewQuality(q: CrewQuality, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(CREW_QUALITY_KEY, q);
  } catch {
    /* private mode: this visit only */
  }
}

type Range = { min?: number; max?: number };

/**
 * What this camera can give: 4K where its capabilities reach 3840 on the
 * long side, HD only where they say less. A camera that won't say (an older
 * web view) is offered both: asking for 4K costs nothing, and the switch
 * then says what came (`qualityLabel`).
 */
export function crewQualities(caps: { width?: Range; height?: Range } | null | undefined): CrewQuality[] {
  const long = Math.max(caps?.width?.max ?? 0, caps?.height?.max ?? 0);
  if (!long) return ["hd", "4k"];
  return long >= 3840 ? ["hd", "4k"] : ["hd"];
}

/** What the picture actually is, by its short side ("4K", "HD", "720p", "SD"): never what was asked for. */
export function qualityLabel(w: number | null | undefined, h: number | null | undefined): string | null {
  if (!w || !h) return null;
  const short = Math.min(w, h);
  if (short >= 2100) return "4K";
  if (short >= 1070) return "HD";
  if (short >= 710) return "720p";
  return "SD";
}

/** The most a recorded clip is on its long side: 1080p, what a Crew post plays and goes up as it is. */
export const RECORD_LONG_MAX = 1920;

/** The size a clip is recorded at: the picture brought down to `RECORD_LONG_MAX`, its shape kept, even numbers. */
export function recordSize(w: number, h: number, max = RECORD_LONG_MAX): { width: number; height: number } {
  if (!(w > 0 && h > 0)) return { width: Math.max(0, Math.round(w || 0)), height: Math.max(0, Math.round(h || 0)) };
  const k = Math.min(1, max / Math.max(w, h));
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return k >= 1 ? { width: w, height: h } : { width: even(w), height: even(h) };
}

/** A clip films through the canvas when the camera's picture is bigger than a recording keeps. */
export function needsDownscale(w: number, h: number, max = RECORD_LONG_MAX): boolean {
  return Math.max(w || 0, h || 0) > max;
}
