import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { defaultRestRange, type ExerciseCategory } from "@/lib/exercise-metadata";

/**
 * Single active rest timer.
 *
 * Replaces the per-card timer pattern. The provider owns one timer at a
 * time. When a set is marked complete the page calls `startRestTimer(...)`
 * which replaces whatever timer was running. A floating bar renders at the
 * bottom of the viewport (inside the focus-mode overlay too) and stays
 * usable on mobile, tablet, desktop.
 *
 * ROOT CAUSE FIX 2026-06-26: Timer state is now persisted to localStorage
 * so it survives app backgrounding, page navigation, and PWA restarts.
 * The timer uses wall-clock time (Date.now() - startedAt) so it continues
 * correctly even when the app is suspended by iOS.
 */

const LS_KEY = "jfeffect:rest-timer-state";

type RestTimerArgs = {
  exerciseName: string;
  setIndex: number;
  /** Effective rest seconds (override > programmed > category default). May be null. */
  seconds: number | null;
  category: ExerciseCategory;
  /** Stable key so re-firing the same set does not restart the timer. */
  signalKey: string;
};

type TimerState = {
  exerciseName: string;
  setIndex: number;
  seconds: number;
  category: ExerciseCategory;
  startedAt: number;
  paused: boolean;
  /** Frozen remaining when paused. */
  remainingAtPause: number | null;
  signalKey: string;
};

type Ctx = {
  startRestTimer: (args: RestTimerArgs) => void;
  dismissRestTimer: () => void;
  active: { exerciseName: string; setIndex: number } | null;
};

const RestTimerContext = createContext<Ctx | null>(null);

export function useRestTimer() {
  const v = useContext(RestTimerContext);
  if (!v) throw new Error("useRestTimer must be used inside <ActiveRestTimerProvider>");
  return v;
}

function loadFromStorage(): TimerState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimerState;
    // Discard stale timers: if the timer would have finished more than 5 minutes
    // ago, don't restore it (it's irrelevant).
    const elapsed = Math.floor((Date.now() - parsed.startedAt) / 1000);
    if (!parsed.paused && elapsed > parsed.seconds + 300) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(state: TimerState | null) {
  try {
    if (state == null) {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }
  } catch {
    // localStorage unavailable (private browsing, storage full) — ignore
  }
}

export function ActiveRestTimerProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<TimerState | null>(() => loadFromStorage());
  const [tick, setTick] = useState(0);
  const lastSignal = useRef<string | null>(state?.signalKey ?? null);

  // Wrap setState to also persist to localStorage
  const setState = useCallback((next: TimerState | null | ((prev: TimerState | null) => TimerState | null)) => {
    setStateRaw((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      saveToStorage(resolved);
      return resolved;
    });
  }, []);

  const startRestTimer = useCallback((args: RestTimerArgs) => {
    if (lastSignal.current === args.signalKey) return; // dedupe identical completions
    lastSignal.current = args.signalKey;
    const seconds = args.seconds != null && args.seconds > 0
      ? args.seconds
      : defaultRestRange(args.category).suggested;
    setState({
      exerciseName: args.exerciseName,
      setIndex: args.setIndex,
      seconds,
      category: args.category,
      startedAt: Date.now(),
      paused: false,
      remainingAtPause: null,
      signalKey: args.signalKey,
    });
  }, [setState]);

  const dismissRestTimer = useCallback(() => setState(null), [setState]);

  // 1Hz ticker — only while running.
  useEffect(() => {
    if (!state || state.paused) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state?.paused, state?.startedAt, state == null]);

  // Re-check remaining on visibility change (app returning from background)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setTick((t) => t + 1); // force re-render to recalculate elapsed
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const remaining = (() => {
    if (!state) return 0;
    if (state.paused && state.remainingAtPause != null) return state.remainingAtPause;
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    return Math.max(0, state.seconds - elapsed);
  })();
  void tick; // dep

  const done = state != null && remaining <= 0;

  const pause = () => {
    if (!state) return;
    setState({ ...state, paused: true, remainingAtPause: remaining });
  };
  const resume = () => {
    if (!state) return;
    const rem = state.remainingAtPause ?? remaining;
    setState({ ...state, paused: false, startedAt: Date.now() - (state.seconds - rem) * 1000, remainingAtPause: null });
  };
  const reset = () => {
    if (!state) return;
    setState({ ...state, paused: false, startedAt: Date.now(), remainingAtPause: null });
  };
  const addTime = (delta: number) => {
    if (!state) return;
    if (state.paused) {
      setState({ ...state, remainingAtPause: Math.max(0, (state.remainingAtPause ?? remaining) + delta) });
    } else {
      setState({ ...state, seconds: state.seconds + delta });
    }
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <RestTimerContext.Provider
      value={{
        startRestTimer,
        dismissRestTimer,
        active: state ? { exerciseName: state.exerciseName, setIndex: state.setIndex } : null,
      }}
    >
      {children}
    </RestTimerContext.Provider>
  );
}
