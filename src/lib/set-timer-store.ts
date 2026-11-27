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

// `useSyncExternalStore` requires getSnapshot to return the exact same
// reference until the underlying store changes. Parsing localStorage on every
// read creates a fresh object even when the timer has not changed, which React
// treats as a new snapshot and can escalate into a maximum-update-depth loop.
// Cache snapshots by their raw persisted value so every SetTimerInput sees a
// stable identity between storage events.
const snapshotCache = new Map<string, { raw: string | null; value: SetTimerState | null }>();

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
  const cached = snapshotCache.get(key);
  if (cached?.raw === raw) return cached.value;

  let value: SetTimerState | null = null;
  if (raw) {
    try {
      const p = JSON.parse(raw) as SetTimerState;
      value = typeof p?.target === "number" ? p : null;
    } catch {
      value = null;
    }
  }

  snapshotCache.set(key, { raw, value });
  return value;
}

function writeTimer(key: string, state: SetTimerState | null) {
  const raw = state ? JSON.stringify(state) : null;
  safeSet(KEY(key), raw);
  snapshotCache.set(key, { raw, value: state });
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
/** 90 → "1:30", an hour and more as h:mm:ss (a long run: 6330 → "1:45:30"). */
export function fmtMMSS(total: number): string {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

/** Forgiving MM:SS / H:MM:SS / seconds parser: "45" → 45, "1:30" → 90, "90" → 90, "1:45:30" → 6330. */
export function parseMMSS(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.includes(":")) {
    const parts = t.split(":").map((p) => Number(p.replace(/[^\d]/g, "") || 0));
    const [h, mm, ss] = parts.length >= 3 ? parts.slice(-3) : [0, parts[0], parts[1]];
    const total = h * 3600 + mm * 60 + ss;
    return total > 0 ? Math.round(total) : null;
  }
  const n = Number(t.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** Cardio-only numeric shorthand: 25 = 25 min, 430 = 4:30, 10000 = 1:00:00.
 * Explicit colon input is also accepted (paste); short strength timers keep parseMMSS.
 */
export function parseCardioDuration(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,6}$/.test(t) && !/^(?:\d{0,4}:\d{0,2}|\d{1,2}:\d{0,2}:\d{0,2})$/.test(t)) return null;
  let h = 0, m = 0, s = 0;
  if (t.includes(":")) {
    const parts = t.split(":").map(Number);
    if (parts.length === 3) [h, m, s] = parts;
    else [m, s] = parts;
    if (parts.length === 3 && m >= 60) return null;
  } else if (t.length <= 2) {
    m = Number(t);
  } else {
    s = Number(t.slice(-2));
    m = Number(t.slice(-4, -2));
    if (t.length > 4) {
      h = Number(t.slice(0, -4));
      if (m >= 60) return null;
    }
  }
  const total = h * 3600 + m * 60 + s;
  return s < 60 && total > 0 && total <= 359999 ? total : null;
}

/** Editing uses total minutes and a fixed separator; final display uses H:MM:SS when needed. */
export function cardioMinutesDraft(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Preserve a typed separator, or format a whole replacement/paste without one. */
export function cardioDurationDraft(raw: string, previous: string): string {
  if (!/^[\d:]*$/.test(raw) || raw.length > 12) return previous;
  if (!raw) return "0:00";
  if (raw.includes(":")) return raw;
  // A backspace over the separator must not reinterpret the entire duration.
  if (previous.includes(":") && raw === previous.replace(/:/g, "")) return previous;
  const parsed = parseCardioDuration(raw);
  return parsed == null ? raw : cardioMinutesDraft(parsed);
}
