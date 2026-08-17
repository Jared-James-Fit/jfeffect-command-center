/**
 * Pure timestamp math for the generic client Workout Tools (Tally /
 * Stopwatch / Timer).
 *
 * Completely independent of the prescribed Rest timer
 * (`RestTimerButton` / `ActiveRestTimerProvider`) — no shared storage keys,
 * no shared state, and nothing here feeds analytics, logging or completion.
 *
 * All timing derives from absolute epoch-ms so backgrounding the app never
 * drifts; the UI only needs a 1 Hz repaint while something is running.
 */

export type StopwatchState = {
  /** epoch-ms the current run started; null when paused/stopped. */
  startedAt: number | null;
  /** ms already banked from previous runs. */
  accumulatedMs: number;
};

export type TimerState = {
  /** Countdown length in seconds. */
  durationSec: number;
  /** epoch-ms the countdown ends at; null while paused/unstarted. */
  endsAt: number | null;
  /** Remaining ms while paused; null while running. */
  pausedRemainingMs: number | null;
};

export const emptyStopwatch = (): StopwatchState => ({ startedAt: null, accumulatedMs: 0 });
export const emptyTimer = (durationSec = 60): TimerState => ({
  durationSec,
  endsAt: null,
  pausedRemainingMs: null,
});

export function stopwatchElapsedMs(s: StopwatchState, now = Date.now()): number {
  const live = s.startedAt != null ? Math.max(0, now - s.startedAt) : 0;
  return Math.max(0, s.accumulatedMs + live);
}

export function stopwatchRunning(s: StopwatchState): boolean {
  return s.startedAt != null;
}

export function startStopwatch(s: StopwatchState, now = Date.now()): StopwatchState {
  if (s.startedAt != null) return s;
  return { startedAt: now, accumulatedMs: s.accumulatedMs };
}

export function pauseStopwatch(s: StopwatchState, now = Date.now()): StopwatchState {
  if (s.startedAt == null) return s;
  return { startedAt: null, accumulatedMs: stopwatchElapsedMs(s, now) };
}

export function timerRemainingMs(t: TimerState, now = Date.now()): number {
  if (t.endsAt != null) return Math.max(0, t.endsAt - now);
  if (t.pausedRemainingMs != null) return Math.max(0, t.pausedRemainingMs);
  return t.durationSec * 1000;
}

export function timerRunning(t: TimerState, now = Date.now()): boolean {
  return t.endsAt != null && t.endsAt > now;
}

export function timerDone(t: TimerState, now = Date.now()): boolean {
  return t.endsAt != null && t.endsAt <= now;
}

export function startTimer(t: TimerState, now = Date.now()): TimerState {
  const remaining = timerRemainingMs(t, now);
  if (remaining <= 0) return t;
  return { durationSec: t.durationSec, endsAt: now + remaining, pausedRemainingMs: null };
}

export function pauseTimer(t: TimerState, now = Date.now()): TimerState {
  if (t.endsAt == null) return t;
  return { durationSec: t.durationSec, endsAt: null, pausedRemainingMs: timerRemainingMs(t, now) };
}

export function resetTimer(t: TimerState, durationSec = t.durationSec): TimerState {
  return emptyTimer(durationSec);
}

export function addTimerSeconds(t: TimerState, seconds: number, now = Date.now()): TimerState {
  const add = seconds * 1000;
  if (t.endsAt != null) {
    return {
      durationSec: t.durationSec + seconds,
      endsAt: Math.max(now, t.endsAt) + add,
      pausedRemainingMs: null,
    };
  }
  return {
    durationSec: t.durationSec + seconds,
    endsAt: null,
    pausedRemainingMs: Math.max(0, timerRemainingMs(t, now) + add),
  };
}

/** "03:42" / "1:02:03" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}

export function tallyIncrement(value: number): number {
  return Math.max(0, value + 1);
}
export function tallyDecrement(value: number): number {
  return Math.max(0, value - 1);
}
