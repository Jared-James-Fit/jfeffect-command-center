/**
 * One frame of a video at its own resolution (up to `maxSide`), decoded on
 * this device the same way the bar read decodes it (mediabunny over the
 * video's link), for a saved frame with its overlays drawn on. Reading the
 * on-screen <video> instead would taint the canvas (the file is on another
 * origin), so nothing could be saved from it.
 */
import { loadMediabunny } from "@/lib/video-edit/probe";

export async function grabFrame(
  source: Blob | string,
  t: number,
  maxSide = 1600,
): Promise<{ canvas: HTMLCanvasElement; w: number; h: number } | null> {
  const mb = await loadMediabunny();
  const input = new mb.Input({
    source: typeof source === "string" ? new mb.UrlSource(source) : new mb.BlobSource(source),
    formats: mb.ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const dw = track.displayWidth || 9;
    const dh = track.displayHeight || 16;
    const k = Math.min(1, maxSide / Math.max(dw, dh));
    const w = Math.max(16, Math.round(dw * k));
    const h = Math.max(16, Math.round(dh * k));
    const sink = new mb.CanvasSink(track, { width: w, height: h, fit: "fill", poolSize: 1 });
    const first = await track.getFirstTimestamp().catch(() => 0);
    const wc = await sink.getCanvas(Math.max(first, t));
    if (!wc) return null;
    // a plain canvas the caller can draw on and save
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(wc.canvas as CanvasImageSource, 0, 0, w, h);
    return { canvas: out, w, h };
  } finally {
    try {
      (input as { dispose?: () => void }).dispose?.();
    } catch {
      /* already gone */
    }
  }
}

export function canvasToPng(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((r) => c.toBlob((b) => r(b), "image/png"));
}

/**
 * A stretch of the clip with its overlays drawn in, encoded on this device
 * (WebCodecs through mediabunny, H.264 MP4 where the phone can, the same
 * encoder the app's video sending uses). The original file is never changed;
 * this is a new file for the athlete or coach to keep or share. Null where
 * the device can't encode video. Progress is frames written.
 */
export async function renderAnnotatedClip(input: {
  source: Blob | string;
  start: number;
  end: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
  maxSide?: number;
  signal?: AbortSignal;
  onProgress?: (share: number) => void;
}): Promise<Blob | null> {
  const mb = await loadMediabunny();
  const { outputCodec } = await import("@/lib/video-edit/probe");
  const media = new mb.Input({
    source:
      typeof input.source === "string"
        ? new mb.UrlSource(input.source)
        : new mb.BlobSource(input.source),
    formats: mb.ALL_FORMATS,
  });
  try {
    const track = await media.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const dw = track.displayWidth || 9;
    const dh = track.displayHeight || 16;
    const k = Math.min(1, (input.maxSide ?? 1280) / Math.max(dw, dh));
    // H.264 wants even sizes
    const w = Math.max(16, 2 * Math.round((dw * k) / 2));
    const h = Math.max(16, 2 * Math.round((dh * k) / 2));
    const stats = await track.computePacketStats(60).catch(() => null);
    const fps = Math.min(30, Math.max(10, Math.round(stats?.averagePacketRate ?? 30)));
    const bitrate = 5_000_000;
    if (
      !(await mb.canEncodeVideo(outputCodec(), { width: w, height: h, bitrate }).catch(() => false))
    )
      return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const target = new mb.BufferTarget();
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    });
    const source = new mb.CanvasSource(canvas, {
      codec: outputCodec(),
      quality: new mb.Quality({ bitrate }),
      keyFrameInterval: 1,
    });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    const first = await track.getFirstTimestamp().catch(() => 0);
    const start = Math.max(first, input.start);
    const end = Math.max(start + 1 / fps, input.end);
    const n = Math.max(1, Math.round((end - start) * fps));
    const times = Array.from({ length: n }, (_, i) => start + i / fps);
    const sink = new mb.CanvasSink(track, { width: w, height: h, fit: "fill", poolSize: 2 });
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (input.signal?.aborted) {
        await output.cancel().catch(() => {});
        return null;
      }
      if (wc) ctx.drawImage(wc.canvas as CanvasImageSource, 0, 0, w, h);
      input.draw(ctx, w, h, times[i]);
      await source.add(i / fps, 1 / fps);
      i++;
      input.onProgress?.(i / n);
    }
    source.close();
    await output.finalize();
    return target.buffer ? new Blob([target.buffer], { type: "video/mp4" }) : null;
  } finally {
    try {
      (media as { dispose?: () => void }).dispose?.();
    } catch {
      /* already gone */
    }
  }
}
