import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SignaturePadHandle = { clear: () => void };

type Point = { x: number; y: number };

type Props = {
  /** Called with a PNG data URL once enough ink exists, or null when empty. */
  onChange: (dataUrl: string | null) => void;
  /** Initial image (e.g. restored from an in-memory draft). */
  initialDataUrl?: string | null;
  height?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Shown after a failed attempt to sign with the box still empty. */
  invalid?: boolean;
};

/** Total ink length (CSS px) before a drawing counts as a signature, so a stray tap can't sign. */
const MIN_INK_LENGTH = 60;
const INK = "#0f172a";

function strokeLength(stroke: Point[]): number {
  let total = 0;
  for (let i = 1; i < stroke.length; i++) {
    total += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
  }
  return total;
}

/**
 * Finger-friendly signature pad.
 *  - Sharp on Retina screens (backing store scaled by devicePixelRatio).
 *  - `touch-action: none` so drawing never scrolls the page on iOS.
 *  - Strokes are smoothed through midpoints and redrawn on resize / rotation.
 *  - The exported PNG has a white background, so it reads on any theme.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  {
    onChange,
    initialDataUrl,
    height = 200,
    disabled,
    ariaLabel = "Draw your signature",
    className,
    invalid,
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const activeRef = useRef<Point[] | null>(null);
  const restoredRef = useRef<HTMLImageElement | null>(null);
  const sizeRef = useRef({ w: 0, h: height, dpr: 1 });
  const [hasInk, setHasInk] = useState(!!initialDataUrl);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    if (restoredRef.current && strokesRef.current.length === 0) {
      ctx.drawImage(restoredRef.current, 0, 0, w, h);
    }

    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.6;

    const all = activeRef.current ? [...strokesRef.current, activeRef.current] : strokesRef.current;
    for (const stroke of all) {
      if (stroke.length === 0) continue;
      const pts = stroke.map((p) => ({ x: p.x * w, y: p.y * h }));
      if (pts.length < 3) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 1.4, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }, []);

  const inkLength = useCallback(() => {
    const { w, h } = sizeRef.current;
    return strokesRef.current.reduce(
      (sum, stroke) => sum + strokeLength(stroke.map((p) => ({ x: p.x * w, y: p.y * h }))),
      0,
    );
  }, []);

  const emit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const enough = inkLength() >= MIN_INK_LENGTH;
    setHasInk(enough);
    onChange(enough ? canvas.toDataURL("image/png") : null);
  }, [inkLength, onChange]);

  const clear = useCallback(() => {
    strokesRef.current = [];
    activeRef.current = null;
    restoredRef.current = null;
    render();
    setHasInk(false);
    onChange(null);
  }, [onChange, render]);

  useImperativeHandle(ref, () => ({ clear }), [clear]);

  // Size the backing store to the wrapper and keep it sharp across rotation / resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = Math.max(1, Math.round(wrap.clientWidth));
      sizeRef.current = { w, h: height, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
      render();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [height, render]);

  // Restore a draft image once.
  useEffect(() => {
    if (!initialDataUrl) return;
    const img = new Image();
    img.onload = () => {
      restoredRef.current = img;
      render();
    };
    img.src = initialDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div
        ref={wrapRef}
        className={cn(
          "relative overflow-hidden rounded-xl border-2 border-dashed bg-white",
          disabled
            ? "opacity-60"
            : invalid
              ? "border-destructive bg-destructive/5"
              : "border-border",
        )}
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={ariaLabel}
          className="block touch-none select-none"
          style={{ touchAction: "none" }}
          onPointerDown={(event) => {
            if (disabled) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            // Drawing again replaces a restored draft image rather than layering on it.
            restoredRef.current = null;
            activeRef.current = [toPoint(event)];
            render();
          }}
          onPointerMove={(event) => {
            if (!activeRef.current) return;
            const native = event.nativeEvent as PointerEvent;
            const events = native.getCoalescedEvents?.() ?? [];
            const batch = events.length > 0 ? events : [native];
            const rect = event.currentTarget.getBoundingClientRect();
            for (const e of batch) {
              activeRef.current.push({
                x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
                y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
              });
            }
            render();
          }}
          onPointerUp={() => {
            if (!activeRef.current) return;
            strokesRef.current = [...strokesRef.current, activeRef.current];
            activeRef.current = null;
            render();
            emit();
          }}
          onPointerCancel={() => {
            activeRef.current = null;
            render();
          }}
        />
        {/* Guide line and mark live in the DOM so they are never part of the exported image. */}
        <div className="pointer-events-none absolute inset-x-5 bottom-9 border-b border-slate-300" />
        <span className="pointer-events-none absolute bottom-10 left-5 text-lg font-light text-slate-400">
          ×
        </span>
        {!hasInk && (
          <span className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-slate-400">
            Sign here with your finger
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Use your finger or a stylus.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clear}
          disabled={disabled || !hasInk}
          className="h-9 px-3"
        >
          <Eraser className="mr-1.5 h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
    </div>
  );
});
