// Resumable, progress-aware upload of a lift video/photo straight into the
// Supabase Storage `lift-videos` bucket. This is the new PRIMARY upload path
// for client lift submissions — Google Drive is handled separately as a
// background archive only.
//
// Uses Supabase's TUS-compatible resumable endpoint so big iPhone videos
// survive flaky connections and the user can retry from the same point.
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
const SUPABASE_ANON =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (typeof process !== "undefined" ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined);

export type LiftStorageUploadResult = {
  path: string;
  mimeType: string;
  sizeBytes: number;
};

export type LiftStorageUploadArgs = {
  file: File;
  userId: string;
  /** Defaults to the existing lift-videos bucket; message attachments opt in explicitly. */
  bucket?: "lift-videos" | "message-attachments" | "progress-media";
  /** Preserve callers' established storage paths when they already own path generation. */
  path?: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
};

/**
 * Upload a single file via Supabase's TUS resumable endpoint.
 * Path format: `${userId}/${timestamp}-${uuid}.${ext}`. Matches the existing
 * storage RLS policy (`storage.foldername(name)[1] = auth.uid()`).
 */
export async function uploadLiftFileToStorage(
  args: LiftStorageUploadArgs,
): Promise<LiftStorageUploadResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    throw new Error("Storage not configured.");
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired. Please sign in again.");

  const ext = (args.file.name.split(".").pop() || "mp4").toLowerCase();
  const path = args.path ?? `${args.userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const bucket = args.bucket ?? "lift-videos";
  const contentType = args.file.type || guessContentType(ext);

  // Give the UI feedback before auth/network setup. This avoids a "dead" pause
  // after the user picks a photo/video.
  args.onProgress?.(1);

  // Supabase's resumable/TUS path is excellent for large videos, but its
  // creation handshake is noticeable for tiny phone photos (e.g. 100–500 KB).
  // Use one direct authenticated Storage request for small/medium files and
  // reserve TUS for larger files where resumability matters.
  const DIRECT_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
  if (args.file.size <= DIRECT_UPLOAD_MAX_BYTES && typeof XMLHttpRequest !== "undefined") {
    await uploadDirectWithProgress({
      bucket,
      path,
      file: args.file,
      contentType,
      token,
      anonKey: SUPABASE_ANON,
      supabaseUrl: SUPABASE_URL,
      onProgress: args.onProgress,
      signal: args.signal,
    });
    args.onProgress?.(100);
    return { path, mimeType: contentType, sizeBytes: args.file.size };
  }

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(args.file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10_000, 20_000],
      headers: {
        authorization: `Bearer ${token}`,
        "x-upsert": "false",
        apikey: SUPABASE_ANON,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType,
        cacheControl: "3600",
      },
      onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      onProgress: (bytesSent, bytesTotal) => {
        if (!args.onProgress || !bytesTotal) return;
        const pct = Math.max(1, Math.min(99, Math.round((bytesSent / bytesTotal) * 100)));
        args.onProgress(pct);
      },
      onSuccess: () => resolve(),
    });
    if (args.signal) {
      const onAbort = () => {
        try { void upload.abort(true); } catch { /* noop */ }
        reject(new Error("Upload cancelled."));
      };
      if (args.signal.aborted) onAbort();
      else args.signal.addEventListener("abort", onAbort, { once: true });
    }
    upload.start();
  });

  args.onProgress?.(100);
  return { path, mimeType: contentType, sizeBytes: args.file.size };
}

function encodeStoragePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function uploadDirectWithProgress(args: {
  bucket: string;
  path: string;
  file: File;
  contentType: string;
  token: string;
  anonKey: string;
  supabaseUrl: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url =
      `${args.supabaseUrl}/storage/v1/object/${encodeURIComponent(args.bucket)}/${encodeStoragePath(args.path)}`;
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${args.token}`);
    xhr.setRequestHeader("apikey", args.anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", args.contentType);
    xhr.setRequestHeader("cache-control", "3600");

    xhr.upload.onprogress = (e) => {
      if (!args.onProgress) return;
      const total = e.lengthComputable ? e.total : args.file.size;
      if (!total) return;
      const pct = Math.max(1, Math.min(99, Math.round((e.loaded / total) * 100)));
      args.onProgress(pct);
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.onload = () => {
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) {
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
      }
    };

    if (args.signal) {
      const onAbort = () => xhr.abort();
      if (args.signal.aborted) {
        xhr.abort();
        return;
      }
      args.signal.addEventListener("abort", onAbort, { once: true });
    }
    xhr.send(args.file);
  });
}

function guessContentType(ext: string) {
  switch (ext) {
    case "mov":
    case "qt":
      return "video/quicktime";
    case "m4v":
      return "video/x-m4v";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "heic":
      return "image/heic";
    default:
      return "application/octet-stream";
  }
}