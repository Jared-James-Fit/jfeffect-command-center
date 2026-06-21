/**
 * DurationTimerInCard — lightweight in-card timer for time-based exercises.
 *
 * Requirements:
 * - Lives entirely inside the exercise card (no overlay, no floating bar)
 * - Start / Pause / Stop / Reset controls
 * - "Use Prescribed Time" one-tap autofill
 * - Calls onComplete when the timer finishes or user taps "Complete Set"
 * - Extremely lightweight: no global state, no re-renders outside this component
 * - No background tracking, no persistent overlays
 *
 * Usage:
 *   <DurationTimerInCard
 *     prescribedSeconds={30}
 *     isConfirmed={false}
 *     completedSeconds={null}
 *     readonly={false}
 *     onComplete={(secs) => saveTimeCompletion(secs, { method: "countdown_timer" })}
 *   />
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, RotateCcw, X, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

function fmtSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

type Props = {
  prescribedSeconds: number | null;
  isConfirmed: boolean;
  completedSeconds?: number | null;
  readonly?: boolean;
  focusMode?: boolean;
  onComplete: (seconds: number, method: "countdown_timer" | "prescribed_quick_confirm" | "manual_entry") => void;
};

export function DurationTimerInCard({
  prescribedSeconds,
  isConfirmed,
  completedSeconds,
  readonly = false,
  focusMode = false,
  onComplete,
}: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [manualSecs, setManualSecs] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);

  const clearTick = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTick(), [clearTick]);

  const startCountdown = useCallback((fromSecs: number) => {
    clearTick();
    setRemaining(fromSecs);
    setPaused(false);
    elapsedRef.current = 0;
    startedAtRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r == null) return null;
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
        if (r <= 1) {
          clearTick();
          // Vibrate on completion
          try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch {}
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }, [clearTick]);

  const handleStart = () => {
    if (!prescribedSeconds || prescribedSeconds <= 0) return;
    startCountdown(prescribedSeconds);
  };

  const handlePause = () => {
    clearTick();
    setPaused(true);
  };

  const handleResume = () => {
    if (remaining == null) return;
    setPaused(false);
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r == null) return null;
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
        if (r <= 1) {
          clearTick();
          try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch {}
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  };

  const handleReset = () => {
    clearTick();
    setRemaining(null);
    setPaused(false);
    elapsedRef.current = 0;
    setElapsed(0);
  };

  const handleCompleteSet = () => {
    const secs = remaining === 0
      ? (prescribedSeconds ?? elapsedRef.current)
      : elapsedRef.current > 0
        ? elapsedRef.current
        : prescribedSeconds ?? 0;
    clearTick();
    setRemaining(null);
    setPaused(false);
    elapsedRef.current = 0;
    setElapsed(0);
    onComplete(secs, "countdown_timer");
  };

  const handleUsePrescribed = () => {
    if (!prescribedSeconds) return;
    onComplete(prescribedSeconds, "prescribed_quick_confirm");
  };

  const handleManualEntry = () => {
    const n = parseInt(manualSecs, 10);
    if (!n || n <= 0) return;
    onComplete(n, "manual_entry");
    setManualSecs("");
  };

  const isRunning = remaining != null && !paused;
  const isDone = remaining === 0;
  const hasStarted = remaining != null;

  // Confirmed state: show completed time
  if (isConfirmed && completedSeconds != null) {
    return (
      <div className={cn(
        "flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3",
        focusMode ? "h-9" : "h-8",
      )}>
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        <span className={cn("font-bold tabular-nums text-emerald-700", focusMode ? "text-sm" : "text-xs")}>
          {fmtSecs(completedSeconds)}
        </span>
        <span className={cn("text-emerald-600/70", focusMode ? "text-xs" : "text-[10px]")}>done</span>
      </div>
    );
  }

  if (readonly) {
    return (
      <div className={cn(
        "flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3",
        focusMode ? "h-9" : "h-8",
      )}>
        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className={cn("font-bold tabular-nums text-muted-foreground", focusMode ? "text-sm" : "text-xs")}>
          {prescribedSeconds ? fmtSecs(prescribedSeconds) : "—"}
        </span>
      </div>
    );
  }

  // Timer running or paused
  if (hasStarted) {
    return (
      <div className="space-y-1.5">
        {/* Timer display + controls */}
        <div className={cn(
          "flex items-center gap-1.5 rounded-lg border px-2",
          focusMode ? "h-10" : "h-9",
          isDone
            ? "border-emerald-500/40 bg-emerald-500/10"
            : paused
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-primary bg-primary/10",
        )}>
          {/* Pause/Resume */}
          <button
            type="button"
            onClick={paused ? handleResume : handlePause}
            disabled={isDone}
            aria-label={paused ? "Resume timer" : "Pause timer"}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-md transition active:scale-95",
              focusMode ? "h-7 w-7" : "h-6 w-6",
              isDone ? "opacity-40 cursor-not-allowed" : "hover:bg-black/10",
            )}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>

          {/* Time display */}
          <div className={cn(
            "flex-1 text-center font-black tabular-nums",
            focusMode ? "text-base" : "text-sm",
            isDone ? "text-emerald-700" : paused ? "text-amber-700" : "text-primary",
          )}>
            {isDone ? "Done!" : fmtSecs(remaining ?? 0)}
            {paused && !isDone && <span className="ml-1 text-[10px] font-medium opacity-70">paused</span>}
          </div>

          {/* Reset */}
          <button
            type="button"
            onClick={handleReset}
            aria-label="Reset timer"
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-md transition hover:bg-black/10 active:scale-95",
              focusMode ? "h-7 w-7" : "h-6 w-6",
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Complete Set button */}
        <button
          type="button"
          onClick={handleCompleteSet}
          className={cn(
            "w-full rounded-lg border font-bold transition active:scale-[0.98]",
            focusMode ? "h-9 text-sm" : "h-8 text-xs",
            isDone
              ? "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600"
              : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
          )}
        >
          <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
          {isDone ? "Complete Set" : "Complete Early"}
        </button>
      </div>
    );
  }

  // Idle state: show Start + Use Prescribed Time + manual entry
  return (
    <div className="space-y-1.5">
      {/* Start button */}
      <button
        type="button"
        onClick={handleStart}
        disabled={!prescribedSeconds}
        aria-label={prescribedSeconds ? `Start ${fmtSecs(prescribedSeconds)} timer` : "No duration set"}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-lg border font-bold transition active:scale-[0.98] disabled:opacity-50",
          focusMode ? "h-9 text-sm" : "h-8 text-xs",
          "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
        )}
      >
        <Play className="h-3.5 w-3.5" />
        {prescribedSeconds ? `Start ${fmtSecs(prescribedSeconds)}` : "No duration set"}
      </button>

      {/* One-tap autofill */}
      {prescribedSeconds && (
        <button
          type="button"
          onClick={handleUsePrescribed}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 font-semibold text-muted-foreground transition hover:bg-muted/60 active:scale-[0.98]",
            focusMode ? "h-8 text-xs" : "h-7 text-[10px]",
          )}
        >
          <CheckCircle2 className="h-3 w-3" />
          Use Prescribed Time ({fmtSecs(prescribedSeconds)})
        </button>
      )}
    </div>
  );
}
