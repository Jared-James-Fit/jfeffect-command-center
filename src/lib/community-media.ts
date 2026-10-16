/**
 * Browser-side media prep + upload for community posts.
 *
 * Nothing here runs until the athlete actually picks a file (no camera or
 * library permission is requested up front). Uploads start as soon as
 * something is picked (the studio's slides, the composer's photo or clip),
 * so by the time the caption's written, Post only has to save.
 *
 *   photo → ≤1440px JPEG for the feed + ≤720px thumbnail (the feed only ever
 *           loads the thumbnail until a post is opened full-size).
 *   video → any recording up to 20 minutes can be picked; one longer than its
 *           place allows (a story 60 s, a workout recap 90 s, a post 3 min)
 *           opens the trimmer first. Only the selection is cut out and, when
 *           it pays, shrunk to 720p on the phone (video-edit/), then uploaded
 *           resumably and checked by the server. Plus a poster frame JPEG from
 *           the selection's first moment, so the feed never loads video bytes
 *           up front.
 */
import { compressImage } from "@/lib/image-compress";
import { uploadLiftFileToStorage } from "@/lib/lift-video-storage-upload";
import { supabase } from "@/integrations/supabase/client";
import { checkMediaFile } from "@/lib/community";
import { captureVideoPoster } from "@/lib/video-poster";
import type { VideoContext } from "@/lib/video-edit/limits";
import { pickVideo, preloadVideoEngine, retrimVideo, type PickedVideo, type TrimFn } from "@/lib/video-edit/pick";
import { createVideoSend, videoErrorMessage, type VideoSend } from "@/lib/video-edit/pipeline";

export const COMMUNITY_BUCKET = "community-media" as const;
/** A post picture that ships with the app instead of living in the bucket ("app:community/x.jpg" → /community/x.jpg). */
export const APP_MEDIA = "app:";

export type PickedMedia = {
  kind: "image" | "video";
  file: File;
  /** Object URL for the local preview. Revoke with `releasePicked`. */
  previewUrl: string;
  /** Drawable for the share card (decoded image, or a video poster frame). */
  drawable: HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
  /** JPEG thumbnail (images: downscaled copy; videos: poster frame). May be null for videos. */
  thumb: Blob | null;
  /** A clip: what it is, where it's going and which part goes. */
  video?: PickedVideo & { context: VideoContext };
};

export function releasePicked(m: PickedMedia | null) {
  if (!m) return;
  URL.revokeObjectURL(m.previewUrl);
  // a clip's poster frame has its own local URL
  if (m.drawable instanceof HTMLImageElement && m.drawable.src.startsWith("blob:") && m.drawable.src !== m.previewUrl) URL.revokeObjectURL(m.drawable.src);
}

function loadImageEl(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
}

function blankPoster(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(width / 8));
  c.height = Math.max(2, Math.round(height / 8));
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

export type PickResult = { ok: true; media: PickedMedia } | { ok: false; reason: string; cancelled?: boolean };

export type PickOptions = {
  /** Where a clip is going (its length limit). Defaults to a post. */
  context?: VideoContext;
  /** Opens the trimmer (useVideoTrimmer().request); without it a clip that's too long is refused. */
  trim?: TrimFn;
  /** "Clip 2 of 3" in the trimmer when several were picked at once. */
  step?: { index: number; count: number };
};

/** A picked clip, ready to preview: its poster from the first moment of the selection. */
async function clipMedia(file: File, video: PickedMedia["video"] & object): Promise<PickedMedia> {
  const previewUrl = URL.createObjectURL(file);
  // The poster the iPhone way (in the page, from a presented frame); a phone
  // that won't give a frame still gets the clip in, on a dark card.
  const poster = await captureVideoPoster(file, { maxDimension: 1080, timeoutMs: 10_000, at: video.trim?.start ?? null });
  const width = video.info.width || poster?.width || 0;
  const height = video.info.height || poster?.height || 0;
  let drawable: HTMLImageElement | HTMLCanvasElement = blankPoster(width || 720, height || 1280);
  if (poster) {
    const img = await loadImageEl(URL.createObjectURL(poster.blob));
    if (img) drawable = img;
  }
  return { kind: "video", file, previewUrl, drawable, width, height, thumb: poster?.blob ?? null, video };
}

