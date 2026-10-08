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
 *
 * iPhone notes (every video sent from an iPhone had no poster): WebKit won't
 * reliably load or decode frames for a video element that isn't in the page,
 * and a paused, seeked video may report "seeked" before a frame is decoded.
 * So the element goes into the page (invisible), loading is started
 * explicitly, the frame is grabbed once one is actually presented, and if a
 * seek never lands it plays muted for a moment to force a frame out.
 */
export function captureVideoPoster(file: File, opts: { maxDimension?: number; timeoutMs?: number } = {}): Promise<VideoPoster | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  const { maxDimension = 720, timeoutMs = 10_000 } = opts;

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let settled = false;
    let grabbing = false;
    const finish = (res: VideoPoster | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(kick);
      try { v.pause(); } catch { /* noop */ }
      v.removeAttribute("src");
      try { v.load(); } catch { /* noop */ }
      v.remove();
      URL.revokeObjectURL(url);
      resolve(res);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    const draw = () => {
      if (settled || grabbing) return;
      // No frame decoded yet: wait for one.
      if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) {
        v.addEventListener("loadeddata", draw, { once: true });
        return;
      }
      grabbing = true;
      try {
        try { v.pause(); } catch { /* noop */ }
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
    // Draw once a frame is actually on screen (falls back to drawing right away).
    const whenFramePresented = () => {
      const rvfc = (v as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      }).requestVideoFrameCallback;
      if (typeof rvfc === "function") {
        rvfc.call(v, () => draw());
        // A paused seek may never present a frame on some builds.
        setTimeout(draw, 500);
      } else {
        draw();
      }
    };

    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.preload = "auto";
    v.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => {
      // A hair in, so we skip a black first frame without waiting on a long seek.
      const t = Math.min(0.15, (v.duration || 0) / 2);
      try { v.currentTime = t; } catch { whenFramePresented(); }
    };
    v.onseeked = () => whenFramePresented();
    // If no seek has landed after a couple of seconds, play (muted) to force a frame.
    const kick = setTimeout(() => {
      if (settled || grabbing) return;
      const started = v.play();
      if (started && typeof started.then === "function") {
        started.then(() => whenFramePresented(), () => { /* the timeout resolves null */ });
      }
    }, 2_000);

    // iOS only decodes for elements that are in the page.
    (document.body ?? document.documentElement).appendChild(v);
    v.src = url;
    try { v.load(); } catch { /* noop */ }
  });
}
