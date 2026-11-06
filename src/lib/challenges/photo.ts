/**
 * Athlete photos: read what the camera or library gave us, let the person
 * frame it in a square, and hand the server one small JPEG (it re-checks it).
 */

export const PHOTO_SIZE = 720;
export const PHOTO_QUALITY = 0.85;
/** The server refuses anything bigger than this once decoded. */
export const PHOTO_MAX_BYTES = 2_500_000;

export type Framing = { zoom: number; x: number; y: number };
export const DEFAULT_FRAMING: Framing = { zoom: 1, x: 0, y: 0 };

/** Decode a picked file, honouring the phone's rotation. */
export async function loadPhoto(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new Error("That file isn't a photo.");
  }
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
    } catch {
      /* Safari without bitmap options, or HEIC: fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("That photo couldn't be opened. Try a JPEG or PNG.");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export function imageSize(img: HTMLImageElement | ImageBitmap): { w: number; h: number } {
  const anyImg = img as HTMLImageElement;
  return { w: anyImg.naturalWidth || img.width, h: anyImg.naturalHeight || img.height };
}

/**
 * Where the photo sits in the square frame. zoom 1 = the short side fills the
 * square; x / y are the offset of the photo's centre from the frame's centre,
 * as a share of the frame (kept so the photo always covers the frame).
 */
export function clampFraming(f: Framing, img: { w: number; h: number }): Framing {
  const zoom = Math.min(4, Math.max(1, f.zoom));
  const scale = zoom / Math.min(img.w, img.h); // frame units per pixel (frame = 1)
  const halfW = (img.w * scale) / 2;
  const halfH = (img.h * scale) / 2;
  const maxX = Math.max(0, halfW - 0.5);
  const maxY = Math.max(0, halfH - 0.5);
  return { zoom, x: Math.min(maxX, Math.max(-maxX, f.x)), y: Math.min(maxY, Math.max(-maxY, f.y)) };
}

/** Paint the framed square onto a canvas of `size` px. */
export function drawFramed(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  dims: { w: number; h: number },
  f: Framing,
  size: number,
) {
  const scale = (f.zoom / Math.min(dims.w, dims.h)) * size;
  const w = dims.w * scale;
  const h = dims.h * scale;
  const cx = size / 2 + f.x * size;
  const cy = size / 2 + f.y * size;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

/** The framed square as a JPEG data URL, ready to upload. */
export function framedJpeg(
  img: HTMLImageElement | ImageBitmap,
  f: Framing,
  size = PHOTO_SIZE,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare photos.");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  drawFramed(ctx, img, imageSize(img), clampFraming(f, imageSize(img)), size);
  let q = PHOTO_QUALITY;
  let out = canvas.toDataURL("image/jpeg", q);
  while (dataUrlBytes(out) > PHOTO_MAX_BYTES * 0.8 && q > 0.5) {
    q -= 0.1;
    out = canvas.toDataURL("image/jpeg", q);
  }
  return out;
}

export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((b64.length * 3) / 4);
}
