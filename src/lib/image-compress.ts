/**
 * Client-side image compression for upload smoothness.
 * Downscales large images using a canvas and re-encodes as JPEG/WebP.
 * Falls back to the original file if compression isn't beneficial or fails.
 */
export interface CompressOptions {
  /** Max width or height in pixels (whichever is larger). Default 1600. */
  maxDimension?: number;
  /** JPEG/WebP quality 0..1. Default 0.82. */
  quality?: number;
  /** Output mime type. Default "image/jpeg". */
  mimeType?: "image/jpeg" | "image/webp";
  /** Skip compression if file is already smaller than this (bytes). Default 300KB. */
  skipUnder?: number;
}

export async function compressImage(
  file: File | Blob,
  opts: CompressOptions = {}
): Promise<File | Blob> {
  const {
    maxDimension = 1600,
    quality = 0.82,
    mimeType = "image/jpeg",
    skipUnder = 300 * 1024,
  } = opts;

  if (typeof window === "undefined") return file;
  const type = (file as File).type || "";
  if (!type.startsWith("image/") || type === "image/gif") return file;
  if (file.size <= skipUnder) return file;

  try {
    const bitmap = await createImageBitmap(file as Blob);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), mimeType, quality)
    );
    if (!blob || blob.size >= file.size) return file;

    const name = (file as File).name?.replace(/\.[^.]+$/, "") ?? "image";
    const ext = mimeType === "image/webp" ? "webp" : "jpg";
    return new File([blob], `${name}.${ext}`, { type: mimeType });
  } catch {
    return file;
  }
}