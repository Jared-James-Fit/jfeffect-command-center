// A small still frame of a local video, grabbed on the sender's phone while the
// video uploads. Chat bubbles show this instead of loading video data, so
// opening a chat doesn't download a piece of every video just to draw a thumbnail.

export type VideoPoster = { blob: Blob; width: number; height: number; duration: number };

/** Fit (w,h) inside max×max keeping aspect ratio; never upscales. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (!w || !h) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Resolves null (never throws) when the device can't decode the file for a
 * frame, or it takes too long; the upload itself must never depend on this.
 */
export function captureVideoPoster(file: File, opts: { maxDimension?: number; timeoutMs?: number } = {}): Promise<VideoPoster | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  const { maxDimension = 720, timeoutMs = 8000 } = opts;

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let settled = false;
    const finish = (res: VideoPoster | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      try { v.load(); } catch { /* noop */ }
      URL.revokeObjectURL(url);
      resolve(res);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => {
      // A hair in, so we skip a black first frame without waiting on a long seek.
      const t = Math.min(0.15, (v.duration || 0) / 2);
      try { v.currentTime = t; } catch { finish(null); }
    };
    v.onseeked = () => {
      try {
        const { width, height } = fitWithin(v.videoWidth, v.videoHeight, maxDimension);
        if (!width || !height) return finish(null);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(v, 0, 0, width, height);
        const duration = v.duration;
        canvas.toBlob(
          (blob) => finish(blob ? { blob, width, height, duration: Number.isFinite(duration) ? duration : 0 } : null),
          "image/jpeg",
          0.72,
        );
      } catch {
        finish(null);
      }
    };
    v.src = url;
  });
}
