/**
 * The phone's camera roll, in the installed iPhone app only (Nov 24 2026).
 *
 * A web page can't see someone's photos (Safari, the home-screen app): it can
 * only open Apple's picker from a tap. The App Store app links its own plugin
 * (native/jf-photos, JfPhotosPlugin.swift), so there the New post screen shows
 * the photos inline the way Instagram does (camera-roll.tsx). Everything here
 * is a no-op without it: `hasNativePhotos()` is false on the web and in builds
 * from before it, and the composer keeps Apple's picker.
 *
 * Only what the person taps ever reaches the page: a photo as an upright JPEG
 * (its long side at most PHOTO_MAX_SIDE), a video as its own file. It's read
 * back through the bridge in base64 chunks (the page is served from
 * jfeffect.com, where Capacitor's local-file URLs don't reach) into a File the
 * slide tray takes like any other pick, named as it is in Photos (IMG_1234.MOV),
 * so the video tools read it as a library pick, never as one filmed in the app.
 */

export type PhotoAccess = "authorized" | "limited" | "denied" | "restricted" | "notDetermined";

export type RollAsset = {
  id: string;
  kind: "image" | "video";
  width: number;
  height: number;
  /** Seconds (a video). */
  duration: number;
  /** ms since 1970. */
  created: number;
  /** A small JPEG data URL for the tile (missing: only in iCloud for now). */
  thumb?: string | null;
};

export type RollAlbum = { id: string; title: string; count: number };

type Opened =
  | { tooBig: true; size: number }
  | {
      tooBig?: false;
      token: string;
      name: string;
      mime: string;
      size: number;
      width: number;
      height: number;
      duration: number;
    };

type Handle = { remove: () => Promise<void> | void };

type Plugin = {
  status(): Promise<{ status: PhotoAccess }>;
  requestAccess(): Promise<{ status: PhotoAccess }>;
  manageLimited(): Promise<void>;
  openSettings(): Promise<void>;
  albums(): Promise<{ albums: RollAlbum[] }>;
  list(o: {
    album: string;
    offset: number;
    limit: number;
    thumb: number;
    kind?: "image" | "video";
  }): Promise<{ total: number; assets: RollAsset[] }>;
  open(o: { id: string; maxSide: number; maxBytes: number }): Promise<Opened>;
  read(o: {
    token: string;
    offset: number;
    length: number;
  }): Promise<{ data: string; eof: boolean }>;
  close(o: { token: string }): Promise<void>;
  addListener(
    event: "progress" | "change",
    cb: (data: { id?: string; progress?: number }) => void,
  ): Promise<Handle> | Handle;
};

export const RECENTS = "recents";
/** Tiles per page (four rows of twelve on a phone; the next page loads a screen before the end). */
export const ROLL_PAGE = 48;
/** A tile's thumbnail, px on its short side (3:4 tiles, about a quarter of a 430pt phone at 3x). */
export const ROLL_THUMB = 300;
/** A picked photo's long side: plenty for a 1080-wide post zoomed in on, a few MB through the bridge. */
export const PHOTO_MAX_SIDE = 3072;
/**
 * The biggest video read into the page from the grid. Past it a clip is held
 * in the web view's memory whole; Apple's picker hands the page a file on
 * disk instead, so it's offered for those ("Choose it from your library").
 */
export const ROLL_VIDEO_MAX_BYTES = 250 * 1024 * 1024;
/** One read through the bridge (raw bytes; about 4 MB as base64). */
export const READ_CHUNK = 3 * 1024 * 1024;

/** What the app's own bridge (native-bridge.js) puts on the page before any of our code runs. */
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown>;
};

function cap(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
}

/** The plugin, when this app build links it (never on the web). */
export function nativePhotos(): Plugin | null {
  try {
    const c = cap();
    if (!c?.isNativePlatform?.() || !c.isPluginAvailable?.("JfPhotos")) return null;
    return (c.Plugins?.JfPhotos as Plugin) ?? null;
  } catch {
    return null;
  }
}

/** The New post screen can show the camera roll itself (the iPhone app with the plugin). */
export function hasNativePhotos(): boolean {
  return !!nativePhotos();
}

export function canSeePhotos(a: PhotoAccess | null | undefined): boolean {
  return a === "authorized" || a === "limited";
}

/**
 * A rough upper size for a video from its length and size, before anything is
 * copied (iPhone HEVC: ~6 MB/s at 4K, ~2 MB/s at 1080p, ~1 MB/s below). Only
 * decides whether to try the grid at all; the plugin checks the real size.
 */
export function estimateVideoBytes(a: Pick<RollAsset, "width" | "height" | "duration">): number {
  const long = Math.max(a.width, a.height);
  const perSecond = long >= 3000 ? 6_000_000 : long >= 1800 ? 2_000_000 : 1_000_000;
  return Math.max(0, a.duration) * perSecond;
}

