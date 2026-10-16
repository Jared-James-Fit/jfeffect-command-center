/**
 * Small frames for the trimmer's filmstrip, made on the phone.
 *
 * Decoded straight from the file (mediabunny + the phone's own decoder):
 * a tile shows the keyframe at or just before its time, so a frame costs one
 * decode however long the video is, and two tiles on the same keyframe share
 * it. A phone that can't decode this clip that way gets frames from a hidden
 * player instead (slower: one seek each). Asked-for frames are fetched one at
 * a time, newest wish first, so whatever's on screen fills in first.
 */
import { loadMediabunny } from "@/lib/video-edit/probe";

export type Thumbnailer = {
  /** The frames to fetch, most wanted first (replaces the last list). */
  want(times: number[]): void;
  /** A frame already made for `t` (its keyframe's), or null. */
  peek(t: number): string | null;
  /** Called whenever a frame lands. */
  subscribe(cb: () => void): () => void;
  dispose(): void;
};

type Grabber = {
  /** The time a frame for `t` actually shows (cache key), when knowable cheaply. */
  keyOf(t: number): Promise<number>;
  grab(t: number): Promise<Blob | null>;
  close(): void;
};

function canvasBlob(c: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if ("convertToBlob" in c) return c.convertToBlob({ type: "image/jpeg", quality: 0.7 }).catch(() => null);
  return new Promise((r) => (c as HTMLCanvasElement).toBlob(r, "image/jpeg", 0.7));
}

async function decoderGrabber(file: File, w: number, h: number, span: number): Promise<Grabber | null> {
  try {
    const mb = await loadMediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose?.();
      return null;
    }
    const sink = new mb.CanvasSink(track, { width: w, height: h, fit: "cover", poolSize: 0 });
    const packets = new mb.EncodedPacketSink(track);
    const first = await track.getFirstTimestamp().catch(() => 0);
    const keyOf = async (t: number) => {
      const k = await packets.getKeyPacket(Math.max(first, t), { metadataOnly: true }).catch(() => null);
      // a keyframe far behind (screen-recorded or WebM clips): decode the real frame instead
      if (!k || t - k.timestamp > span) return Math.round(t * 4) / 4;
      return k.timestamp;
    };
    return {
      keyOf,
      async grab(t) {
        const wrapped = await sink.getCanvas(Math.max(first, t));
        return wrapped ? canvasBlob(wrapped.canvas) : null;
      },
      close: () => input.dispose?.(),
    };
  } catch {
    return null;
  }
}

/** Frames from a hidden player in the page (iPhones only decode for elements in the page). */
function playerGrabber(file: File, w: number, h: number): Grabber {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.preload = "auto";
  v.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
  (document.body ?? document.documentElement).appendChild(v);
  v.src = url;
  const ready = new Promise<void>((res) => {
    if (v.readyState >= 1) return res();
    v.addEventListener("loadedmetadata", () => res(), { once: true });
    v.addEventListener("error", () => res(), { once: true });
    setTimeout(res, 6000);
  });
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const seek = (t: number) =>
    new Promise<void>((res) => {
      const timer = setTimeout(res, 2500);
      const landed = () => {
        const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
        if (typeof rvfc === "function") {
          rvfc.call(v, () => { clearTimeout(timer); res(); });
          setTimeout(() => { clearTimeout(timer); res(); }, 400);
        } else {
          clearTimeout(timer);
          res();
        }
      };
      v.addEventListener("seeked", landed, { once: true });
      try { v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.05)); } catch { clearTimeout(timer); res(); }
    });
  return {
    keyOf: async (t) => Math.round(t * 4) / 4,
    async grab(t) {
      await ready;
      if (!v.videoWidth) return null;
      await seek(t);
      const ctx = canvas.getContext("2d");
      if (!ctx || v.readyState < 2) return null;
      // cover-fit into the tile
      const s = Math.max(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * s;
      const dh = v.videoHeight * s;
      ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      return canvasBlob(canvas);
    },
    close() {
      v.removeAttribute("src");
      try { v.load(); } catch { /* noop */ }
      v.remove();
      URL.revokeObjectURL(url);
      canvas.width = canvas.height = 0;
    },
  };
}

/**
 * `w` × `h` frames (device pixels). `span` is the time one tile covers: a
 * keyframe further back than that isn't close enough to stand for it.
 */
export function createThumbnailer(file: File, opts: { width: number; height: number; span: number }): Thumbnailer {
  const urls = new Map<number, string>();
  const keyCache = new Map<number, number>();
  const subs = new Set<() => void>();
  let queue: number[] = [];
  let running = false;
  let disposed = false;
  const w = Math.max(16, Math.round(opts.width));
  const h = Math.max(16, Math.round(opts.height));
  const grabberP: Promise<Grabber> = decoderGrabber(file, w, h, opts.span).then((g) => g ?? playerGrabber(file, w, h));

  const tKey = (t: number) => Math.round(t * 100) / 100;
  const pump = async () => {
    if (running || disposed) return;
    running = true;
    try {
      const g = await grabberP;
      while (!disposed && queue.length) {
        const t = queue.shift()!;
        let k = keyCache.get(tKey(t));
        if (k == null) {
          k = await g.keyOf(t);
          keyCache.set(tKey(t), k);
        }
        if (urls.has(k)) {
          subs.forEach((cb) => cb());
          continue;
        }
        const blob = await g.grab(k).catch(() => null);
        if (disposed) break;
        if (blob) {
          urls.set(k, URL.createObjectURL(blob));
          subs.forEach((cb) => cb());
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    want(times) {
      queue = times.filter((t) => {
        const k = keyCache.get(tKey(t));
        return k == null || !urls.has(k);
      });
      void pump();
    },
    peek(t) {
      const k = keyCache.get(tKey(t));
      return k == null ? null : urls.get(k) ?? null;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    dispose() {
      disposed = true;
      queue = [];
      subs.clear();
      void grabberP.then((g) => g.close());
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}
