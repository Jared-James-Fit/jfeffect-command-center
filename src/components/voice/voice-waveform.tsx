/**
 * The live waveform and timer every voice recording shows (design system:
 * components/voice). Smooth, rounded vertical bars drawn on a canvas from the
 * microphone's real loudness (the capture's `meter`, one AnalyserNode), the
 * newest on the right; a calm flat line in silence. Colour is the element's
 * text colour (`text-primary` for JF red, `text-foreground` for neutral), so
 * light and dark follow the theme. Drawn on animation frames from refs, never
 * React state: nothing re-renders while someone talks.
 */
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { VoiceMeter } from "@/lib/voice/voice-capture";
import { barHeights, formatClock } from "@/lib/voice/voice-meter";

const BAR_W = 3;
const GAP = 2.5;
/** A new bar about every 55 ms: a sentence reads as a shape, not a blur. */
const SAMPLE_MS = 55;

export function VoiceWaveform({ meter, className, height = 32 }: { meter: VoiceMeter; className?: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let color = "currentColor";
    const history: number[] = [];
    let lastSample = 0;
    const size = () => {
      dpr = Math.min(3, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      color = getComputedStyle(canvas).color || "currentColor";
    };
    size();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
    ro?.observe(canvas);
    const draw = (now: number) => {
      if (meter.active && now - lastSample >= SAMPLE_MS) {
        lastSample = now;
        history.push(meter.level);
        if (history.length > 400) history.splice(0, history.length - 400);
      }
      const count = Math.max(1, Math.floor((w + GAP) / (BAR_W + GAP)));
      const heights = barHeights(history, count, h - 2, 3);
      // the newest bar grows toward the live level between samples, so it never steps
      if (meter.active && heights.length) heights[heights.length - 1] = Math.round(3 + meter.level * (h - 5));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = color;
      const startX = w - count * (BAR_W + GAP) + GAP;
      for (let i = 0; i < count; i++) {
        const bh = heights[i];
        const x = startX + i * (BAR_W + GAP);
        const y = (h - bh) / 2;
        g.globalAlpha = bh <= 4 ? 0.3 : 0.55 + 0.45 * Math.min(1, bh / h);
        roundBar(g, x, y, BAR_W, bh);
      }
      g.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [meter]);
  return <canvas ref={ref} className={cn("block w-full min-w-0", className)} style={{ height }} aria-hidden data-voice-waveform />;
}

function roundBar(g: CanvasRenderingContext2D, x: number, y: number, bw: number, bh: number) {
  const r = Math.min(bw / 2, bh / 2);
  g.beginPath();
  if (typeof (g as any).roundRect === "function") (g as any).roundRect(x, y, bw, bh, r);
  else {
    g.moveTo(x + r, y);
    g.arcTo(x + bw, y, x + bw, y + bh, r);
    g.arcTo(x + bw, y + bh, x, y + bh, r);
    g.arcTo(x, y + bh, x, y, r);
    g.arcTo(x, y, x + bw, y, r);
    g.closePath();
  }
  g.fill();
}

/** The recording's clock ("0:07", "4:41 · 19s left" near the cap), written on animation frames. */
export function VoiceTimer({ meter, className }: { meter: VoiceMeter; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const el = ref.current;
      if (el) {
        const ms = meter.active && meter.startedAt ? performance.now() - meter.startedAt : 0;
        const left = meter.maxMs ? Math.ceil((meter.maxMs - ms) / 1000) : Infinity;
        const text = left <= 30 && meter.active ? `${formatClock(ms)} · ${Math.max(0, left)}s left` : formatClock(ms);
        if (text !== last) {
          el.textContent = text;
          last = text;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [meter]);
  return (
    <span ref={ref} className={cn("tabular-nums", className)} data-voice-timer>
      0:00
    </span>
  );
}
