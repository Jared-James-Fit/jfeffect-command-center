import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { defaultRestRange, type ExerciseCategory } from "@/lib/exercise-metadata";

/**
 * Workout rest timer.
 *
 * - Uses `effectiveRestSeconds` (override > programmed > category default mid-point) as the
 *   default countdown.
 * - Auto-starts whenever `triggerKey` changes (incremented by the parent
 *   when a set is marked complete).
 * - Manual Start / Pause / Reset always available.
 * - When the countdown reaches zero, fires an in-page "next set ready" cue
 *   (sound is intentionally omitted; visual only so it works in silent mode).
 */
export function WorkoutRestTimer({
  effectiveSeconds,
  category,
  triggerKey,
  compact = false,
}: {
  effectiveSeconds: number | null;
  category: ExerciseCategory;
  triggerKey: number;
  compact?: boolean;
}) {
  // Pick a sensible default: programmed/override seconds, else midpoint of category range.
  const defaultSeconds = (() => {
    if (effectiveSeconds != null && effectiveSeconds > 0) return effectiveSeconds;
    return defaultRestRange(category).suggested;
  })();

  const [remaining, setRemaining] = useState<number>(defaultSeconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const lastTrigger = useRef<number>(triggerKey);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-start on completion trigger.
  useEffect(() => {
    if (triggerKey === lastTrigger.current) return;
    lastTrigger.current = triggerKey;
    setRemaining(defaultSeconds);
    setDone(false);
    setRunning(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  // Tick.
  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          setRunning(false);
          setDone(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [running]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const reset = () => {
    setRemaining(defaultSeconds);
    setRunning(false);
    setDone(false);
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1",
        done && "border-primary/50 bg-primary/10 text-primary",
        compact ? "text-xs" : "text-sm",
      )}
      aria-live="polite"
    >
      <Timer className="h-3.5 w-3.5 opacity-70" />
      <span className="font-mono tabular-nums font-semibold min-w-[44px] text-center">
        {done ? "Ready" : fmt(remaining)}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0"
        aria-label={running ? "Pause rest timer" : "Start rest timer"}
        onClick={() => {
          if (done) reset();
          setRunning((r) => !r);
        }}
      >
        {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0"
        aria-label="Reset rest timer"
        onClick={reset}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}