import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { gradePixels, type CompiledGrade } from "@/lib/media-grade";
import { GradeGL } from "@/lib/media-grade-gl";

/** A preview never needs more than this on its long side (a phone screen at 3×, roughly). */
const PREVIEW_MAX = 1600;

/** A photo's preview copy, cut once per photo (≤ PREVIEW_MAX), so a filter change uploads a few MB, not 12 MP. */
const previewCopies = new WeakMap<HTMLImageElement | HTMLCanvasElement, HTMLCanvasElement>();
function previewCopy(src: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement | HTMLImageElement {
  const w = (src as HTMLImageElement).naturalWidth || src.width;
  const h = (src as HTMLImageElement).naturalHeight || src.height;
  const k = PREVIEW_MAX / Math.max(w, h, 1);
  if (k >= 1) return src;
  let c = previewCopies.get(src);
  if (!c) {
    c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(w * k));
    c.height = Math.max(2, Math.round(h * k));
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, c.width, c.height);
    }
    previewCopies.set(src, c);
  }
  return c;
}

/**
 * The filter, live, over the photo or clip it grades (the element itself
 * stays underneath, loaded and playing): the same program the export runs, on
 * the GPU, a photo once per change and a clip every new frame. Sized to what's
 * on screen, never the full file, so dragging a slider stays smooth.
 */
export function GradedLayer({
  source,
  grade,
  className,
  style,
}: {
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null;
  grade: CompiledGrade;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<GradeGL | null | undefined>(undefined);
  const gradeRef = useRef(grade);
  gradeRef.current = grade;
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !source) return;
    if (glRef.current === undefined) glRef.current = GradeGL.create(canvas);
    const gl = glRef.current;
    const isVideo = source instanceof HTMLVideoElement;
    const draw = () => {
      const g = gradeRef.current;
      const sw = isVideo ? source.videoWidth : (source as HTMLImageElement).naturalWidth || source.width;
      const sh = isVideo ? source.videoHeight : (source as HTMLImageElement).naturalHeight || source.height;
      if (!sw || !sh) return;
      const box = canvas.getBoundingClientRect();
      // 2× is as sharp as a filter preview needs to look; 3× would grade 2¼ times the pixels every frame of a clip
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // its backing: what's on screen (never more than the picture itself or PREVIEW_MAX)
      const k = Math.min(1, PREVIEW_MAX / Math.max(sw, sh), Math.max(box.width * dpr, 2) / sw);
      const W = Math.max(2, Math.round(sw * k));
      const H = Math.max(2, Math.round(sh * k));
      if (gl) {
        gl.draw(isVideo ? source : previewCopy(source as HTMLImageElement), W, H, g);
        return;
      }
      // no WebGL: the pixel loop on a small copy (a photo only; a clip's filter isn't offered here)
      if (isVideo) return;
      const s = Math.min(1, 720 / Math.max(sw, sh));
      canvas.width = Math.max(2, Math.round(sw * s));
      canvas.height = Math.max(2, Math.round(sh * s));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      gradePixels(img.data, canvas.width, canvas.height, g);
      ctx.putImageData(img, 0, 0);
    };
    drawRef.current = draw;
    let stop = false;
    let handle = 0;
    if (isVideo) {
      const v = source as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
      const tick = () => {
        if (stop) return;
        draw();
        handle = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
      };
      tick();
      const onSeek = () => draw();
      v.addEventListener("seeked", onSeek);
      v.addEventListener("loadeddata", onSeek);
      return () => {
        stop = true;
        v.removeEventListener("seeked", onSeek);
        v.removeEventListener("loadeddata", onSeek);
        if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle);
        else cancelAnimationFrame(handle);
      };
    }
    const img = source as HTMLImageElement;
    if (img instanceof HTMLImageElement && !img.complete) {
      const onLoad = () => draw();
      img.addEventListener("load", onLoad);
      return () => img.removeEventListener("load", onLoad);
    }
    draw();
    return () => {
      stop = true;
    };
  }, [source]);

  // a new grade on a photo: one redraw (a clip picks it up on its next frame, or now when paused)
  useEffect(() => {
    const raf = requestAnimationFrame(() => drawRef.current());
    return () => cancelAnimationFrame(raf);
  }, [grade]);

  // gone from the page: its GPU context goes too (a phone only keeps a handful); a remount in place keeps it
  useEffect(() => {
    // the element itself, kept here: React may clear the ref before this runs
    const canvas = ref.current;
    return () => {
      if (canvas?.isConnected) return;
      glRef.current?.dispose();
      glRef.current = undefined;
    };
  }, []);

  return <canvas ref={ref} className={cn("pointer-events-none", className)} style={style} aria-hidden data-graded-layer />;
}