/** Validate + decode a chosen file for preview (a clip that's too long opens the trimmer). Does not upload. */
export async function pickMedia(file: File, opts: PickOptions = {}): Promise<PickResult> {
  const check = checkMediaFile(file);
  if (!check.ok) return check;

  if (check.kind === "image") {
    const previewUrl = URL.createObjectURL(file);
    const img = await loadImageEl(previewUrl);
    if (!img) {
      URL.revokeObjectURL(previewUrl);
      return { ok: false, reason: "Couldn't read that photo. Try a JPEG or PNG." };
    }
    const thumbFile = await compressImage(file, { maxDimension: 720, quality: 0.78, skipUnder: 0 });
    return {
      ok: true,
      media: { kind: "image", file, previewUrl, drawable: img, width: img.naturalWidth, height: img.naturalHeight, thumb: thumbFile.type === "image/jpeg" ? thumbFile : null },
    };
  }

  const context = opts.context ?? "post";
  const picked = await pickVideo(file, context, { trim: opts.trim, step: opts.step });
  if (!picked.ok) return picked;
  return { ok: true, media: await clipMedia(file, { ...picked.video, context }) };
}

/**
 * Change which part of a picked clip goes (the trimmer opens on the current
 * selection). A new PickedMedia (its own poster) or null when they backed out;
 * the caller releases the old one.
 */
export async function retrimPicked(m: PickedMedia, trim: TrimFn, context: VideoContext = m.video?.context ?? "post"): Promise<PickedMedia | null> {
  if (!m.video) return null;
  const next = await retrimVideo(m.video, context, trim);
  if (!next) return null;
  const same = (next.trim?.start ?? 0) === (m.video.trim?.start ?? 0) && (next.trim?.end ?? m.video.info.duration) === (m.video.trim?.end ?? m.video.info.duration);
  if (same && context === m.video.context) return null;
  return clipMedia(m.file, { ...next, context });
}

/** Seconds a picked clip will run once trimmed. */
export function pickedSeconds(m: PickedMedia | null | undefined): number | null {
  const v = m?.video;
  if (!v) return null;
  return v.trim ? v.trim.end - v.trim.start : v.info.duration;
}

/** Start loading the video tools while the picker is open (the first clip then doesn't wait on them). */
export function preloadMediaTools() {
  preloadVideoEngine();
}

export type UploadedMedia = {
  media_path: string;
  media_thumb_path: string | null;
  media_type: "image" | "video";
  media_width: number;
  media_height: number;
};

