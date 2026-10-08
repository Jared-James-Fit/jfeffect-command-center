// Shrink chat videos on the phone before uploading them, the way iMessage does.
//
// The upload itself was never the slow part: the file was. A 10s iPhone clip
// is ~12 MB at 1080p and ~50-60 MB at 4K, and the old flow sent the original.
// Re-encoding to 720p H.264 at ~3 Mbps (30 fps max) makes that ~4 MB, which
// uploads in a second or two on LTE, and plays everywhere (H.264 + MP4 with
// the index at the front, so playback starts before the whole file loads).
//
// Uses the browser's own hardware video encoder (WebCodecs) through
// mediabunny. Every step is optional: if the device can't do it, the result
// wouldn't be meaningfully smaller, it takes too long, or anything throws, we
// return null and the caller uploads the original exactly as before. Audio is
// copied as-is (no re-encode), and a conversion that would drop the audio or
// video track is refused rather than sending a broken clip.

export const TARGET_LONG_EDGE = 1280; // 720p
export const TARGET_VIDEO_BITRATE = 3_000_000; // ~3 Mbps: clean 720p for form checks on a phone
export const MAX_FPS = 30;
/** Below this the original uploads about as fast as compressing would take. */
export const MIN_BYTES_TO_COMPRESS = 4 * 1024 * 1024;
/** Very long videos would hold too much in memory; they upload as-is. */
export const MAX_SECONDS_TO_COMPRESS = 10 * 60;

export type CompressPlan = { width?: number; height?: number; frameRate?: number };

/**
 * Pure sizing decision. Returns null when compressing isn't worth it:
 * already small, already ≤720p at a modest bitrate, or too long.
 */
export function planCompression(input: {
  bytes: number;
  durationSec: number;
  displayWidth: number;
  displayHeight: number;
  fps?: number | null;
}): CompressPlan | null {
  const { bytes, durationSec, displayWidth: w, displayHeight: h } = input;
  if (bytes < MIN_BYTES_TO_COMPRESS) return null;
  if (!w || !h || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  if (durationSec > MAX_SECONDS_TO_COMPRESS) return null;

  const longEdge = Math.max(w, h);
  const bitrate = (bytes * 8) / durationSec;
  const needsResize = longEdge > TARGET_LONG_EDGE;
  const needsFps = !!input.fps && input.fps > MAX_FPS + 2; // 60 fps clips → 30
  // Already small and lean: re-encoding would only cost time and quality.
  if (!needsResize && !needsFps && bitrate <= TARGET_VIDEO_BITRATE * 1.5) return null;

  const plan: CompressPlan = {};
  if (needsResize) {
    // Scale the long edge; the encoder needs even dimensions.
    if (w >= h) plan.width = TARGET_LONG_EDGE;
    else plan.height = TARGET_LONG_EDGE;
  }
  if (needsFps) plan.frameRate = MAX_FPS;
  return plan;
}

/**
 * Start downloading the encoder library while the photo picker is open, so the
 * first video someone sends doesn't wait on it. Safe to call repeatedly.
 */
let preloaded: Promise<unknown> | null = null;
export function preloadVideoCompressor() {
  if (!preloaded && supportsWebCodecs()) preloaded = import("mediabunny").catch(() => { preloaded = null; });
}

/** How long compressing may take before sending the original is the faster choice. */
export function compressionBudgetMs(durationSec: number): number {
  return Math.max(10_000, durationSec * 1_500);
}

/** After a short warm-up, extrapolate from progress so far. */
export function projectedTooSlow(elapsedMs: number, progress: number, budgetMs: number): boolean {
  if (elapsedMs < 2_500 || progress <= 0.02) return false;
  return elapsedMs / progress > budgetMs;
}

function supportsWebCodecs(): boolean {
  return typeof window !== "undefined" && typeof (window as any).VideoEncoder === "function"
    && typeof (window as any).VideoDecoder === "function";
}

/**
 * Compress `file` for chat. Resolves to a smaller MP4 File, or null to mean
 * "upload the original". Never throws. `onProgress` reports 0..1.
 */
export function compressVideoForChat(
  file: File,
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {},
): Promise<File | null> {
  return compressVideoWith(file, "avc", opts);
}

/**
 * Same as compressVideoForChat with a chosen codec. Chat always uses "avc"
 * (H.264, plays everywhere); the codec is a parameter only so the pipeline can
 * be exercised in test browsers that lack H.264.
 */
export async function compressVideoWith(
  file: File,
  codec: "avc" | "vp9",
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {},
): Promise<File | null> {
  if (!supportsWebCodecs() || file.size < MIN_BYTES_TO_COMPRESS) return null;
  let conversion: { cancel(): Promise<void> } | null = null;
  const onAbort = () => { void conversion?.cancel().catch(() => {}); };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    // Loaded only when someone actually sends a video.
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const durationSec = await input.computeDuration();
    let fps: number | null = null;
    try { fps = (await track.computePacketStats(60)).averagePacketRate; } catch { /* unknown fps: keep it */ }

    const plan = planCompression({
      bytes: file.size,
      durationSec,
      displayWidth: track.displayWidth,
      displayHeight: track.displayHeight,
      fps,
    });
    if (!plan) return null;

    const outW = plan.width ?? Math.round((track.displayWidth * (plan.height ?? track.displayHeight)) / track.displayHeight);
    const outH = plan.height ?? Math.round((track.displayHeight * (plan.width ?? track.displayWidth)) / track.displayWidth);
    if (!(await mb.canEncodeVideo(codec, { width: outW, height: outH, bitrate: TARGET_VIDEO_BITRATE }))) return null;
    if (opts.signal?.aborted) return null;

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new mb.BufferTarget(),
    });
    const conv = await mb.Conversion.init({
      input,
      output,
      video: {
        ...plan,
        codec,
        quality: new mb.Quality({ bitrate: TARGET_VIDEO_BITRATE }),
        forceTranscode: true,
      },
      // Audio is copied untouched when possible (no audio encoder needed on iOS).
    });
    conversion = conv;
    // Refuse anything that would lose a track: a silent or blank clip is worse than a slow one.
    if (!conv.isValid || conv.discardedTracks.length > 0) return null;
    // Safety valve: if this device is slow at it, give up and send the original.
    // Decided early (~2.5s in) from the measured pace, so a slow phone never
    // wastes long on it; the hard limit is only a backstop.
    const limitMs = compressionBudgetMs(durationSec);
    let timedOut = false;
    const giveUp = () => { if (!timedOut) { timedOut = true; void conv.cancel().catch(() => {}); } };
    const startedAt = Date.now();
    conv.onProgress = (p: number) => {
      const clamped = Math.max(0, Math.min(1, p));
      opts.onProgress?.(clamped);
      if (projectedTooSlow(Date.now() - startedAt, clamped, limitMs)) giveUp();
    };
    const timer = setTimeout(giveUp, limitMs * 1.2);
    try {
      await conv.execute();
    } finally {
      clearTimeout(timer);
    }
    if (timedOut || opts.signal?.aborted) return null;

    const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buffer || buffer.byteLength === 0) return null;
    // Only worth it if it's clearly smaller.
    if (buffer.byteLength > file.size * 0.8) return null;
    const base = file.name.replace(/\.[^.]+$/, "") || "video";
    return new File([buffer], `${base}.mp4`, { type: "video/mp4", lastModified: file.lastModified });
  } catch {
    return null;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
