import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Big, dummy-proof rest-timer button.
 * - Tap to start countdown from `seconds`.
 * - Shows MM:SS while running.
 * - When it hits 0, resets back to the original label so the user can tap it again.
 */
export function RestTimerButton({
  seconds,
  label,
  className,
}: {
  seconds: number | null;
  label: string;
  className?: string;
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
          "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold tabular-nums text-foreground shadow-sm transition hover:bg-primary/20 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100",
          className,
        )}
      >
        <Play className="h-4 w-4" />
        <span>Rest: {label} — Tap to start</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border border-primary bg-primary px-2 py-1.5 text-primary-foreground shadow-sm",
        className,
      )}
      role="group"
      aria-label={`Rest timer ${display} remaining`}
    >
      <button
        type="button"
        onClick={paused ? resume : pause}
        aria-label={paused ? "Resume rest timer" : "Pause rest timer"}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-foreground/15 transition hover:bg-primary-foreground/25 active:scale-95"
      >
        {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
      </button>
      <div className="flex-1 text-center text-base font-semibold tabular-nums">
        {display}
        {paused && <span className="ml-2 text-xs font-medium opacity-80">Paused</span>}
      </div>
      <button
        type="button"
        onClick={restart}
        aria-label="Restart rest timer"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-foreground/15 transition hover:bg-primary-foreground/25 active:scale-95"
      >
        <RotateCcw className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={stop}
        aria-label="Stop rest timer"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-foreground/15 transition hover:bg-primary-foreground/25 active:scale-95"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}