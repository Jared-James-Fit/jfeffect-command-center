// Take or pick a photo, drag it into the circle, zoom, and hand back a small
// square JPEG. Nothing is uploaded here.
import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { athletePhotoJpeg, cropRect, decodeImage, size } from "@/lib/challenges/photo";

export interface PickedPhoto {
  file: File;
  focus: { x: number; y: number; zoom: number };
}

export async function photoBlob(p: PickedPhoto): Promise<Blob> {
  return athletePhotoJpeg(p.file, p.focus);
}

export function PhotoPicker({ value, onChange, facing = "user" }: { value: PickedPhoto | null; onChange: (p: PickedPhoto | null) => void; facing?: "user" | "environment" }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    if (!value) {
      setImg(null);
      return;
    }
    decodeImage(value.file)
      .then((i) => alive && setImg(i))
      .catch(() => alive && setError("That photo couldn't be read. Try another."));
    return () => {
      alive = false;
    };
  }, [value?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !img || !value) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const { w, h } = size(img);
    const r = cropRect(w, h, 1, value.focus.x, value.focus.y, value.focus.zoom);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img as CanvasImageSource, r.sx, r.sy, r.cw, r.ch, 0, 0, cv.width, cv.height);
  }, [img, value]);

  function pick(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type) && !/\.(heic|heif|jpe?g|png|webp)$/i.test(f.name)) {
      setError("Pick a photo.");
      return;
    }
    onChange({ file: f, focus: { x: 0.5, y: 0.4, zoom: 1 } });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!value) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, fx: value.focus.x, fy: value.focus.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !value || !img) return;
    const { w, h } = size(img);
    const r = cropRect(w, h, 1, value.focus.x, value.focus.y, value.focus.zoom);
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect().width || 1;
    // moving the finger right shows more of the left: focus goes the other way
    const nx = Math.min(1, Math.max(0, d.fx - ((e.clientX - d.x) / box) * (r.cw / w)));
    const ny = Math.min(1, Math.max(0, d.fy - ((e.clientY - d.y) / box) * (r.ch / h)));
    onChange({ ...value, focus: { ...value.focus, x: nx, y: ny } });
  }

  return (
    <div className="space-y-3">
      <input ref={cameraRef} type="file" accept="image/*" capture={facing} className="hidden" onChange={(e) => pick(e.target.files)} />
      <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files)} />
      {value ? (
        <div className="flex flex-col items-center gap-3">
          <div
            className="relative h-44 w-44 touch-none overflow-hidden rounded-full bg-muted ring-2 ring-border"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            aria-label="Drag to frame your photo"
          >
            <canvas ref={canvasRef} width={352} height={352} className="h-full w-full" />
          </div>
          <div className="w-full max-w-[240px]">
            <Slider
              value={[value.focus.zoom]}
              min={1}
              max={3}
              step={0.05}
              onValueChange={([z]) => onChange({ ...value, focus: { ...value.focus, zoom: z } })}
              aria-label="Zoom"
            />
            <p className="mt-1 text-center text-xs text-muted-foreground">Drag to frame · slide to zoom</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => cameraRef.current?.click()} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold">
              <RotateCcw className="h-4 w-4" /> Retake
            </button>
            <button type="button" onClick={() => onChange(null)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold">
              <Trash2 className="h-4 w-4" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => cameraRef.current?.click()} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-semibold">
            <Camera className="h-4 w-4" /> Take photo
          </button>
          <button type="button" onClick={() => libraryRef.current?.click()} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-semibold">
            <ImagePlus className="h-4 w-4" /> Upload
          </button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
