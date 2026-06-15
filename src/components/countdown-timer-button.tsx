import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, Timer, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDurationShort } from "@/lib/duration";

type Props = {
  /** Total seconds to count down from. If null/<=0 the button is disabled. */
  seconds: number | null | undefined;
  /** Called once the timer reaches 0 (only on natural completion). */
  onComplete?: () => void;
  /** Compact (icon-only trigger) vs full label. */
  compact?: boolean;
  className?: string;
  label?: string;
};

/**
 * Lightweight countdown timer. Click once to start; while running it shows
 * the remaining time, supports pause/resume/restart, and announces when it
 * finishes. Never auto-starts. Uses a single rAF-driven interval so the
 * displayed value stays accurate even if the tab is briefly throttled.
 */
export function CountdownTimerButton({ seconds, onComplete, compact, className, label }: Props) {
  const total = seconds && seconds > 0 ? Math.round(seconds) : 0;
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  // remaining is the snapshot when not running; while running we derive from endsAt.
  const [remaining, setRemaining] = useState(total);
  const endsAtRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  // Reset when prescribed seconds change.
  useEffect(() => {
    setRunning(false);
    setDone(false);
    setRemaining(total);
    endsAtRef.current = null;
  }, [total]);

  // rAF/interval ticker.
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      if (endsAtRef.current == null) return;
      const left = Math.max(0, Math.ceil((endsAtRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        setRunning(false);
        setDone(true);
        endsAtRef.current = null;
        // Soft beep (best-effort, no asset required).
        try {
          const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (AC) {
            const ctx = new AC();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.frequency.value = 880;
            o.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.001, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
            o.start(); o.stop(ctx.currentTime + 0.65);
          }
        } catch { /* no-op */ }
        if (navigator?.vibrate) { try { navigator.vibrate([100, 60, 100]); } catch { /* no-op */ } }
        onComplete?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    tickRef.current = id;
    return () => { if (tickRef.current) window.clearInterval(tickRef.current); tickRef.current = null; };
  }, [running, onComplete]);

  const start = () => {
    if (total <= 0) return;
    const from = done ? total : (remaining > 0 ? remaining : total);
    endsAtRef.current = Date.now() + from * 1000;
    setRemaining(from);
    setDone(false);
    setRunning(true);
  };
  const pause = () => {
    setRunning(false);
    endsAtRef.current = null;
  };
  const reset = () => {
    setRunning(false);
    setDone(false);
    setRemaining(total);
    endsAtRef.current = null;
  };

  const disabled = total <= 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, ((total - remaining) / total) * 100)) : 0;

  if (disabled) {
    return (
      <Button type="button" size="sm" variant="outline" disabled className={cn("h-7 gap-1 px-2 text-[11px]", className)} title="Set a duration first">
        <Timer className="h-3.5 w-3.5" />
        {!compact && <span>Timer</span>}
      </Button>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Button
        type="button"
        size="sm"
        variant={done ? "secondary" : running ? "secondary" : "outline"}
        onClick={running ? pause : start}
        className={cn("relative h-7 gap-1 overflow-hidden px-2 text-[11px] font-semibold tabular-nums")}
        title={running ? "Pause" : done ? "Restart" : "Start timer"}
        aria-label={running ? "Pause timer" : done ? "Restart timer" : "Start timer"}
      >
        {/* progress fill */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 bg-primary/15 transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
        <span className="relative inline-flex items-center gap-1">
          {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {done ? "Done" : (running || remaining !== total) ? formatDurationShort(remaining) : (label ?? `Start · ${formatDurationShort(total)}`)}
        </span>
      </Button>
      {(running || done || remaining !== total) && (
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={reset} title="Reset timer" aria-label="Reset timer">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}