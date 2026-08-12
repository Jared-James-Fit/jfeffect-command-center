/**
 * Timestamp-based rest timer store.
 *
 * Previous model: each RestTimerButton kept a `remaining` number in React
 * state and decremented it once per second with setInterval. Backgrounding
 * the app (tab hidden, phone locked, PWA switched out) throttles or halts
 * those intervals, so the countdown froze and resumed where it left off.
 *
 * New model: one active rest timer per workout scope, persisted to
 * localStorage as absolute timestamps:
 *   { timerId, startedAt, durationSeconds, endsAt, pausedRemainingMs }
 * Remaining time is always `endsAt - Date.now()`, so any return path
 * (visibilitychange, focus, remount, reload) recomputes the truth.
 *
 * Scope keys embed the workout/day id (which is per client), so timer state
 * never leaks between workouts or clients. Only one timer runs at a time per
 * scope: starting a new one replaces the old.
 */

export type RestTimerState = {
  /** Exercise row / set id this timer belongs to. */
  timerId: string;
  startedAt: number;
  durationSeconds: number;
  /** Absolute completion time. */
  endsAt: number;
  /** Non-null while paused: milliseconds left when paused. */
  pausedRemainingMs: number | null;
};

const PREFIX = "jf:rest-timer:";
/** Finished timers older than this are dropped instead of restored. */
export const REST_STALE_MS = 60 * 60 * 1000;

function storageKey(scopeKey: string) {
  return `${PREFIX}${scopeKey}`;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function emit(scopeKey: string) {
  listeners.get(scopeKey)?.forEach((l) => {
    try { l(); } catch { /* no-op */ }
  });
}

export function subscribeRestTimer(scopeKey: string, listener: Listener): () => void {
  let set = listeners.get(scopeKey);
  if (!set) { set = new Set(); listeners.set(scopeKey, set); }
  set.add(listener);
  return () => { set!.delete(listener); };
}

export function readRestTimer(scopeKey: string | null | undefined): RestTimerState | null {
  if (!scopeKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scopeKey));
    if (!raw) return null;
    const p = JSON.parse(raw);
    const endsAt = Number(p?.endsAt);
    const startedAt = Number(p?.startedAt);
    const durationSeconds = Number(p?.durationSeconds);
    if (!p?.timerId || !Number.isFinite(endsAt) || !Number.isFinite(startedAt)) return null;
    const state: RestTimerState = {
      timerId: String(p.timerId),
      startedAt,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
      endsAt,
      pausedRemainingMs:
        p?.pausedRemainingMs != null && Number.isFinite(Number(p.pausedRemainingMs))
          ? Number(p.pausedRemainingMs)
          : null,
    };
    // Drop long-finished timers so a next-day visit doesn't show "finished".
    if (state.pausedRemainingMs == null && Date.now() - state.endsAt > REST_STALE_MS) {
      clearRestTimer(scopeKey);
      return null;
    }
    return state;
  } catch { return null; }
}

function write(scopeKey: string, state: RestTimerState | null) {
  if (typeof window === "undefined") return;
  try {
    if (state) window.localStorage.setItem(storageKey(scopeKey), JSON.stringify(state));
    else window.localStorage.removeItem(storageKey(scopeKey));
  } catch { /* quota / private mode */ }
  emit(scopeKey);
}

/** Start (or replace) the single active rest timer for this scope. */
export function startRestTimer(
  scopeKey: string,
  timerId: string,
  durationSeconds: number,
  at: number = Date.now(),
): RestTimerState | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  const state: RestTimerState = {
    timerId,
    startedAt: at,
    durationSeconds,
    endsAt: at + durationSeconds * 1000,
    pausedRemainingMs: null,
  };
  write(scopeKey, state);
  return state;
}

export function pauseRestTimer(scopeKey: string, at: number = Date.now()): RestTimerState | null {
  const s = readRestTimer(scopeKey);
  if (!s || s.pausedRemainingMs != null) return s;
  const next: RestTimerState = { ...s, pausedRemainingMs: Math.max(0, s.endsAt - at) };
  write(scopeKey, next);
  return next;
}

export function resumeRestTimer(scopeKey: string, at: number = Date.now()): RestTimerState | null {
  const s = readRestTimer(scopeKey);
  if (!s || s.pausedRemainingMs == null) return s;
  const next: RestTimerState = { ...s, endsAt: at + s.pausedRemainingMs, pausedRemainingMs: null };
  write(scopeKey, next);
  return next;
}

export function clearRestTimer(scopeKey: string | null | undefined) {
  if (!scopeKey || typeof window === "undefined") return;
  try { window.localStorage.removeItem(storageKey(scopeKey)); } catch { /* ignore */ }
  emit(scopeKey);
}

/** Milliseconds left; 0 once finished. */
export function restRemainingMs(s: RestTimerState, now: number = Date.now()): number {
  if (s.pausedRemainingMs != null) return Math.max(0, s.pausedRemainingMs);
  return Math.max(0, s.endsAt - now);
}

export function restFinished(s: RestTimerState, now: number = Date.now()): boolean {
  return s.pausedRemainingMs == null && now >= s.endsAt;
}

export function formatClock(totalSeconds: number): string {
  const t = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** "1:15 ago" style suffix for a timer that finished while the app was away. */
export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${formatClock(s)} ago`;
}
