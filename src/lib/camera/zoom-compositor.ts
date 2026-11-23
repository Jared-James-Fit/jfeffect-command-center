/**
 * A digital zoom that's in the clip, not only on the screen (Nov 23 2026).
 *
 * Where the camera has no zoom of its own (most front cameras, iPhones,
 * computers), the viewfinder zooms by scaling the picture from its middle.
 * A clip recorded straight from the camera would show none of it, so while
 * a clip films with a digital zoom the camera's frames are drawn onto a
 * canvas the camera's own size, cropped to the middle 1/z exactly as the
 * viewfinder shows it (`zoomCrop`), and the canvas is what's recorded
 * (`captureStream`). Each new camera frame is drawn once
 * (`requestVideoFrameCallback` where the browser has it, else every
 * animation frame), at the zoom the glide is at that frame, so the clip
 * zooms as smoothly as the screen did.
 */
import { zoomCrop } from "@/lib/camera/camera-zoom";

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

/** A canvas can be recorded here (Safari 11+, Chrome, Firefox): a digital zoom is only offered where it can be filmed. */
export function canRecordCanvas(): boolean {
  return typeof HTMLCanvasElement !== "undefined" && typeof (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream === "function";
}

export type ZoomCompositor = { track: MediaStreamTrack; width: number; height: number; stop: () => void };

/**
 * Starts drawing `video` (the live camera on screen) zoomed by `zoom()` onto
 * a canvas and hands back the canvas's video track to record; null when it
 * can't (no frame yet, no canvas capture), and the caller records the camera
 * as it is.
 */
export function startZoomCompositor(video: HTMLVideoElement, zoom: () => number, fps = 30): ZoomCompositor | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !canRecordCanvas()) return null;
  const canvas = document.createElement("canvas");
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const draw = () => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const c = zoomCrop(w, h, canvas.width, canvas.height, zoom());
    try {
      ctx.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, canvas.width, canvas.height);
    } catch {
      /* a frame that can't be drawn keeps the last one */
    }
  };
  // the first frame is on the canvas before anything records it (never a black first frame)
  draw();
  let stream: MediaStream;
  try {
    stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(fps);
  } catch {
    canvas.width = canvas.height = 0;
    return null;
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    canvas.width = canvas.height = 0;
    return null;
  }
  const v = video as FrameVideo;
  let running = true;
  let handle = 0;
  const byFrame = typeof v.requestVideoFrameCallback === "function";
  const loop = () => {
    if (!running) return;
    draw();
    handle = byFrame ? v.requestVideoFrameCallback!(loop) : requestAnimationFrame(loop);
  };
  handle = byFrame ? v.requestVideoFrameCallback!(loop) : requestAnimationFrame(loop);
  return {
    track,
    width: canvas.width,
    height: canvas.height,
    stop: () => {
      if (!running) return;
      running = false;
      if (byFrame) v.cancelVideoFrameCallback?.(handle);
      else cancelAnimationFrame(handle);
      track.stop();
      // let the canvas's memory go now (iPhones cap the total)
      canvas.width = canvas.height = 0;
    },
  };
}
