/**
 * DurationTimerInCard — flexible, compact time logging for one set.
 *
 * Principles (dummy-proof, no forced timer):
 * - The timer is OPTIONAL. Typing a time and tapping Log is always allowed.
 * - The target is adjustable inline (tap the time chip, type "45" or "1:30").
 * - One compact row: [ target/remaining ] [ start/pause ] [ log ]
 * - A logged set stays editable — tap the value to correct it.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, RotateCcw, Check, Clock, Pencil } from "lucide-react";
import { parseDurationInput } from "@/lib/duration";
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
  /** Persist an adjusted timer target for this row (device-local). */
  onTargetChange?: (seconds: number | null) => void;
  onComplete: (
    seconds: number,
    method: "countdown_timer" | "prescribed_quick_confirm" | "manual_entry",
  ) => void;
};

export function DurationTimerInCard({
  prescribedSeconds,
  isConfirmed,
  completedSeconds,
  readonly = false,
  focusMode = false,
  onTargetChange,
  onComplete,
}: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const clearTick = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTick(), [clearTick]);

  const tick = useCallback(() => {
    clearTick();
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r == null) return null;
        elapsedRef.current += 1;
        if (r <= 1) {
          clearTick();
          try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch { /* no haptics */ }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }, [clearTick]);

  const start = () => {
    if (!prescribedSeconds || prescribedSeconds <= 0) {
      setEditing(true);
      setDraft("");
      return;
    }
    elapsedRef.current = 0;
    setRemaining(prescribedSeconds);
    setPaused(false);
    tick();
  };

  const pause = () => { clearTick(); setPaused(true); };
  const resume = () => { setPaused(false); tick(); };
  const reset = () => {
    clearTick();
    setRemaining(null);
    setPaused(false);
    elapsedRef.current = 0;
  };

  /** Log whatever is on screen: elapsed time if the timer ran, else the target. */
  const log = () => {
    const running = remaining != null;
    const secs = running
      ? (remaining === 0 ? (prescribedSeconds ?? elapsedRef.current) : elapsedRef.current)
      : (prescribedSeconds ?? 0);
    if (!secs || secs <= 0) { setEditing(true); return; }
    reset();
    onComplete(secs, running ? "countdown_timer" : "prescribed_quick_confirm");
  };

  const commitDraft = (thenLog: boolean) => {
    const parsed = parseDurationInput(draft);
    setEditing(false);
    setDraft("");
    if (parsed == null) return;
    onTargetChange?.(parsed);
    if (thenLog) onComplete(parsed, "manual_entry");
  };

  const height = focusMode ? "h-10" : "h-9";
  const running = remaining != null && !paused;
  const started = remaining != null;
  const done = remaining === 0;

  if (readonly) {
    return (
      <div className={cn("flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3", height)}>
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-bold tabular-nums text-muted-foreground">
          {isConfirmed && completedSeconds ? fmtSecs(completedSeconds) : prescribedSeconds ? fmtSecs(prescribedSeconds) : "—"}
        </span>
      </div>
    );
  }

  // Inline manual entry (also used to set / adjust the target).
  if (editing) {
    return (
      <form
        className={cn("flex items-center gap-1 rounded-lg border border-primary bg-primary/5 px-1.5", height)}
        onSubmit={(e) => { e.preventDefault(); commitDraft(true); }}
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitDraft(false)}
          inputMode="numeric"
          placeholder="45 or 1:30"
          aria-label="Enter time"
          className="min-w-0 flex-1 bg-transparent text-sm font-bold tabular-nums outline-none placeholder:font-normal placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          aria-label="Save time"
          onMouseDown={(e) => e.preventDefault()}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
        >
          <Check className="h-4 w-4" />
        </button>
      </form>
    );
  }

  // Logged — still editable.
  if (isConfirmed && completedSeconds != null && !started) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(String(completedSeconds)); setEditing(true); }}
        aria-label="Edit logged time"
        className={cn(
          "flex w-full items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-left",
          height,
        )}
      >
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span className="flex-1 text-sm font-bold tabular-nums text-emerald-700">{fmtSecs(completedSeconds)}</span>
        <Pencil className="h-3 w-3 shrink-0 text-emerald-600/60" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border px-1.5",
        height,
        done ? "border-emerald-500/50 bg-emerald-500/10"
          : started ? (paused ? "border-amber-500/50 bg-amber-500/10" : "border-primary bg-primary/10")
            : "border-border bg-muted/30",
      )}
    >
      {/* Time value — tap to type/adjust */}
      <button
        type="button"
        onClick={() => {
          if (started) return;
          setDraft(prescribedSeconds ? String(prescribedSeconds) : "");
          setEditing(true);
        }}
        aria-label={started ? "Time remaining" : "Set time"}
        className={cn(
          "min-w-0 flex-1 text-left text-sm font-black tabular-nums",
          done ? "text-emerald-700" : paused ? "text-amber-700" : started ? "text-primary" : "text-foreground",
        )}
      >
        {started
          ? (done ? "Done" : fmtSecs(remaining ?? 0))
          : prescribedSeconds ? fmtSecs(prescribedSeconds) : "Set time"}
      </button>

      {/* Start / pause / resume */}
      {!done && (
        <button
          type="button"
          onClick={started ? (paused ? resume : pause) : start}
          aria-label={started ? (paused ? "Resume timer" : "Pause timer") : "Start timer"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/10 active:scale-95"
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      )}

      {started && (
        <button
          type="button"
          onClick={reset}
          aria-label="Reset timer"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/10 active:scale-95"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Log — always available, never requires the timer */}
      <button
        type="button"
        onClick={log}
        aria-label="Log this set"
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-bold",
          done ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground",
        )}
      >
        <Check className="h-3.5 w-3.5" />
        Log
      </button>
    </div>
  );
}
