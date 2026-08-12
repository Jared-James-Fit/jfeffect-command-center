import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clearRestTimer,
  formatAgo,
  formatClock,
  pauseRestTimer,
  readRestTimer,
  restFinished,
  restRemainingMs,
  resumeRestTimer,
  startRestTimer,
  subscribeRestTimer,
  type RestTimerState,
} from "@/lib/rest-timer-store";

/**
 * Compact rest-timer chip.
 *
 * Timestamp-based: the countdown is derived from an absolute `endsAt` stored
 * per workout scope, so leaving the app, locking the phone, or reloading the
 * page all resolve to the correct remaining time on return (or a clear
 * "Rest done" state if it elapsed while away). The interval below only
 * repaints; it never owns the countdown value.
 *
 * One timer runs per `scopeKey` (the workout day): starting a rest on another
 * exercise replaces the previous one, and other cards fall back to their
 * idle label.
 */
export function RestTimerButton({
  seconds,
  label,
  className,
  onStart,
  scopeKey,
  timerId,
}: {
  seconds: number | null;
  label: string;
  className?: string;
  /** Fired when the rest countdown begins — used to auto-start the workout session clock. */
  onStart?: () => void;
  /** Per-workout/day key — keeps timer state isolated per workout and client. */
  scopeKey: string;
  /** Per-exercise-row key — identifies which card owns the active timer. */
  timerId: string;
}) {
  const [state, setState] = useState<RestTimerState | null>(null);
  const [, forceTick] = useState(0);
  const vibratedRef = useRef<number | null>(null);

  // Hydrate + subscribe. Recompute on every return path.
  useEffect(() => {
    const read = () => setState(readRestTimer(scopeKey));
    read();
    const unsub = subscribeRestTimer(scopeKey, read);
    const onVisible = () => { if (document.visibilityState === "visible") read(); };
    const onStorage = (e: StorageEvent) => { if (e.key?.includes(scopeKey)) read(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", read);
    window.addEventListener("pageshow", read);
    window.addEventListener("storage", onStorage);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", read);
      window.removeEventListener("pageshow", read);
      window.removeEventListener("storage", onStorage);
    };
  }, [scopeKey]);

  // Repaint ticker — only while this card owns a live timer.
  const mine = state && state.timerId === timerId ? state : null;
  const active = !!mine && (mine.pausedRemainingMs != null || !restFinished(mine));
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [active]);

  // Haptic cue on completion (once per timer instance).
  useEffect(() => {
    if (!mine || !restFinished(mine)) return;
    if (vibratedRef.current === mine.startedAt) return;
    vibratedRef.current = mine.startedAt;
    // Only buzz if the finish just happened while we're looking at it.
    if (Date.now() - mine.endsAt > 3000) return;
    try { navigator?.vibrate?.([180, 80, 180]); } catch { /* no-op */ }
  }, [mine, mine && restRemainingMs(mine)]);

  const disabled = !seconds || seconds <= 0;

  const start = () => {
    if (disabled) return;
    onStart?.();
    setState(startRestTimer(scopeKey, timerId, seconds as number));
  };

  if (!mine) {
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

  const paused = mine.pausedRemainingMs != null;
  const finished = restFinished(mine);
  const display = finished ? "Rest done" : formatClock(restRemainingMs(mine) / 1000);

  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border px-1 ring-2",
        finished
          ? "border-emerald-500/50 bg-emerald-500/10 ring-emerald-500/10"
          : "border-primary/50 bg-primary/15 ring-primary/10",
        className,
      )}
      role="group"
      aria-live="polite"
      aria-label={finished ? "Rest complete" : `Rest timer ${display} remaining`}
    >
      {!finished && (
        <button
          type="button"
          onClick={() => setState(paused ? resumeRestTimer(scopeKey) : pauseRestTimer(scopeKey))}
          aria-label={paused ? "Resume rest timer" : "Pause rest timer"}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-primary transition hover:bg-primary/15 active:scale-95"
        >
          {paused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
        </button>
      )}
      <div className="px-1 text-sm font-bold tabular-nums text-foreground">
        {display}
        {paused && <span className="ml-1 text-[10px] font-medium text-muted-foreground">Paused</span>}
        {finished && Date.now() - mine.endsAt > 5000 && (
          <span className="ml-1 text-[10px] font-medium text-muted-foreground">
            {formatAgo(Date.now() - mine.endsAt)}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={start}
        aria-label="Restart rest timer"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-primary/15 hover:text-foreground active:scale-95"
      >
        <RotateCcw className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => { clearRestTimer(scopeKey); setState(null); }}
        aria-label={finished ? "Dismiss rest timer" : "Stop rest timer"}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-primary/15 hover:text-foreground active:scale-95"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