/** Upload the picked media (and its thumbnail) under `${userId}/…`. */
export async function uploadPicked(m: PickedMedia, userId: string, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<UploadedMedia> {
  if (m.kind === "video") return uploadVideo(m, userId, onProgress, signal);
  let main: File | Blob = m.file;
  if (m.kind === "image") main = await compressImage(m.file, { maxDimension: 1440, quality: 0.84, skipUnder: 0 });
  const mainFile = main instanceof File ? main : new File([main], "photo.jpg", { type: main.type || "image/jpeg" });

  const up = await uploadLiftFileToStorage({
    file: mainFile,
    userId,
    bucket: COMMUNITY_BUCKET,
    onProgress: (p) => onProgress?.(m.thumb ? Math.round(p * 0.92) : p),
    signal,
  });

  let thumbPath: string | null = null;
  if (m.thumb) {
    try {
      const t = await uploadLiftFileToStorage({
        file: new File([m.thumb], "thumb.jpg", { type: "image/jpeg" }),
        userId,
        bucket: COMMUNITY_BUCKET,
      });
      thumbPath = t.path;
    } catch {
      thumbPath = null; // a missing thumbnail only costs feed speed — never fail the post
    }
  }
  onProgress?.(100);
  return { media_path: up.path, media_thumb_path: thumbPath, media_type: m.kind, media_width: m.width, media_height: m.height };
}

/** One send per picked clip: trying again carries on from what's done (cut, uploaded, checked). */
const clipSends = new WeakMap<PickedMedia, { userId: string; stem: string; send: VideoSend; poster: Promise<string | null> | null }>();

/**
 * A clip: the selection cut (and shrunk when it pays) on the phone, uploaded
 * resumably and checked by the server (video-edit/pipeline.ts). The poster
 * uploads alongside.
 */
async function uploadVideo(m: PickedMedia, userId: string, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<UploadedMedia> {
  const v = m.video;
  if (!v) throw new Error("Pick that clip again.");
  let entry = clipSends.get(m);
  if (!entry || entry.userId !== userId) {
    const stem = `${userId}/${Date.now()}-${crypto.randomUUID()}`;
    entry = { userId, stem, send: createVideoSend({ file: m.file, info: v.info, canEncode: v.canEncode, trim: v.trim, context: v.context, bucket: COMMUNITY_BUCKET, userId, stem }), poster: null };
    clipSends.set(m, entry);
  }
  const e = entry;
  // a missing poster only costs feed speed: never fails the post
  if (!e.poster && m.thumb) {
    e.poster = uploadLiftFileToStorage({ file: new File([m.thumb], "poster.jpg", { type: "image/jpeg" }), userId, bucket: COMMUNITY_BUCKET, path: `${e.stem}-poster.jpg` }).then((r) => r.path, () => {
      e.poster = null;
      return null;
    });
  }
  let sent;
  try {
    sent = await e.send.run((pct) => onProgress?.(Math.max(1, Math.min(99, pct))), signal);
  } catch (err) {
    // stopped on purpose (removed, re-trimmed, closed): its poster goes too
    if (signal?.aborted && e.poster) {
      const poster = e.poster;
      e.poster = null;
      void poster.then((p) => {
        if (p) void removeCommunityFiles([p]);
      });
    }
    throw new Error(videoErrorMessage(err));
  }
  const thumbPath = e.poster ? await e.poster : null;
  onProgress?.(100);
  return { media_path: sent.path, media_thumb_path: thumbPath, media_type: "video", media_width: m.width, media_height: m.height };
}

/* ---- community profile photo -------------------------------------- */

/**
 * Centre-crop a chosen photo to a 512px square JPEG. Lives in the existing
 * private `avatars` bucket under `<uid>/community-*` (owner-write, signed-in
 * read), separate from the account / identity photo.
 */
export async function prepareCommunityAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Pick a photo");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageEl(url);
    if (!img) throw new Error("Couldn't read that photo. Try a JPEG or PNG.");
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(512, side);
    const c = document.createElement("canvas");
    c.width = out;
    c.height = out;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    const blob = await canvasToJpeg(c, 0.86);
    c.width = c.height = 0;
    if (!blob) throw new Error("Couldn't prepare that photo");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadCommunityAvatar(file: File, userId: string): Promise<string> {
  const blob = await prepareCommunityAvatar(file);
  const path = `${userId}/community-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

/** Best-effort cleanup of files no post points at any more. */
export async function removeCommunityFiles(paths: (string | null | undefined)[]) {
  // a picture shipped with the app isn't in the bucket
  const list = paths.filter((p): p is string => !!p && !p.startsWith(APP_MEDIA) && !/^https?:\/\//.test(p));
  if (!list.length) return;
  try {
    await supabase.storage.from(COMMUNITY_BUCKET).remove(list);
  } catch {
    /* orphaned files are harmless and private */
  }
}

/* ---- signed URLs (batched + cached) --------------------------------- */

const urlCache = new Map<string, { url: string; expiresAt: number }>();
const TTL_MS = 50 * 60 * 1000;

/** One round trip for every uncached path on a feed page. */
export async function signCommunityPaths(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const wanted = Array.from(new Set(paths.filter((p): p is string => !!p)));
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of wanted) {
    // "app:<file>": a picture that ships with the app (public/), no signing
    if (p.startsWith(APP_MEDIA)) {
      out[p] = `/${p.slice(APP_MEDIA.length)}`;
      continue;
    }
    // a GIF from the library is already a public link
    if (/^https:\/\//.test(p)) {
      out[p] = p;
      continue;
    }
    const hit = urlCache.get(p);
    if (hit && hit.expiresAt > now) out[p] = hit.url;
    else missing.push(p);
  }
  if (missing.length) {
    // a failed batch throws, so the query retries instead of caching blank photos
    const { data, error } = await supabase.storage.from(COMMUNITY_BUCKET).createSignedUrls(missing, 60 * 60);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) {
        urlCache.set(row.path, { url: row.signedUrl, expiresAt: now + TTL_MS });
        out[row.path] = row.signedUrl;
      }
    }
  }
  return out;
}

/** Voice memos are kept short: two minutes at most. */
export const VOICE_MAX_SECONDS = 120;

/** Upload a voice memo under `${userId}/…` in the community bucket. */
export async function uploadVoiceMemo(blob: Blob, userId: string, onProgress?: (pct: number) => void): Promise<string> {
  const ext = blob.type.includes("mp4") || blob.type.includes("m4a") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || "audio/webm" });
  const up = await uploadLiftFileToStorage({ file, userId, bucket: COMMUNITY_BUCKET, onProgress });
  return up.path;
}
