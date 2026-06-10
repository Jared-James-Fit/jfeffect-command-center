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
  const path = `${args.userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const contentType = args.file.type || guessContentType(ext);

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
        bucketName: "lift-videos",
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

  return { path, mimeType: contentType, sizeBytes: args.file.size };
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