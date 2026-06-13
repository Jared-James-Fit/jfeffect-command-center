import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play, RotateCcw, Timer, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
      {state && (
        <div
          className={cn(
            "fixed left-1/2 z-[70] -translate-x-1/2 px-2",
            // sit above mobile bottom nav (z-50) and full-screen overlay (z-60)
            "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
            "w-[min(100%-1rem,520px)]",
          )}
          role="status"
          aria-live="polite"
        >
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur",
              done && "border-primary/60 bg-primary/10",
            )}
          >
            <Timer className={cn("h-4 w-4 shrink-0", done ? "text-primary" : "text-muted-foreground")} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {state.exerciseName} · Set {state.setIndex}
              </div>
              <div className={cn("font-mono text-lg font-black tabular-nums leading-tight", done && "text-primary")}>
                {done ? "Ready" : fmt(remaining)}
              </div>
            </div>
            <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => addTime(-15)} aria-label="Subtract 15 seconds">
              −15s
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => addTime(15)} aria-label="Add 15 seconds">
              <Plus className="h-3.5 w-3.5" />15
            </Button>
            {!done && (
              state.paused ? (
                <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={resume} aria-label="Resume">
                  <Play className="h-4 w-4" />
                </Button>
              ) : (
                <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={pause} aria-label="Pause">
                  <Pause className="h-4 w-4" />
                </Button>
              )
            )}
            <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={reset} aria-label="Reset">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={dismissRestTimer} aria-label="Dismiss timer">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </RestTimerContext.Provider>
  );
}