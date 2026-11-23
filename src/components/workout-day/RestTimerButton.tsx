import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Pause, Play, RotateCcw, Timer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REST_STEP_SECONDS,
  adjustRestTimer,
  claimRestDoneCue,
  clearRestTimer,
  formatAgo,
  formatClock,
  restWords,
  pauseRestTimer,
  readRestAutoStart,
  readRestTimer,
  restFinished,
  restRemainingMs,
  resumeRestTimer,
  setRestAutoStart,
  startRestTimer,
  subscribeRestAutoStart,
  subscribeRestTimer,
  type RestTimerState,
} from "@/lib/rest-timer-store";
import { feedback } from "@/lib/feedback";

/**
 * The card's rest, one line right above its set table (Nov 21 2026).
 *
 * Timestamp-based: the countdown is an absolute `endsAt` kept per workout
 * (rest-timer-store.ts), so leaving the app, locking the phone, switching
 * exercises or reloading all come back to the right time, or "Rest done" with
 * how long ago. The ticker below only repaints.
 *
 * One rest runs per workout. It starts by itself when a working set is logged
 * (unless turned off in a card's ⋯) or with a tap on "Rest 3 min", and it's
 * shown on the card it started on and, once that exercise is done, on the next
 * one with sets to log too (restHosts): wherever the next set is.
 */

/** "Rest 5 min", "Rest 2:30", "Rest 45 s": the prescribed rest in words, before it starts. */
export { restWords };

/** The workout's rest as it is now (null when none), kept in step with every card and tab. */
export function useRestState(scopeKey: string): RestTimerState | null {
  const [state, setState] = useState<RestTimerState | null>(null);
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
  return state;
}

/** Whether a rest starts by itself when a set is logged (this phone; on by default). */
export function useRestAutoStart(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeRestAutoStart, readRestAutoStart, () => true);
  return [on, setRestAutoStart];
}

// The running line fits a 320pt phone: the clock, +15 and stop always; −15
// from a 272px row, start-again from 320px, the word "Rest" from 384px
// (a row is the card's width, the How To and Note icons included).
const ICON = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 [&_svg]:size-[18px]";

