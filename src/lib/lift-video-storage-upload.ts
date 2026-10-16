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

// Uploaded files are immutable (unique path, never overwritten): one year.
const CACHE_SECONDS = 365 * 24 * 3600;

export type LiftStorageUploadResult = {
  path: string;
  mimeType: string;
  sizeBytes: number;
};

export type LiftStorageUploadArgs = {
  file: File;
  userId: string;
  /** Defaults to the existing lift-videos bucket; message attachments opt in explicitly. */
  bucket?: "lift-videos" | "message-attachments" | "progress-media" | "community-media" | "form-uploads" | "broadcast-media";
  /** Preserve callers' established storage paths when they already own path generation. */
  path?: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
  /**
   * Pick up where an interrupted upload of this same file to this same path
   * left off (anything over 6 MB goes resumable). Videos use it: a dropped
   * connection or a retry never sends the part that already landed again.
   */
  resume?: boolean;
};

/** Bytes a second recent uploads managed (an average), or null before any big enough to tell. */
let uplinkBps: number | null = null;
export function measuredUplink(): number | null {
  return uplinkBps;
}
function noteUplink(bytes: number, ms: number) {
  if (bytes < 512 * 1024 || ms < 300) return;
  const rate = bytes / (ms / 1000);
  uplinkBps = uplinkBps == null ? rate : uplinkBps * 0.6 + rate * 0.4;
}

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
  // Messenger videos benefit from a single streaming request on normal mobile
  // connections; TUS adds a create/resume handshake and 6 MB chunk round trips.
  // Keep resumable uploads for genuinely large files where recovery matters.
  // (a resumable upload never sends a landed part twice, so a video over 6 MB always goes that way)
  const DIRECT_UPLOAD_MAX_BYTES =
    bucket === "message-attachments" && !args.resume ? 40 * 1024 * 1024 : 6 * 1024 * 1024;
  const startedAt = Date.now();
  if (args.file.size <= DIRECT_UPLOAD_MAX_BYTES && typeof XMLHttpRequest !== "undefined") {
    await uploadDirectWithRetry({
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
    noteUplink(args.file.size, Date.now() - startedAt);
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
      // resuming: the same file to the same path only (never a stale upload of another file)
      ...(args.resume ? { fingerprint: async (f: File) => `jf-${bucket}/${path}:${f.size}` } : {}),
      chunkSize: bucket === "message-attachments" ? 12 * 1024 * 1024 : 6 * 1024 * 1024,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType,
        cacheControl: String(CACHE_SECONDS),
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
    if (!args.resume) return upload.start();
    void upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      }, () => {})
      .finally(() => {
        if (!args.signal?.aborted) upload.start();
      });
  });

  noteUplink(args.file.size, Date.now() - startedAt);
  args.onProgress?.(100);
  return { path, mimeType: contentType, sizeBytes: args.file.size };
}

function encodeStoragePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

type DirectUploadArgs = {
  bucket: string;
  path: string;
  file: File;
  contentType: string;
  token: string;
  anonKey: string;
  supabaseUrl: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
};

/** Waits before the 2nd and 3rd try of a direct upload. */
export const DIRECT_UPLOAD_RETRY_MS = [1000, 3000];
/** No bytes moving for this long while sending: the connection is gone, try again. */
const DIRECT_UPLOAD_STALL_MS = 30_000;

/** A dropped connection, a stall or a server hiccup: worth another go. */
class RetryableUploadError extends Error {
  retryable = true;
}

/**
 * Phones drop connections mid-upload (a lift's wifi, walking out of the gym):
 * a network error, a stalled send or a 5xx / 408 / 429 gets two more tries
 * before the post fails. Same path every try, so a 409 means an earlier try
 * landed after all (treated as done). Cancelling never retries.
 */
async function uploadDirectWithRetry(args: DirectUploadArgs): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await uploadDirectWithProgress(args);
    } catch (e) {
      if (!(e instanceof RetryableUploadError) || attempt >= DIRECT_UPLOAD_RETRY_MS.length || args.signal?.aborted) throw e;
      await new Promise((r) => setTimeout(r, DIRECT_UPLOAD_RETRY_MS[attempt]));
      if (args.signal?.aborted) throw new Error("Upload cancelled.");
    }
  }
}

async function uploadDirectWithProgress(args: DirectUploadArgs): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url =
      `${args.supabaseUrl}/storage/v1/object/${encodeURIComponent(args.bucket)}/${encodeStoragePath(args.path)}`;
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${args.token}`);
    xhr.setRequestHeader("apikey", args.anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", args.contentType);
    // Must be a real Cache-Control value: Storage serves this header back as-is,
    // and the bare "3600" it used to send meant phones were never told they could
    // keep the file. Every upload gets a new path and is never overwritten, so it
    // can be cached for good.
    xhr.setRequestHeader("cache-control", `max-age=${CACHE_SECONDS}`);

    // Stall watch while the body is going up (not while the server answers).
    let lastMove = Date.now();
    let stalled = false;
    const watch = setInterval(() => {
      if (Date.now() - lastMove < DIRECT_UPLOAD_STALL_MS) return;
      stalled = true;
      clearInterval(watch);
      xhr.abort();
    }, 5000);
    const done = () => clearInterval(watch);
    xhr.upload.onload = done;
    xhr.upload.onprogress = (e) => {
      lastMove = Date.now();
      if (!args.onProgress) return;
      const total = e.lengthComputable ? e.total : args.file.size;
      if (!total) return;
      const pct = Math.max(1, Math.min(99, Math.round((e.loaded / total) * 100)));
      args.onProgress(pct);
    };
    xhr.onerror = () => {
      done();
      reject(new RetryableUploadError("Network error during upload."));
    };
    xhr.onabort = () => {
      done();
      reject(stalled ? new RetryableUploadError("The upload stalled.") : new Error("Upload cancelled."));
    };
    xhr.onload = () => {
      done();
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) {
        resolve();
      } else {
        const msg = `Upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`;
        reject(xhr.status >= 500 || xhr.status === 408 || xhr.status === 429 ? new RetryableUploadError(msg) : new Error(msg));
      }
    };

    if (args.signal) {
      const onAbort = () => xhr.abort();
      if (args.signal.aborted) {
        done();
        reject(new Error("Upload cancelled."));
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