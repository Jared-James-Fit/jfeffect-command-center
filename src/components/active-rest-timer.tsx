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
 */

type RestTimerArgs = {
  exerciseName: string;
  setIndex: number;
  /** Effective rest seconds (override > programmed > category default). May be null. */
  seconds: number | null;
  category: ExerciseCategory;
  /** Stable key so re-firing the same set does not restart the timer. */
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

export function ActiveRestTimerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    exerciseName: string;
    setIndex: number;
    seconds: number;
    category: ExerciseCategory;
    startedAt: number;
    paused: boolean;
    /** Frozen remaining when paused. */
    remainingAtPause: number | null;
    signalKey: string;
  } | null>(null);
  const [tick, setTick] = useState(0);
  const lastSignal = useRef<string | null>(null);

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
  }, []);

  const dismissRestTimer = useCallback(() => setState(null), []);

  // 1Hz ticker — only while running.
  useEffect(() => {
    if (!state || state.paused) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state?.paused, state?.startedAt, state == null]);

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