export function RestLine({ seconds, auto = false, scopeKey, timerId, shows, idle = true, onStart, className, children }: {
  /** The prescribed rest (the program's, else the usual one for this kind of exercise). */
  seconds: number | null;
  /** True when the rest is the usual one for this kind of exercise, not the program's. */
  auto?: boolean;
  /** The workout: one rest runs per workout. */
  scopeKey: string;
  /** This card's row. */
  timerId: string;
  /** Whether this card shows a rest that started on `ownerId` (its own always). */
  shows?: (ownerId: string) => boolean;
  /** Offer "Rest 3 min" while nothing runs (off once the card's sets are all in, or read-only). */
  idle?: boolean;
  /** A tap that starts the rest (the workout's clock starts with it). */
  onStart?: () => void;
  className?: string;
  /** The card's quiet icons on the right (How To, Note). */
  children?: React.ReactNode;
}) {
  const state = useRestState(scopeKey);
  const mine = state && (state.timerId === timerId || shows?.(state.timerId)) ? state : null;
  const [, tick] = useState(0);
  const live = !!mine && mine.pausedRemainingMs == null && !restFinished(mine);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [live]);
  // once a minute after it's done, so "2:10 ago" moves on
  const done = !!mine && restFinished(mine);
  useEffect(() => {
    if (!done) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [done]);

  // The end of the rest: the timer's buzz and two gentle chimes, once per rest
  // however many cards show it, and only when it ended while we're looking.
  useEffect(() => {
    if (!mine || !restFinished(mine)) return;
    if (Date.now() - mine.endsAt > 3000) return;
    if (claimRestDoneCue(scopeKey, mine)) feedback("timer");
  }, [mine, done, scopeKey]);

  const words = restWords(seconds);
  const start = () => {
    if (!seconds || seconds <= 0) return;
    onStart?.();
    startRestTimer(scopeKey, timerId, seconds);
  };

  let left: React.ReactNode = null;
  let stateName: "idle" | "running" | "paused" | "done" | "off" = "off";
  if (mine) {
    const paused = mine.pausedRemainingMs != null;
    const left_ms = restRemainingMs(mine);
    stateName = done ? "done" : paused ? "paused" : "running";
    if (done) {
      const ago = Date.now() - mine.endsAt;
      left = (
        <div className="flex min-w-0 items-center gap-1" role="status" aria-live="polite">
          <span className="inline-flex shrink-0 items-center gap-1.5 pl-1 text-[15px] font-semibold text-success">
            <Check className="h-4 w-4 shrink-0" aria-hidden />
            Rest done
          </span>
          {ago > 5000 && <span className="min-w-0 truncate text-[13px] tabular-nums text-muted-foreground" data-rest-ago>· {formatAgo(ago)}</span>}
          <button type="button" className={ICON} onClick={() => startRestTimer(scopeKey, mine.timerId, mine.durationSeconds)} aria-label="Start the rest again" data-rest-restart>
            <RotateCcw />
          </button>
          <button type="button" className={ICON} onClick={() => clearRestTimer(scopeKey)} aria-label="Dismiss rest" data-rest-stop>
            <X />
          </button>
        </div>
      );
    } else {
      const total = Math.max(1, mine.durationSeconds * 1000);
      const share = Math.min(1, Math.max(0, 1 - left_ms / total));
      left = (
        <div className="flex min-w-0 items-center" role="group" aria-label="Rest timer">
          <button
            type="button"
            onClick={() => (paused ? resumeRestTimer(scopeKey) : pauseRestTimer(scopeKey))}
            aria-label={paused ? `Resume rest, ${formatClock(left_ms / 1000)} left` : `Pause rest, ${formatClock(left_ms / 1000)} left`}
            className="relative -ml-1 inline-flex h-10 shrink-0 items-center gap-1.5 overflow-hidden rounded-full pl-2 pr-3 text-foreground transition hover:bg-muted active:scale-[0.98]"
            data-rest-toggle
          >
            {paused ? <Play className="h-4 w-4 fill-current" aria-hidden /> : <Pause className="h-4 w-4 fill-current" aria-hidden />}
            <span className="hidden text-[15px] text-muted-foreground @[24rem]:inline">Rest</span>
            <span className={cn("text-[17px] font-semibold tabular-nums", paused && "text-muted-foreground")} data-rest-clock>
              {formatClock(left_ms / 1000)}
            </span>
            {paused && <span className="hidden text-[13px] text-muted-foreground @[27rem]:inline">Paused</span>}
            {/* how much of it has gone by: one hairline under the clock */}
            <span aria-hidden className="absolute inset-x-3 bottom-1 h-0.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-foreground/40" style={{ width: `${share * 100}%` }} />
            </span>
          </button>
          <button type="button" className={cn(ICON, "hidden w-11 text-[13px] font-semibold tabular-nums @[17rem]:inline-flex")} onClick={() => adjustRestTimer(scopeKey, -REST_STEP_SECONDS)} aria-label={`${REST_STEP_SECONDS} seconds less rest`} data-rest-less>
            −{REST_STEP_SECONDS}
          </button>
          <button type="button" className={cn(ICON, "w-11 text-[13px] font-semibold tabular-nums")} onClick={() => adjustRestTimer(scopeKey, REST_STEP_SECONDS)} aria-label={`${REST_STEP_SECONDS} seconds more rest`} data-rest-more>
            +{REST_STEP_SECONDS}
          </button>
          <button type="button" className={cn(ICON, "hidden @[20rem]:inline-flex")} onClick={() => startRestTimer(scopeKey, mine.timerId, mine.durationSeconds)} aria-label="Start the rest again" data-rest-restart>
            <RotateCcw />
          </button>
          <button type="button" className={ICON} onClick={() => clearRestTimer(scopeKey)} aria-label="Stop rest" data-rest-stop>
            <X />
          </button>
        </div>
      );
    }
  } else if (idle && words) {
    stateName = "idle";
    left = (
      <button
        type="button"
        onClick={start}
        className="-ml-1 inline-flex h-10 min-w-0 items-center gap-1.5 rounded-full pl-1.5 pr-3 text-[15px] text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-[0.98]"
        aria-label={`Start ${formatClock(seconds as number)} rest`}
        title={auto ? "The usual rest for this kind of exercise. Tap to start it." : "Tap to start your rest"}
        data-rest-start
      >
        <Timer className="h-[18px] w-[18px] shrink-0" aria-hidden />
        <span className="truncate" data-rest-words>{words}</span>
      </button>
    );
  }

  return (
    <div className={cn("@container mt-2 flex min-h-10 min-w-0 items-center gap-0.5", className)} data-rest-line={stateName} data-testid="exercise-action-row">
      <div className="flex min-w-0 flex-1 items-center">{left}</div>
      {children}
    </div>
  );
}
