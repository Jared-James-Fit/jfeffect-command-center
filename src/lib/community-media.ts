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
 *   video → ≤60 s. The original starts uploading at once while the phone
 *           shrinks a 720p copy (WebCodecs); whichever lands first is the one
 *           posted (raceVideoUpload, the chat's own pipeline). A clip over the
 *           50 MB storage limit goes only as the shrunk copy. Plus a poster
 *           frame JPEG, so the feed never loads video bytes up front.
 */
import { compressImage } from "@/lib/image-compress";
import { uploadLiftFileToStorage } from "@/lib/lift-video-storage-upload";
import { supabase } from "@/integrations/supabase/client";
import { MAX_VIDEO_BYTES, checkMediaFile, checkVideoDuration, uploadableVideo } from "@/lib/community";
import { captureVideoPoster } from "@/lib/video-poster";
import { canCompressVideo, compressVideoDetailed, preloadVideoCompressor } from "@/lib/video-compress";
import { raceVideoUpload } from "@/lib/video-upload-race";

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

/**
 * A video's size and length without decoding a frame (the container's own
 * header, read in JS), for when the phone won't hand over a poster frame.
 */
async function readVideoMeta(file: File): Promise<{ duration: number; width: number; height: number } | null> {
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    return { duration: await input.computeDuration(), width: track.displayWidth, height: track.displayHeight };
  } catch {
    return null;
  }
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

export type PickResult = { ok: true; media: PickedMedia } | { ok: false; reason: string };

/** Validate + decode a chosen file for preview. Does not upload. */
export async function pickMedia(file: File): Promise<PickResult> {
  const check = checkMediaFile(file, { canShrink: canCompressVideo() });
  if (!check.ok) return check;
  const previewUrl = URL.createObjectURL(file);

  if (check.kind === "image") {
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

  // the encoder downloads while the poster's read, so a big clip doesn't wait on it at Post
  preloadVideoCompressor();
  // The poster the iPhone way (in the page, from a presented frame); a phone
  // that won't give a frame still gets the clip in, sized from its header.
  const poster = await captureVideoPoster(file, { maxDimension: 1080, timeoutMs: 10_000 });
  let duration = poster?.duration ?? NaN;
  let width = poster?.width ?? 0;
  let height = poster?.height ?? 0;
  if (!poster || !duration) {
    const meta = await readVideoMeta(file);
    if (meta) {
      duration = meta.duration;
      if (!width || !height) {
        width = meta.width;
        height = meta.height;
      }
    }
  }
  if (!width || !height) {
    URL.revokeObjectURL(previewUrl);
    return { ok: false, reason: "Couldn't read that video. Try a short MP4 or MOV clip." };
  }
  const dur = checkVideoDuration(duration);
  if (!dur.ok) {
    URL.revokeObjectURL(previewUrl);
    return dur;
  }
  let drawable: HTMLImageElement | HTMLCanvasElement = blankPoster(width, height);
  if (poster) {
    const img = await loadImageEl(URL.createObjectURL(poster.blob));
    if (img) drawable = img;
  }
  return {
    ok: true,
    media: { kind: "video", file, previewUrl, drawable, width, height, thumb: poster?.blob ?? null },
  };
}

export type UploadedMedia = {
  media_path: string;
  media_thumb_path: string | null;
  media_type: "image" | "video";
  media_width: number;
  media_height: number;
};

/** Upload the picked media (and its thumbnail) under `${userId}/…`. */
export async function uploadPicked(m: PickedMedia, userId: string, onProgress?: (pct: number) => void): Promise<UploadedMedia> {
  if (m.kind === "video") return uploadVideo(m, userId, onProgress);
  let main: File | Blob = m.file;
  if (m.kind === "image") main = await compressImage(m.file, { maxDimension: 1440, quality: 0.84, skipUnder: 0 });
  const mainFile = main instanceof File ? main : new File([main], "photo.jpg", { type: main.type || "image/jpeg" });

  const up = await uploadLiftFileToStorage({
    file: mainFile,
    userId,
    bucket: COMMUNITY_BUCKET,
    onProgress: (p) => onProgress?.(m.thumb ? Math.round(p * 0.92) : p),
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

/**
 * A clip, as fast as this phone and connection allow: the original starts
 * uploading at once while a 720p copy is shrunk on the phone, and the copy
 * takes over only if it would land sooner (raceVideoUpload). Over the 50 MB
 * storage limit only the copy can go. The poster uploads alongside.
 */
async function uploadVideo(m: PickedMedia, userId: string, onProgress?: (pct: number) => void): Promise<UploadedMedia> {
  const file = uploadableVideo(m.file);
  const ext = ((file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4");
  const stem = `${userId}/${Date.now()}-${crypto.randomUUID()}`;
  const originalPath = `${stem}.${ext}`;
  const compressedPath = `${stem}-720p.mp4`;
  const put = (f: File, path: string, progress?: (pct: number) => void, signal?: AbortSignal) =>
    uploadLiftFileToStorage({ file: f, userId, bucket: COMMUNITY_BUCKET, path, onProgress: progress, signal });

  const thumbP: Promise<string | null> = m.thumb
    ? put(new File([m.thumb], "thumb.jpg", { type: "image/jpeg" }), `${stem}-poster.jpg`).then((r) => r.path, () => null) // a missing poster only costs feed speed
    : Promise.resolve(null);

  onProgress?.(2);
  let path: string;
  if (file.size <= MAX_VIDEO_BYTES) {
    const r = await raceVideoUpload(
      {
        originalBytes: file.size,
        uploadOriginal: (p, sig) => put(file, originalPath, (pct) => p(pct / 100), sig).then(() => {}),
        compress: (p, sig) => compressVideoDetailed(file, "avc", { onProgress: p, signal: sig }),
        uploadCompressed: (f, p, sig) => put(f, compressedPath, (pct) => p(pct / 100), sig).then(() => {}),
      },
      { onProgress: (f) => onProgress?.(Math.max(2, Math.round(f * 96))) },
    );
    path = r.sent === "compressed" ? compressedPath : originalPath;
  } else {
    // too big to go as it is: shrink first, then send the copy
    const out = await compressVideoDetailed(file, "avc", { onProgress: (p) => onProgress?.(Math.max(2, Math.round(p * 55))) });
    if (!out.file || out.file.size > MAX_VIDEO_BYTES) throw new Error("That clip's too big to post. Trim it shorter in Photos and try again.");
    await put(out.file, compressedPath, (pct) => onProgress?.(55 + Math.round(pct * 0.41)));
    path = compressedPath;
  }
  const thumbPath = await thumbP;
  onProgress?.(100);
  return { media_path: path, media_thumb_path: thumbPath, media_type: "video", media_width: m.width, media_height: m.height };
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
