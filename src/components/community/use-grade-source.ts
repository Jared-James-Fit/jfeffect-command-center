import { useEffect, useState } from "react";
import { analyzePixels, type MediaStats } from "@/lib/media-grade";
import { measureDrawable } from "@/lib/media-grade-gl";

/**
 * A picture's measurements for Auto (media-grade.ts `analyzePixels`), read once
 * from a tiny copy and kept per picture, so the preview and the export grade
 * with exactly the same numbers. A clip is read from its poster.
 */
const byUrl = new Map<string, Promise<{ img: HTMLImageElement; stats: MediaStats } | null>>();

export function loadGradeSource(url: string): Promise<{ img: HTMLImageElement; stats: MediaStats } | null> {
  let p = byUrl.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        const px = measureDrawable(img, img.naturalWidth, img.naturalHeight);
        resolve(px ? { img, stats: analyzePixels(px) } : null);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    byUrl.set(url, p);
    // a handful at a time is plenty (a carousel's ten, the story's one)
    if (byUrl.size > 24) byUrl.delete(byUrl.keys().next().value as string);
  }
  return p;
}

/** Stats for a drawable already in hand (the studio's shot). */
const byDrawable = new WeakMap<object, MediaStats>();
export function statsFor(src: CanvasImageSource & { naturalWidth?: number; videoWidth?: number; width?: unknown; naturalHeight?: number; videoHeight?: number; height?: unknown }): MediaStats | null {
  const hit = byDrawable.get(src as object);
  if (hit) return hit;
  const w = src.naturalWidth || src.videoWidth || (typeof src.width === "number" ? src.width : 0);
  const h = src.naturalHeight || src.videoHeight || (typeof src.height === "number" ? src.height : 0);
  const px = measureDrawable(src, w, h);
  if (!px) return null;
  const s = analyzePixels(px);
  byDrawable.set(src as object, s);
  return s;
}

/** The picture behind a URL (a photo or a clip's poster) and its measurements, once loaded. */
export function useGradeSource(url: string | null | undefined): { img: HTMLImageElement | null; stats: MediaStats | null } {
  const [got, setGot] = useState<{ url: string; img: HTMLImageElement; stats: MediaStats } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    void loadGradeSource(url).then((r) => {
      if (live && r) setGot({ url, ...r });
    });
    return () => {
      live = false;
    };
  }, [url]);
  return got && got.url === url ? { img: got.img, stats: got.stats } : { img: null, stats: null };
}
