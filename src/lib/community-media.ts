/**
 * Browser-side media prep + upload for community posts.
 *
 * Nothing here runs until the athlete actually picks a file (no camera or
 * library permission is requested up front) and nothing is uploaded until they
 * press Post — choosing a photo only changes the local preview.
 *
 *   photo → ≤1440px JPEG for the feed + ≤720px thumbnail (the feed only ever
 *           loads the thumbnail until a post is opened full-size).
 *   video → uploaded as-is (≤50 MB, ≤45 s, checked before upload) plus a
 *           poster frame JPEG, so the feed never loads video bytes up front.
 */
import { compressImage } from "@/lib/image-compress";
import { uploadLiftFileToStorage } from "@/lib/lift-video-storage-upload";
import { supabase } from "@/integrations/supabase/client";
import { checkMediaFile, checkVideoDuration } from "@/lib/community";

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
  if (m) URL.revokeObjectURL(m.previewUrl);
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

/** Poster frame + metadata for a video, or null when the browser can't decode it. */
async function readVideo(url: string): Promise<{ canvas: HTMLCanvasElement; duration: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    let done = false;
    const finish = (out: Awaited<ReturnType<typeof readVideo>>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      resolve(out);
    };
    const timer = setTimeout(() => finish(null), 8000);
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => {
      const target = Math.min(0.4, Math.max(0, (v.duration || 0) / 2));
      v.currentTime = target;
    };
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 1080 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        finish({ canvas: c, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      } catch {
        finish(null);
      }
    };
    v.src = url;
  });
}

export type PickResult = { ok: true; media: PickedMedia } | { ok: false; reason: string };

/** Validate + decode a chosen file for preview. Does not upload. */
export async function pickMedia(file: File): Promise<PickResult> {
  const check = checkMediaFile(file);
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

  const info = await readVideo(previewUrl);
  if (!info) {
    URL.revokeObjectURL(previewUrl);
    return { ok: false, reason: "Couldn't read that video. Try a short MP4 or MOV clip." };
  }
  const dur = checkVideoDuration(info.duration);
  if (!dur.ok) {
    URL.revokeObjectURL(previewUrl);
    return dur;
  }
  return {
    ok: true,
    media: { kind: "video", file, previewUrl, drawable: info.canvas, width: info.width, height: info.height, thumb: await canvasToJpeg(info.canvas, 0.8) },
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
  const list = paths.filter((p): p is string => !!p && !p.startsWith(APP_MEDIA));
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
    const hit = urlCache.get(p);
    if (hit && hit.expiresAt > now) out[p] = hit.url;
    else missing.push(p);
  }
  if (missing.length) {
    const { data } = await supabase.storage.from(COMMUNITY_BUCKET).createSignedUrls(missing, 60 * 60);
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) {
        urlCache.set(row.path, { url: row.signedUrl, expiresAt: now + TTL_MS });
        out[row.path] = row.signedUrl;
      }
    }
  }
  return out;
}
