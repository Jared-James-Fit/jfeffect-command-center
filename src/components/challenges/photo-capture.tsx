import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  DEFAULT_FRAMING,
  clampFraming,
  drawFramed,
  framedJpeg,
  imageSize,
  loadPhoto,
  type Framing,
} from "@/lib/challenges/photo";

/**
 * Take or pick a photo, frame it in a square (drag to move, slider to zoom),
 * and hand back a small JPEG. Retake / remove any time before saving.
 */
export function PhotoCapture({
  value,
  onChange,
  facing = "user",
  compact = false,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  /** "environment" when staff photograph someone with the back camera. */
  facing?: "user" | "environment";
  compact?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | ImageBitmap | null>(null);
  const [framing, setFraming] = useState<Framing>(DEFAULT_FRAMING);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    try {
      const loaded = await loadPhoto(file);
      setImg(loaded);
      setFraming(DEFAULT_FRAMING);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const inputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture={facing}
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );

  if (img) {
    return (
      <div className="space-y-3">
        {inputs}
        <Framer img={img} framing={framing} onFraming={setFraming} />
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <Slider
            value={[framing.zoom]}
            min={1}
            max={3}
            step={0.01}
            onValueChange={([z]) =>
              setFraming((f) => clampFraming({ ...f, zoom: z ?? 1 }, imageSize(img)))
            }
            className="flex-1"
            aria-label="Zoom"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1"
            onClick={() => setImg(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 flex-1"
            onClick={() => {
              try {
                onChange(framedJpeg(img, framing));
                setImg(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Use photo
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  if (value) {
    return (
      <div className="flex items-center gap-3">
        {inputs}
        <img src={value} alt="Your photo" className="h-20 w-20 rounded-full object-cover" />
        <div className="flex flex-1 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={() => cameraRef.current?.click()}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" /> Retake
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10 text-muted-foreground"
            onClick={() => onChange(null)}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {inputs}
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2")}>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="mr-2 h-4 w-4" /> Take photo
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={() => libraryRef.current?.click()}
        >
          <ImagePlus className="mr-2 h-4 w-4" /> Choose photo
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/** The square frame: one finger drags the photo inside it. */
function Framer({
  img,
  framing,
  onFraming,
}: {
  img: HTMLImageElement | ImageBitmap;
  framing: Framing;
  onFraming: (f: Framing) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; f: Framing } | null>(null);
  const SIZE = 560;
  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, SIZE, SIZE);
    drawFramed(ctx, img, imageSize(img), clampFraming(framing, imageSize(img)), SIZE);
  }, [img, framing]);
  return (
    <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl touch-none select-none">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, f: framing };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          onFraming(
            clampFraming(
              {
                ...d.f,
                x: d.f.x + (e.clientX - d.x) / rect.width,
                y: d.f.y + (e.clientY - d.y) / rect.height,
              },
              imageSize(img),
            ),
          );
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20">
        <div className="absolute inset-[6%] rounded-full ring-2 ring-white/60" />
      </div>
      <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-xs text-white/80">
        Drag to frame
      </p>
    </div>
  );
}
