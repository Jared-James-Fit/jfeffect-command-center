/**
 * Per-set countdown timer state (device-local, timestamp-based).
 *
 * The timer is derived from absolute timestamps so it keeps counting while the
 * app is backgrounded, and only ONE set timer may run at a time (starting a new
 * one pauses the previous). Completely independent of the Rest timer.
 */

export type SetTimerState = {
  /** Current target in seconds (client-adjustable, never mutates the prescription). */
  target: number;
  /** Absolute epoch-ms the countdown ends at; null when not running. */
  endsAt: number | null;
  /** Remaining seconds while paused; null when running or unstarted. */
  pausedRemaining: number | null;
};

const KEY = (k: string) => `jf.settimer.${k}`;
const ACTIVE_KEY = "jf.settimer.active";
export const SET_TIMER_EVENT = "jf-set-timer";

function safeGet(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function emit() {
  try {
    window.dispatchEvent(new CustomEvent(SET_TIMER_EVENT));
  } catch {
    /* ignore */
  }
}

export function readTimer(key: string): SetTimerState | null {
  const raw = safeGet(KEY(key));
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as SetTimerState;
    if (typeof p?.target !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

function writeTimer(key: string, state: SetTimerState | null) {
  safeSet(KEY(key), state ? JSON.stringify(state) : null);
  emit();
}

/** Seconds left right now (0 when finished, target when unstarted). */
export function remainingSeconds(state: SetTimerState | null, fallbackTarget: number): number {
  if (!state) return fallbackTarget;
  if (state.endsAt != null) return Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
  if (state.pausedRemaining != null) return Math.max(0, state.pausedRemaining);
  return state.target;
}

export function isRunning(state: SetTimerState | null): boolean {
  return !!state && state.endsAt != null && state.endsAt > Date.now();
}
export function isPaused(state: SetTimerState | null): boolean {
  return !!state && state.endsAt == null && state.pausedRemaining != null;
}
export function isFinished(state: SetTimerState | null): boolean {
  return !!state && state.endsAt != null && state.endsAt <= Date.now();
}

/** Pause whichever timer is currently active (if it isn't `keep`). */
function pauseActiveExcept(keep: string) {
  const active = safeGet(ACTIVE_KEY);
  if (!active || active === keep) return;
  const st = readTimer(active);
  if (st && st.endsAt != null) {
    safeSet(
      KEY(active),
      JSON.stringify({
        target: st.target,
        endsAt: null,
        pausedRemaining: remainingSeconds(st, st.target),
      } satisfies SetTimerState),
    );
  }
}

export function startTimer(key: string, target: number) {
  const existing = readTimer(key);
  const remaining =
    existing && existing.pausedRemaining != null && existing.target === target
      ? existing.pausedRemaining
      : target;
  pauseActiveExcept(key);
  safeSet(ACTIVE_KEY, key);
  writeTimer(key, { target, endsAt: Date.now() + remaining * 1000, pausedRemaining: null });
}

export function pauseTimer(key: string) {
  const st = readTimer(key);
  if (!st) return;
  writeTimer(key, {
    target: st.target,
    endsAt: null,
    pausedRemaining: remainingSeconds(st, st.target),
  });
}

export function resetTimer(key: string, target: number) {
  writeTimer(key, { target, endsAt: null, pausedRemaining: null });
}

export function setTarget(key: string, target: number) {
  writeTimer(key, { target, endsAt: null, pausedRemaining: null });
}

export function clearTimer(key: string) {
  writeTimer(key, null);
}

export function subscribeTimers(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => fn();
  window.addEventListener(SET_TIMER_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(SET_TIMER_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** "1:05" / "0:45" */
export function fmtMMSS(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Forgiving MM:SS / seconds parser: "45" → 45, "1:30" → 90, "90" → 90. */
export function parseMMSS(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const mm = Number(m.replace(/[^\d]/g, "") || 0);
    const ss = Number(s.replace(/[^\d]/g, "") || 0);
    const total = mm * 60 + ss;
    return total > 0 ? Math.round(total) : null;
  }
  const n = Number(t.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}