/** Decode one base64 chunk (Safari 18.2+ does it natively). */
export function base64ToBytes(b64: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (typeof native === "function") return native.call(Uint8Array, b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The byte ranges a file of `size` is read in. */
export function chunkRanges(
  size: number,
  chunk = READ_CHUNK,
): Array<{ offset: number; length: number }> {
  const out: Array<{ offset: number; length: number }> = [];
  for (let offset = 0; offset < size; offset += chunk)
    out.push({ offset, length: Math.min(chunk, size - offset) });
  return out;
}

export class RollCancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

export type RollLoad = { file: File } | { tooBig: true };

/**
 * The asset as a File (a photo as an upright JPEG, a video as its own file),
 * or `tooBig` for a video past ROLL_VIDEO_MAX_BYTES. `onProgress` (0–1) covers
 * an iCloud download and the read; `cancelled()` true stops it between chunks.
 */
export async function loadRollFile(
  asset: RollAsset,
  opts: { onProgress?: (p: number) => void; cancelled?: () => boolean } = {},
): Promise<RollLoad> {
  const p = nativePhotos();
  if (!p) throw new Error("Photos aren't available here");
  if (asset.kind === "video" && estimateVideoBytes(asset) > ROLL_VIDEO_MAX_BYTES * 1.5)
    return { tooBig: true };
  let listener: Handle | null = null;
  try {
    listener = await p.addListener("progress", (d) => {
      if (d?.id === asset.id && typeof d.progress === "number") opts.onProgress?.(d.progress * 0.5);
    });
  } catch {
    listener = null;
  }
  try {
    const opened = await p.open({
      id: asset.id,
      maxSide: PHOTO_MAX_SIDE,
      maxBytes: asset.kind === "video" ? ROLL_VIDEO_MAX_BYTES : 0,
    });
    if (opened.tooBig) return { tooBig: true };
    try {
      const parts: Uint8Array[] = [];
      const ranges = chunkRanges(opened.size);
      for (let i = 0; i < ranges.length; i++) {
        if (opts.cancelled?.()) throw new RollCancelled();
        const { data } = await p.read({ token: opened.token, ...ranges[i] });
        parts.push(base64ToBytes(data));
        opts.onProgress?.(0.5 + (0.5 * (i + 1)) / ranges.length);
      }
      if (opts.cancelled?.()) throw new RollCancelled();
      return {
        file: new File(parts as BlobPart[], opened.name, {
          type: opened.mime,
          lastModified: asset.created || Date.now(),
        }),
      };
    } finally {
      void Promise.resolve(p.close({ token: opened.token })).catch(() => undefined);
    }
  } finally {
    try {
      await listener?.remove();
    } catch {
      /* gone */
    }
  }
}

/* ---- picking: which tap does what (pure, tested) -------------------------- */

export type RollTap =
  /** Load it into the post; `replace`: the picks it takes the place of (one at a time). */
  | { kind: "add"; replace: string[] }
  /** Already picked: show it. */
  | { kind: "focus" }
  /** Picked and on show (several at a time): take it off. */
  | { kind: "remove" }
  /** Several at a time and the post is full. */
  | { kind: "full" };

/**
 * Instagram's New post: one at a time, a tap shows that photo instead (the one
 * before comes off); with Select on, a tap adds it (numbered in the order
 * picked), a tap on one picked shows it, and a tap on the one showing takes it
 * off. `picked`: the keys picked so far; `max`: what a post holds.
 */
export function rollTap(a: {
  multi: boolean;
  picked: string[];
  showing: string | null;
  key: string;
  max: number;
  /** The tap landed on a picked tile's number (Select on): it comes off at once, showing or not. */
  badge?: boolean;
}): RollTap {
  const on = a.picked.includes(a.key);
  if (a.multi && on && a.badge) return { kind: "remove" };
  if (!a.multi) return on ? { kind: "focus" } : { kind: "add", replace: a.picked.slice() };
  if (on) return a.showing === a.key ? { kind: "remove" } : { kind: "focus" };
  if (a.picked.length >= a.max) return { kind: "full" };
  return { kind: "add", replace: [] };
}

/** "0:42", "12:05" for a video tile. */
export function tileClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A hold on a tile one at a time switches Select on with that tile picked
 * (Instagram's): the photo showing stays picked as number 1.
 */
export const ROLL_HOLD_MS = 420;

/* ---- limited access: said once, then a quiet Manage -------------------- */

export const ROLL_LIMITED_SEEN_KEY = "jf-roll-limited-seen-v1";

/**
 * "You've allowed some of your photos" is said the first time the grid shows
 * with limited access; after that only a small Manage stays in the grid's
 * head, so a person who chose limited access is never nagged about it.
 */
export function limitedNotice(
  access: PhotoAccess | null,
  storage: Pick<Storage, "getItem"> | null,
): "banner" | "quiet" | null {
  if (access !== "limited") return null;
  try {
    return storage?.getItem(ROLL_LIMITED_SEEN_KEY) ? "quiet" : "banner";
  } catch {
    return "quiet";
  }
}
