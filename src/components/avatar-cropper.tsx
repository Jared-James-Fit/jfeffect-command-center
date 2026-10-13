import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { MAX_ZOOM, clampCrop, cropRect, zoomAt, type Crop, type Size } from "@/lib/avatar-crop";
import { cn } from "@/lib/utils";

const START: Crop = { zoom: 1, x: 0, y: 0 };

/** Draw the framed square of the photo to a JPEG (never larger than the photo has pixels for). */
export async function exportAvatarCrop(img: HTMLImageElement, crop: Crop, frame: number, out = 1080): Promise<Blob> {
  const size = { w: img.naturalWidth, h: img.naturalHeight };
  const r = cropRect(crop, size, frame);
  const px = Math.max(256, Math.min(out, Math.round(r.size)));
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare that photo");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, r.sx, r.sy, r.size, r.size, 0, 0, px, px);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
  if (!blob) throw new Error("Couldn't prepare that photo");
  return blob;
}

/**
 * Instagram-style "Move and scale" for profile photos: the photo fills a
 * square with a circle showing exactly what people will see. Pinch or use
 * the slider to zoom (wheel / trackpad on a computer), drag to place it.
 * It can't be dragged off the edge, so a crop never has empty corners.
 */
export function AvatarCropper({
  src,
  open,
  onCancel,
  onDone,
  title = "Move and scale",
  doneLabel = "Done",
  outputSize = 1080,
}: {
  /** An object / data URL for the photo just taken or picked. */
  src: string | null;
  open: boolean;
  onCancel: () => void;
  onDone: (blob: Blob) => void | Promise<void>;
  title?: string;
  doneLabel?: string;
  outputSize?: number;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [crop, setCrop] = useState<Crop>(START);
  const [frame, setFrame] = useState(0);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number; mid: { x: number; y: number }; crop: Crop } | null>(null);

  // load the photo (a new one starts centred, just covering the frame)
  useEffect(() => {
    if (!open || !src) return;
    let cancelled = false;
    setImg(null);
    setFailed(false);
    setCrop(START);
    const el = new Image();
    el.decoding = "async";
    el.onload = () => !cancelled && setImg(el);
    el.onerror = () => !cancelled && setFailed(true);
    el.src = src;
    return () => {
      cancelled = true;
    };
  }, [open, src]);

  // the frame is a square as wide as the screen allows
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    frameRef.current = node;
    if (!node) return;
    const update = () => setFrame(Math.round(node.getBoundingClientRect().width));
    update();
    if (typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(update);
      observer.current.observe(node);
    }
  }, []);

  const size: Size | null = img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  useEffect(() => {
    if (size && frame) setCrop((c) => clampCrop(c, size, frame));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, img]);

  /** A point relative to the frame's centre. */
  const local = (x: number, y: number) => {
    const r = frameRef.current?.getBoundingClientRect();
    return r ? { x: x - (r.left + r.width / 2), y: y - (r.top + r.height / 2) } : { x: 0, y: 0 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!size || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setMoving(true);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: crop.zoom, mid: local((a.x + b.x) / 2, (a.y + b.y) / 2), crop };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !size || !frame) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      // pinch: zoom around the fingers, and follow them as they move
      const [a, b] = [...pointers.current.values()];
      const p = pinch.current;
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const zoomed = zoomAt(p.crop, p.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / p.dist), p.mid, size, frame);
      setCrop(clampCrop({ ...zoomed, x: zoomed.x + mid.x - p.mid.x, y: zoomed.y + mid.y - p.mid.y }, size, frame));
      return;
    }
    setCrop((c) => clampCrop({ ...c, x: c.x + (e.clientX - prev.x), y: c.y + (e.clientY - prev.y) }, size, frame));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setMoving(false);
  };

  // wheel / trackpad pinch on a computer (non-passive, so the page doesn't zoom)
  useEffect(() => {
    const node = frameRef.current;
    if (!node || !size || !frame) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = local(e.clientX, e.clientY);
      setCrop((c) => zoomAt(c, c.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), at, size, frame));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, frame]);

  const setZoom = (z: number) => size && frame && setCrop((c) => zoomAt(c, z, { x: 0, y: 0 }, size, frame));

  const done = async () => {
    if (!img || !frame || busy) return;
    setBusy(true);
    try {
      await onDone(await exportAvatarCrop(img, crop, frame, outputSize));
    } finally {
      setBusy(false);
    }
  };

  // the photo at "just covers" size; zoom and position are a transform
  const base = size && frame ? { w: size.w * (frame / Math.min(size.w, size.h)), h: size.h * (frame / Math.min(size.w, size.h)) } : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black" />
        <DialogPrimitive.Content
          data-avatar-cropper
          aria-describedby={undefined}
          className="fixed inset-0 z-[81] flex flex-col bg-black text-white outline-none"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-full px-3 text-[15px] font-semibold text-white/85 active:bg-white/10">
              Cancel
            </button>
            <DialogPrimitive.Title className="text-[15px] font-bold">{title}</DialogPrimitive.Title>
            <button
              type="button"
              onClick={done}
              disabled={!img || busy}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-bold text-[#4ea1ff] active:bg-white/10 disabled:opacity-40"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {doneLabel}
            </button>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <div
              ref={measure}
              className="relative aspect-square w-full max-w-[440px] touch-none select-none overflow-hidden bg-neutral-900"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onDoubleClick={(e) => size && frame && setCrop((c) => zoomAt(c, c.zoom > 1.5 ? 1 : 2.5, local(e.clientX, e.clientY), size, frame))}
              aria-label="Drag to move, pinch to zoom"
            >
              {img && base ? (
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute max-w-none origin-center will-change-transform"
                  style={{
                    width: base.w,
                    height: base.h,
                    left: frame / 2 - base.w / 2,
                    top: frame / 2 - base.h / 2,
                    transform: `translate(${crop.x}px, ${crop.y}px) scale(${crop.zoom})`,
                  }}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
                  {failed ? "Couldn't open that photo. Try another one." : <Loader2 className="h-6 w-6 animate-spin" />}
                </div>
              )}
              {/* the circle people will see; outside it is dimmed, like Instagram */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/70"
                style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
              />
              {/* thirds grid while you move it */}
              <div aria-hidden className={cn("pointer-events-none absolute inset-0 transition-opacity duration-150", moving ? "opacity-100" : "opacity-0")}>
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
              </div>
            </div>

            <div className="mt-6 flex w-full max-w-[440px] items-center gap-3 px-1">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom(crop.zoom / 1.25)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/80 active:bg-white/10">
                <ZoomOut className="h-5 w-5" />
              </button>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={crop.zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label="Zoom"
                className="h-2 flex-1 cursor-pointer accent-white"
                disabled={!img}
              />
              <button type="button" aria-label="Zoom in" onClick={() => setZoom(crop.zoom * 1.25)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/80 active:bg-white/10">
                <ZoomIn className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-3 text-center text-[13px] text-white/55">Pinch to zoom · drag to move</p>
          </div>
          <div className="pb-[max(1rem,env(safe-area-inset-bottom))]" />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
