/**
 * Read a picked video's length, size and codecs (the container's own header,
 * nothing decoded), and whether this phone can re-encode it. Loads the media
 * library only when a video is actually picked.
 */
import { MAX_FPS, OUTPUT_VIDEO_CODEC, TARGET_LONG_EDGE, TARGET_VIDEO_BITRATE, outputSize, type SourceInfo } from "@/lib/video-edit/plan";

export type Probe = { info: SourceInfo; canEncode: boolean; how: "header" | "player" };

type Mb = typeof import("mediabunny");
let mbP: Promise<Mb> | null = null;
/** The media library, loaded once (start it while the picker is open). */
export function loadMediabunny(): Promise<Mb> {
  if (!mbP) mbP = import("mediabunny").catch((e) => { mbP = null; throw e; });
  return mbP;
}

export function supportsWebCodecs(): boolean {
  return typeof window !== "undefined" && typeof (window as any).VideoEncoder === "function" && typeof (window as any).VideoDecoder === "function";
}

/** The codec used for re-encoding (H.264; test browsers without it can switch to VP9). */
export function outputCodec(): "avc" | "vp9" {
  return (globalThis as { __jfVideoCodec?: "vp9" }).__jfVideoCodec ?? OUTPUT_VIDEO_CODEC;
}

function containerOf(mime: string | null, file: File): SourceInfo["container"] {
  const m = (mime || file.type || "").toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (m.includes("quicktime") || ext === "mov" || ext === "qt") return "mov";
  if (m.includes("webm") || m.includes("matroska") || ext === "webm" || ext === "mkv") return "webm";
  if (m.includes("mp4") || ext === "mp4" || ext === "m4v") return "mp4";
  return "other";
}

const encodeCache = new Map<string, Promise<boolean>>();
/** Can this browser encode the output size at all (cached per size). */
export async function canEncodeOutput(width: number, height: number): Promise<boolean> {
  if (!supportsWebCodecs()) return false;
  const { width: w, height: h } = outputSize({ width, height }, TARGET_LONG_EDGE);
  const key = `${outputCodec()}:${w}x${h}`;
  let p = encodeCache.get(key);
  if (!p) {
    p = loadMediabunny()
      .then((mb) => mb.canEncodeVideo(outputCodec(), { width: w, height: h, bitrate: TARGET_VIDEO_BITRATE }))
      .catch(() => false);
    encodeCache.set(key, p);
  }
  return p;
}

/** Length / size from the phone's own player, for a file the header reader can't parse. */
function probeWithPlayer(file: File, timeoutMs = 8_000): Promise<{ duration: number; width: number; height: number } | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let done = false;
    const finish = (r: { duration: number; width: number; height: number } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      try { v.load(); } catch { /* noop */ }
      v.remove();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) && v.videoWidth ? { duration: v.duration, width: v.videoWidth, height: v.videoHeight } : null);
    v.onerror = () => finish(null);
    // iOS only loads media for elements in the page
    (document.body ?? document.documentElement).appendChild(v);
    v.src = url;
  });
}

/**
 * Never throws: null means the file isn't a video this phone can read.
 * `canEncode` is true only when this phone can both decode this clip and
 * encode 720p H.264 (WebCodecs), i.e. a re-encode is possible at all.
 */
export async function probeVideo(file: File): Promise<Probe | null> {
  try {
    const mb = await loadMediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    try {
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) return null;
      const [duration, mime, at] = await Promise.all([input.computeDuration(), input.getMimeType().catch(() => null), input.getPrimaryAudioTrack().catch(() => null)]);
      let fps: number | null = null;
      try {
        fps = (await vt.computePacketStats(90)).averagePacketRate || null;
      } catch { /* unknown frame rate: treated as ≤30 */ }
      const info: SourceInfo = {
        duration,
        bytes: file.size,
        width: vt.displayWidth,
        height: vt.displayHeight,
        codec: vt.codec,
        audioCodec: at?.codec ?? null,
        hasAudio: !!at,
        fps: fps && fps > 0 && fps < 1000 ? fps : null,
        container: containerOf(mime, file),
      };
      if (!info.width || !info.height || !Number.isFinite(duration) || duration <= 0) throw new Error("unreadable header");
      const canEncode = supportsWebCodecs() && (await vt.canDecode().catch(() => false)) && (await canEncodeOutput(info.width, info.height));
      return { info, canEncode, how: "header" };
    } finally {
      input.dispose?.();
    }
  } catch {
    // an odd container: the phone's player may still know it (then it can only go as it is)
    const meta = await probeWithPlayer(file);
    if (!meta) return null;
    return {
      info: { duration: meta.duration, bytes: file.size, width: meta.width, height: meta.height, codec: null, audioCodec: null, hasAudio: true, fps: null, container: containerOf(null, file) },
      canEncode: false,
      how: "player",
    };
  }
}

/** Frame rate the output keeps (60 fps clips go to 30). */
export function outputFps(info: SourceInfo): number | undefined {
  return info.fps && info.fps > MAX_FPS + 2 ? MAX_FPS : undefined;
}

/**
 * Where a straight cut of this clip can start: the keyframe at or before `t`
 * (WebM has no edit lists, so its cuts start on one). One reader for the
 * whole trim; null when the file can't be read that way.
 */
export function keyframeFinder(file: File): ((t: number) => Promise<number>) | null {
  let sinkP: Promise<{ getKeyPacket(t: number, o: { metadataOnly: boolean }): Promise<{ timestamp: number } | null> } | null> | null = null;
  const sink = () => {
    if (!sinkP) {
      sinkP = loadMediabunny()
        .then(async (mb) => {
          const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
          const track = await input.getPrimaryVideoTrack();
          return track ? new mb.EncodedPacketSink(track) : null;
        })
        .catch(() => null);
    }
    return sinkP;
  };
  return async (t: number) => {
    const s = await sink();
    if (!s) return t;
    const k = await s.getKeyPacket(Math.max(0, t), { metadataOnly: true }).catch(() => null);
    return k ? Math.max(0, k.timestamp) : 0;
  };
}
