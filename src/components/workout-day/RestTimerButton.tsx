import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact rest-timer chip.
 * - Tap to start countdown from `seconds`.
 * - Shows MM:SS while running.
 * - When it hits 0, resets back to the original label so the user can tap it again.
 * Visual weight is intentionally light so the set table stays the card's focus;
 * the running state gets a subtle highlight instead of a full-width block.
 */
export function RestTimerButton({
  seconds,
  label,
  className,
  onStart,
}: {
  seconds: number | null;
  label: string;
  className?: string;
  /** Fired when the rest countdown begins — used to auto-start the workout session clock. */
  onStart?: () => void;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const tick = () => {
    clearTick();
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r == null) return null;
        if (r <= 1) {
          clearTick();
          try {
            if (typeof navigator !== "undefined" && navigator.vibrate) {
              navigator.vibrate([180, 80, 180]);
            }
          } catch {}
          return null;
        }
        return r - 1;
      });
    }, 1000);
  };

  useEffect(() => () => clearTick(), []);

  const start = () => {
    if (!seconds || seconds <= 0) return;
    onStart?.();
    setPaused(false);
    setRemaining(seconds);
    tick();
  };

  const pause = () => {
    clearTick();
    setPaused(true);
  };

  const resume = () => {
    setPaused(false);
    tick();
  };

  const restart = () => {
    if (!seconds || seconds <= 0) return;
    clearTick();
    setPaused(false);
    setRemaining(seconds);
    tick();
  };

  const stop = () => {
    clearTick();
    setPaused(false);
    setRemaining(null);
  };

  const running = remaining != null;
  const display =
    remaining != null
      ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
      : label;

  const disabled = !seconds || seconds <= 0;

  if (!running) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        aria-label={`Start rest timer for ${label}`}
        className={cn(
          "inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 text-xs font-semibold tabular-nums text-foreground transition hover:bg-primary/15 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100",
          className,
        )}
      >
        <Play className="h-3 w-3 fill-current" />
        <span>Rest · {label}</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border border-primary/50 bg-primary/15 px-1 ring-2 ring-primary/10",
        className,
      )}
      role="group"
      aria-label={`Rest timer ${display} remaining`}
    >
      <button
        type="button"
        onClick={paused ? resume : pause}
        aria-label={paused ? "Resume rest timer" : "Pause rest timer"}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-primary transition hover:bg-primary/15 active:scale-95"
      >
        {paused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
      </button>
      <div className="px-1 text-sm font-bold tabular-nums text-foreground">
        {display}
        {paused && <span className="ml-1 text-[10px] font-medium text-muted-foreground">Paused</span>}
      </div>
      <button
        type="button"
        onClick={restart}
        aria-label="Restart rest timer"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-primary/15 hover:text-foreground active:scale-95"
      >
        <RotateCcw className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={stop}
        aria-label="Stop rest timer"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-primary/15 hover:text-foreground active:scale-95"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}