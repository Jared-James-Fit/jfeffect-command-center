// Photos for challenges: cropped and shrunk on the phone so only a small JPEG
// is uploaded (an athlete photo is a 720px square, a cover 1600×900).

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      /* fall back to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That file isn't a photo we can read."));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

/** The source rectangle for a crop of `aspect` around a focus point, zoomed in by `zoom`. */
export function cropRect(w: number, h: number, aspect: number, focusX: number, focusY: number, zoom: number) {
  let cw = w;
  let ch = w / aspect;
  if (ch > h) {
    ch = h;
    cw = h * aspect;
  }
  const z = Math.max(1, zoom);
  cw /= z;
  ch /= z;
  const sx = Math.min(Math.max(0, focusX * w - cw / 2), w - cw);
  const sy = Math.min(Math.max(0, focusY * h - ch / 2), h - ch);
  return { sx, sy, cw, ch };
}

export { decode as decodeImage };

export function size(img: ImageBitmap | HTMLImageElement) {
  return "naturalWidth" in img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: img.width, h: img.height };
}

/**
 * Crop to `aspect` (w/h) around the focus point (0..1, default centre),
 * zoomed by `zoom` (1 = the largest crop that fits), and export a JPEG.
 */
export async function cropToJpeg(
  file: Blob,
  opts: { aspect: number; width: number; focusX?: number; focusY?: number; zoom?: number; quality?: number },
): Promise<Blob> {
  const img = await decode(file);
  const { w, h } = size(img);
  const { sx, sy, cw, ch } = cropRect(w, h, opts.aspect, opts.focusX ?? 0.5, opts.focusY ?? 0.5, opts.zoom ?? 1);
  const outW = Math.min(opts.width, Math.round(cw));
  const outH = Math.round(outW / opts.aspect);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img as CanvasImageSource, sx, sy, cw, ch, 0, 0, outW, outH);
  if ("close" in img && typeof img.close === "function") img.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the photo."))), "image/jpeg", opts.quality ?? 0.85),
  );
}

export const athletePhotoJpeg = (file: Blob, focus?: { x: number; y: number; zoom?: number }) =>
  cropToJpeg(file, { aspect: 1, width: 720, focusX: focus?.x, focusY: focus?.y, zoom: focus?.zoom });

export const coverJpeg = (file: Blob) => cropToJpeg(file, { aspect: 16 / 9, width: 1600 });

export const logoJpeg = (file: Blob) => cropToJpeg(file, { aspect: 1, width: 400, quality: 0.9 });
