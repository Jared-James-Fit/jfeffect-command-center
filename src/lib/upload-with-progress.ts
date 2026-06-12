import { supabase } from "@/integrations/supabase/client";

/**
 * Upload a File to Supabase Storage with real byte-level progress.
 *
 * Caller is expected to first mint a signed upload URL on the server
 * (e.g. `bucket.createSignedUploadUrl(path)`) and pass `signedUrl` + `token`.
 * Falls back to the standard client uploader if XHR isn't available.
 */
export async function uploadFileToSignedUrlWithProgress(opts: {
  bucket: string;
  path: string;
  signedUrl: string;
  token: string;
  file: File | Blob;
  contentType?: string;
  onProgress?: (info: { loaded: number; total: number; percent: number }) => void;
  signal?: AbortSignal;
}): Promise<{ path: string }> {
  const { bucket, path, signedUrl, token, file, contentType, onProgress, signal } = opts;

  // Browser path — use XHR so we get progress events the Fetch API doesn't expose for upload.
  if (typeof XMLHttpRequest !== "undefined") {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = new URL(signedUrl);
      // Supabase signed-upload URLs already carry ?token=...; ensure it's present.
      if (!url.searchParams.get("token")) url.searchParams.set("token", token);
      xhr.open("PUT", url.toString(), true);
      xhr.setRequestHeader("x-upsert", "true");
      if (contentType || (file as File).type) {
        xhr.setRequestHeader("Content-Type", contentType || (file as File).type || "application/octet-stream");
      }
      xhr.upload.onprogress = (e) => {
        if (!onProgress) return;
        const total = e.lengthComputable ? e.total : (file.size || 0);
        const loaded = e.loaded;
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        onProgress({ loaded, total, percent });
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.({ loaded: file.size || 0, total: file.size || 0, percent: 100 });
          resolve({ path });
        } else {
          reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
        }
      };
      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          return;
        }
        signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }
      xhr.send(file as Blob);
    });
  }

  // Server / no-XHR fallback — no granular progress, but works.
  const { error } = await (supabase.storage.from(bucket) as any).uploadToSignedUrl(path, token, file, {
    contentType: contentType || (file as File).type,
    upsert: true,
  });
  if (error) throw error;
  onProgress?.({ loaded: file.size || 0, total: file.size || 0, percent: 100 });
  return { path };
}

/** Format bytes as a short human-readable string ("4.2 MB"). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}