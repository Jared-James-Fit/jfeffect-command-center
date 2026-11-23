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

/**
 * Moves the rest by `deltaSeconds` (the line's −15 / +15): a running rest
 * ends later or sooner, a paused one keeps more or less, a finished one starts
 * again with the time added. Never below zero, never past an hour.
 */
export function adjustRestTimer(scopeKey: string, deltaSeconds: number, at: number = Date.now()): RestTimerState | null {
  const s = readRestTimer(scopeKey);
  if (!s || !deltaSeconds) return s;
  const delta = deltaSeconds * 1000;
  const cap = REST_MAX_SECONDS * 1000;
  let next: RestTimerState;
  if (s.pausedRemainingMs != null) {
    const left = Math.min(cap, Math.max(0, s.pausedRemainingMs + delta));
    next = { ...s, pausedRemainingMs: left, durationSeconds: Math.max(1, Math.round(s.durationSeconds + deltaSeconds)) };
  } else if (at >= s.endsAt) {
    if (delta <= 0) return s;
    next = { ...s, startedAt: at, durationSeconds: deltaSeconds, endsAt: at + Math.min(cap, delta) };
  } else {
    const endsAt = Math.min(at + cap, Math.max(at, s.endsAt + delta));
    next = { ...s, endsAt, durationSeconds: Math.max(1, Math.round((endsAt - s.startedAt) / 1000)) };
  }
  write(scopeKey, next);
  return next;
}

/** The longest a rest can be set to with −15 / +15 (and the most a stale one counts). */
export const REST_MAX_SECONDS = 60 * 60;

/** How much the line's − / + move a rest. */
export const REST_STEP_SECONDS = 15;

const cued = new Set<string>();
/**
 * The end-of-rest cue (the timer's buzz and chimes) plays once per rest,
 * however many cards show it (the one it started on and the next one up) and
 * however often they remount: the first caller gets true.
 */
export function claimRestDoneCue(scopeKey: string, state: Pick<RestTimerState, "startedAt" | "endsAt">): boolean {
  const key = `${scopeKey}:${state.startedAt}:${state.endsAt}`;
  if (cued.has(key)) return false;
  cued.add(key);
  return true;
}

const AUTO_KEY = "jf-rest-autostart";
/**
 * Whether a rest starts by itself when a working set is logged (on unless the
 * athlete turned it off in a card's ⋯; this phone only).
 */
export function readRestAutoStart(): boolean {
  if (typeof window === "undefined") return true;
  try { return window.localStorage.getItem(AUTO_KEY) !== "off"; } catch { return true; }
}
export function setRestAutoStart(on: boolean): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(AUTO_KEY, on ? "on" : "off"); } catch { /* private mode */ }
  autoListeners.forEach((l) => { try { l(); } catch { /* no-op */ } });
}
const autoListeners = new Set<Listener>();
export function subscribeRestAutoStart(l: Listener): () => void {
  autoListeners.add(l);
  return () => { autoListeners.delete(l); };
}

/**
 * Which card shows a rest: the exercise it started on while it still has sets
 * to log, and once it's done, the next exercise with sets still to log too
 * (the rest is before the next set, and that's where it'll be lifted). `order`
 * is the workout's lifting cards in order, `open` true while a card has sets
 * left. Returns the row ids that show it (the owner first).
 */
export function restHosts(order: ReadonlyArray<{ id: string; open: boolean }>, ownerId: string): string[] {
  const i = order.findIndex((r) => r.id === ownerId);
  if (i < 0) return [ownerId];
  if (order[i].open) return [ownerId];
  const next = order.slice(i + 1).find((r) => r.open);
  return next ? [ownerId, next.id] : [ownerId];
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

/** "Rest 3 min", "Rest 90 s", "Rest 2:30": a card's rest in words (the logger's rest line, the coach's quick view). */
export function restWords(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const s = Math.round(seconds);
  if (s < 60) return `Rest ${s} s`;
  if (s % 60 === 0) return `Rest ${s / 60} min`;
  return `Rest ${formatClock(s)}`;
}
