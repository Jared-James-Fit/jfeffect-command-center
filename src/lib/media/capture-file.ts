import type { CaptureShot } from "@/components/camera/film-camera";

/**
 * A capture camera's photo as the file a place takes: posts keep the whole
 * photo and frame it in their editor (non-destructive); every other place
 * (chat, progress, check-ins, profile) gets what the guide showed, cut here,
 * at handover, at the camera's full resolution (never scaled up).
 */
export async function shotFile(shot: CaptureShot): Promise<File> {
  const { crop, picture, file } = shot;
  const whole = crop.x <= 0.5 && crop.y <= 0.5 && Math.abs(crop.w - picture.w) <= 1 && Math.abs(crop.h - picture.h) <= 1;
  if (whole || typeof document === "undefined") return file;
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(crop.w));
    c.height = Math.max(2, Math.round(crop.h));
    const ctx = c.getContext("2d");
    if (!ctx) return file;
    // the bitmap is the photo as taken; the crop is in its pixels (a still from the camera's photo path may be bigger)
    const kx = bmp.width / picture.w;
    const ky = bmp.height / picture.h;
    ctx.drawImage(bmp, crop.x * kx, crop.y * ky, crop.w * kx, crop.h * ky, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.92));
    c.width = c.height = 0;
    return blob ? new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified }) : file;
  } catch {
    return file;
  }
}
