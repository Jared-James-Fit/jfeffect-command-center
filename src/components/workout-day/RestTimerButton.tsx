import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play, RotateCcw, Timer, X } from "lucide-react";
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
import { feedback } from "@/lib/feedback";

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
type RestTimerProps = {
  seconds: number | null;
  /** True when the rest comes from the category default, not the program. */
  auto?: boolean;
  className?: string;
  /** Fired when the rest countdown begins — used to auto-start the workout session clock. */
  onStart?: () => void;
  /** Per-workout/day key — keeps timer state isolated per workout and client. */
  scopeKey: string;
  /** Per-exercise-row key — identifies which card owns the active timer. */
  timerId: string;
};

/** One card's rest timer: the store's state for this workout, the repaint while it runs, the buzz / chime at the end. */
function useRestTimer({ seconds, onStart, scopeKey, timerId }: RestTimerProps) {
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
    // rest is over: the timer's long buzz and two gentle chimes (an iPhone's web view can't
    // buzz from a timer, so there the chimes say it)
    feedback("timer");
  }, [mine, mine && restRemainingMs(mine)]);

  const disabled = !seconds || seconds <= 0;
  const start = () => {
    if (disabled) return;
    onStart?.();
    setState(startRestTimer(scopeKey, timerId, seconds as number));
  };
  return { mine, disabled, start, setState };
}

/** "Rest 5 min", "Rest 2:30", "Rest 45 s": the prescribed rest in words, the card's action row. */
export function restWords(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const s = Math.round(seconds);
  if (s < 60) return `Rest ${s} s`;
  if (s % 60 === 0) return `Rest ${s / 60} min`;
  return `Rest ${formatClock(s)}`;
}

/**
 * The rest timer laid out across the card's action row: `label` on the left
 * ("Rest 5 min", or the countdown with pause / restart / stop while it runs)
 * and `button` among the row's icons (the timer: start it, or start it again).
 * One state for both, so the chime plays once.
 */
export function RestTimer(props: RestTimerProps & { children: (parts: { label: ReactNode; button: ReactNode }) => ReactNode }) {
  const { seconds, auto = false, scopeKey, children } = props;
  const { mine, disabled, start, setState } = useRestTimer(props);
  const words = restWords(seconds);
  const clock = seconds && seconds > 0 ? formatClock(seconds) : null;
  const label = mine
    ? <RunningRest mine={mine} scopeKey={scopeKey} start={start} setState={setState} />
    : words
      ? <span className="truncate text-[15px] text-muted-foreground" title={auto ? "The usual rest for this kind of exercise" : undefined} data-rest-words>{words}</span>
      : null;
  const button = disabled ? null : (
    <button
      type="button"
      onClick={start}
      aria-label={mine ? "Restart rest timer" : `Start ${clock} ${auto ? "auto " : ""}rest timer`}
      title={mine ? "Start the rest again" : "Start your rest"}
      data-rest-start
      className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 [&_svg]:size-[22px]"
    >
      <Timer />
      {mine && <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-foreground ring-2 ring-card" />}
    </button>
  );
  return <>{children({ label, button })}</>;
}

/**
 * The rest timer as one chip ("▶ 2:00", then the countdown), for anywhere
 * that has no action row of its own.
 */
export function RestTimerButton(props: RestTimerProps) {
  const { seconds, auto = false, className, scopeKey } = props;
  const { mine, disabled, start, setState } = useRestTimer(props);
  // Compact by default ("▶ 2:00"); the "Rest" / "Auto rest" label only
  // appears when the surrounding @container (the card's action row) has room.
  const clock = seconds && seconds > 0 ? formatClock(seconds) : null;
  if (!mine) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        title={clock ? `${auto ? "Auto rest" : "Rest"} ${clock} — tap to start` : "No rest set"}
        aria-label={clock ? `Start ${clock} ${auto ? "auto " : ""}rest timer` : "Rest timer unavailable"}
        className={cn(
          "inline-flex h-10 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-border bg-background pl-1.5 pr-3 text-xs font-semibold tabular-nums text-foreground transition hover:bg-muted active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 @max-[17rem]:h-9 @max-[17rem]:pl-2 @max-[17rem]:pr-2.5",
          className,
        )}
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-foreground @max-[17rem]:h-auto @max-[17rem]:w-auto @max-[17rem]:bg-transparent">
          <Play className="h-3 w-3 fill-current" />
        </span>
        <span className="hidden text-[11px] font-semibold text-muted-foreground @[26rem]:inline">{auto ? "Auto rest" : "Rest"}</span>
        <span>{clock ?? "Rest"}</span>
      </button>
    );
  }

  return <RunningRest mine={mine} scopeKey={scopeKey} start={start} setState={setState} className={className} />;
}

/** The countdown while it runs: pause / resume, the time, restart, stop; "Rest done" once it's over. */
function RunningRest({ mine, scopeKey, start, setState, className }: {
  mine: RestTimerState;
  scopeKey: string;
  start: () => void;
  setState: (s: RestTimerState | null) => void;
  className?: string;
}) {
  const paused = mine.pausedRemainingMs != null;
  const finished = restFinished(mine);
  const display = finished ? "Rest done" : formatClock(restRemainingMs(mine) / 1000);

  return (
    <div
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-0 whitespace-nowrap rounded-full border px-1 ring-2 @max-[17rem]:h-9",
        finished
          ? "border-emerald-500/50 bg-emerald-500/10 ring-emerald-500/10"
          : "border-border bg-secondary ring-transparent",
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
          className="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-foreground/10 active:scale-95"
        >
          {paused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
        </button>
      )}
      <div className="px-0.5 text-sm font-bold tabular-nums text-foreground">
        {!finished && <span className="mr-1 hidden text-[10px] font-semibold uppercase tracking-wide text-muted-foreground @[27rem]:inline">Resting</span>}
        {display}
        {paused && <span className="ml-1 hidden text-[10px] font-medium text-muted-foreground @[26rem]:inline">Paused</span>}
        {finished && Date.now() - mine.endsAt > 5000 && (
          <span className="ml-1 hidden text-[10px] font-medium text-muted-foreground @[27rem]:inline">
            {formatAgo(Date.now() - mine.endsAt)}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={start}
        aria-label="Restart rest timer"
        className="hidden h-7 w-7 shrink-0 @[24rem]:inline-flex items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground active:scale-95"
      >
        <RotateCcw className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => { clearRestTimer(scopeKey); setState(null); }}
        aria-label={finished ? "Dismiss rest timer" : "Stop rest timer"}
        className="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground active:scale-95"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
