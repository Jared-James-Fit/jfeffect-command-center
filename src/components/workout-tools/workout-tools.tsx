/**
 * Generic client Workout Tools — Tally / Stopwatch / Timer.
 *
 * Deliberately isolated from the prescribed Rest timer
 * (`RestTimerButton` + `ActiveRestTimerProvider`): separate provider,
 * separate storage namespace (`jf.workout-tools.*`), no shared hooks. These
 * tools are scratchpad aids only — they never write workout data, results,
 * completion, PRs or analytics.
 *
 * State lives at the WorkoutDayView level (one provider per open workout),
 * survives a brief refresh through sessionStorage, and is dropped when the
 * workout view unmounts for a different day.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Minus, Plus, RotateCcw, Play, Pause, Timer as TimerIcon, Hash, Wrench, ChevronDown } from "lucide-react";
import {
  type StopwatchState,
  type TimerState,
  emptyStopwatch,
  emptyTimer,
  formatClock,
  pauseStopwatch,
  pauseTimer,
  startStopwatch,
  startTimer,
  stopwatchElapsedMs,
  stopwatchRunning,
  tallyDecrement,
  tallyIncrement,
  timerDone,
  timerRemainingMs,
  timerRunning,
  addTimerSeconds,
} from "@/lib/workout-tools/timing";

type ToolKey = "tally" | "stopwatch" | "timer";
type View = ToolKey | "picker" | null;

type ToolsState = {
  tally: number;
  stopwatch: StopwatchState;
  timer: TimerState;
};

const initialState = (): ToolsState => ({
  tally: 0,
  stopwatch: emptyStopwatch(),
  timer: emptyTimer(60),
});

type Ctx = {
  open: (context?: string | null) => void;
  hasActive: boolean;
};

const WorkoutToolsContext = React.createContext<Ctx | null>(null);

export function useWorkoutTools(): Ctx | null {
  return React.useContext(WorkoutToolsContext);
}

function storageKey(scopeKey: string) {
  return `jf.workout-tools.${scopeKey}`;
}

function readState(scopeKey: string): ToolsState {
  if (typeof window === "undefined") return initialState();
  try {
    const raw = window.sessionStorage.getItem(storageKey(scopeKey));
    if (!raw) return initialState();
    const p = JSON.parse(raw);
    return {
      tally: typeof p?.tally === "number" ? Math.max(0, p.tally) : 0,
      stopwatch:
        p?.stopwatch && typeof p.stopwatch.accumulatedMs === "number"
          ? { startedAt: typeof p.stopwatch.startedAt === "number" ? p.stopwatch.startedAt : null, accumulatedMs: p.stopwatch.accumulatedMs }
          : emptyStopwatch(),
      timer:
        p?.timer && typeof p.timer.durationSec === "number"
          ? {
              durationSec: p.timer.durationSec,
              endsAt: typeof p.timer.endsAt === "number" ? p.timer.endsAt : null,
              pausedRemainingMs: typeof p.timer.pausedRemainingMs === "number" ? p.timer.pausedRemainingMs : null,
            }
          : emptyTimer(60),
    };
  } catch {
    return initialState();
  }
}

function isToolActive(s: ToolsState, now: number) {
  return {
    tally: s.tally > 0,
    stopwatch: stopwatchRunning(s.stopwatch) || stopwatchElapsedMs(s.stopwatch, now) > 0,
    timer: s.timer.endsAt != null || s.timer.pausedRemainingMs != null,
  };
}

/** Which single tool the floating pill should represent. */
export function pillTool(s: ToolsState, now = Date.now()): ToolKey | null {
  if (timerRunning(s.timer, now)) return "timer";
  if (stopwatchRunning(s.stopwatch)) return "stopwatch";
  const active = isToolActive(s, now);
  if (active.timer) return "timer";
  if (active.stopwatch) return "stopwatch";
  if (active.tally) return "tally";
  return null;
}

function safeVibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

export function WorkoutToolsProvider({ scopeKey, children }: { scopeKey: string; children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [state, setState] = React.useState<ToolsState>(() => initialState());
  const [view, setView] = React.useState<View>(null);
  const [context, setContext] = React.useState<string | null>(null);
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);
  const doneFiredRef = React.useRef(false);

  // Hydrate after mount (sessionStorage is client-only; avoids SSR mismatch).
  React.useEffect(() => {
    setState(readState(scopeKey));
    setView(null);
  }, [scopeKey]);

  // Persist for brief refresh / foreground survival only.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(storageKey(scopeKey), JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [scopeKey, state]);

  const running = stopwatchRunning(state.stopwatch) || timerRunning(state.timer);

  // 1 Hz repaint only while something is running; all values are recomputed
  // from timestamps so drift is impossible.
  React.useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => forceTick(), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  // Recompute immediately when the tab returns to the foreground.
  React.useEffect(() => {
    const onVis = () => forceTick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  const now = Date.now();
  const timerIsDone = timerDone(state.timer, now);
  React.useEffect(() => {
    if (timerIsDone && !doneFiredRef.current) {
      doneFiredRef.current = true;
      safeVibrate([30, 80, 30]);
    }
    if (!timerIsDone) doneFiredRef.current = false;
  }, [timerIsDone]);

  const ctx = React.useMemo<Ctx>(
    () => ({
      open: (label?: string | null) => {
        setContext(label ?? null);
        setView("picker");
      },
      hasActive: pillTool(state, now) != null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, now],
  );

  const pill = pillTool(state, now);
  const showPill = pill != null && view === null;

  const pillLabel =
    pill === "tally"
      ? `Tally · ${state.tally}`
      : pill === "stopwatch"
        ? `⏱ ${formatClock(stopwatchElapsedMs(state.stopwatch, now))}`
        : pill === "timer"
          ? `Timer ${formatClock(timerRemainingMs(state.timer, now))}`
          : "";

  const body = (
    <ToolsBody
      view={view}
      setView={setView}
      state={state}
      setState={setState}
      context={context}
      onClose={() => setView(null)}
    />
  );

  return (
    <WorkoutToolsContext.Provider value={ctx}>
      {children}

      {isMobile ? (
        <Sheet open={view != null} onOpenChange={(o) => !o && setView(null)}>
          <SheetContent side="bottom" className="rounded-t-2xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
            <SheetHeader className="text-left">
              <SheetTitle className="text-base">Workout Tools</SheetTitle>
            </SheetHeader>
            {body}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={view != null} onOpenChange={(o) => !o && setView(null)}>
          <DialogContent className="max-w-xs p-4">
            <DialogHeader>
              <DialogTitle className="text-base">Workout Tools</DialogTitle>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      )}

      {showPill && (
        <button
          type="button"
          aria-label={`Reopen Workout Tools (${pillLabel})`}
          onClick={() => setView(pill)}
          className="fixed left-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-bold shadow-lg backdrop-blur transition hover:bg-accent"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
        >
          {pillLabel}
        </button>
      )}
    </WorkoutToolsContext.Provider>
  );
}

function ToolsBody({
  view,
  setView,
  state,
  setState,
  context,
  onClose,
}: {
  view: View;
  setView: (v: View) => void;
  state: ToolsState;
  setState: React.Dispatch<React.SetStateAction<ToolsState>>;
  context: string | null;
  onClose: () => void;
}) {
  if (view === "picker" || view == null) {
    return (
      <div className="mt-2 space-y-2">
        {context && <div className="text-xs font-medium text-muted-foreground">{context}</div>}
        <PickerRow
          icon={<Hash className="h-4 w-4" />}
          title="Tally"
          desc="Count sets, reps, rounds or anything else."
          ariaLabel="Open Tally"
          onClick={() => setView("tally")}
        />
        <PickerRow
          icon={<Play className="h-4 w-4" />}
          title="Stopwatch"
          desc="Count time up."
          ariaLabel="Start Stopwatch"
          onClick={() => setView("stopwatch")}
        />
        <PickerRow
          icon={<TimerIcon className="h-4 w-4" />}
          title="Timer"
          desc="Set a countdown."
          ariaLabel="Start Timer"
          onClick={() => setView("timer")}
        />
      </div>
    );
  }

  if (view === "tally") {
    return (
      <TallyPanel
        context={context}
        value={state.tally}
        onChange={(v) => setState((s) => ({ ...s, tally: v }))}
        onMinimize={onClose}
        onClose={onClose}
      />
    );
  }

  if (view === "stopwatch") {
    return (
      <StopwatchPanel
        context={context}
        value={state.stopwatch}
        onChange={(v) => setState((s) => ({ ...s, stopwatch: v }))}
        onMinimize={onClose}
      />
    );
  }

  return (
    <TimerPanel
      context={context}
      value={state.timer}
      onChange={(v) => setState((s) => ({ ...s, timer: v }))}
      onMinimize={onClose}
    />
  );
}

function PickerRow({
  icon,
  title,
  desc,
  ariaLabel,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition hover:bg-accent"
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

function PanelShell({ context, children }: { context: string | null; children: React.ReactNode }) {
  return (
    <div className="mt-2 space-y-3">
      {context && <div className="text-xs font-medium text-muted-foreground">{context}</div>}
      {children}
    </div>
  );
}

function TallyPanel({
  context,
  value,
  onChange,
  onMinimize,
  onClose,
}: {
  context: string | null;
  value: number;
  onChange: (v: number) => void;
  onMinimize: () => void;
  onClose: () => void;
}) {
  return (
    <PanelShell context={context}>
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="Decrease tally"
          className="h-12 w-12 rounded-full"
          disabled={value <= 0}
          onClick={() => onChange(tallyDecrement(value))}
        >
          <Minus className="h-5 w-5" />
        </Button>
        <div aria-live="polite" className="text-4xl font-black tabular-nums">
          {value}
        </div>
        <Button
          size="icon"
          aria-label="Increase tally"
          className="h-14 w-14 rounded-full"
          onClick={() => onChange(tallyIncrement(value))}
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>
      <div className="text-xs text-muted-foreground">Tap + each time you want to count something.</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" aria-label="Reset tally" onClick={() => onChange(0)}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
        </Button>
        <Button size="sm" variant="outline" aria-label="Minimize Tally" onClick={onMinimize}>
          <ChevronDown className="mr-1 h-3.5 w-3.5" /> Minimize
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Close Tally"
          onClick={() => {
            onChange(0);
            onClose();
          }}
        >
          Close
        </Button>
      </div>
    </PanelShell>
  );
}

function StopwatchPanel({
  context,
  value,
  onChange,
  onMinimize,
}: {
  context: string | null;
  value: StopwatchState;
  onChange: (v: StopwatchState) => void;
  onMinimize: () => void;
}) {
  const running = stopwatchRunning(value);
  const elapsed = stopwatchElapsedMs(value);
  return (
    <PanelShell context={context}>
      <div aria-live="polite" className="text-center text-4xl font-black tabular-nums">
        {formatClock(elapsed)}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {running ? (
          <Button size="sm" aria-label="Pause Stopwatch" onClick={() => onChange(pauseStopwatch(value))}>
            <Pause className="mr-1 h-3.5 w-3.5" /> Pause
          </Button>
        ) : (
          <Button size="sm" aria-label={elapsed > 0 ? "Resume Stopwatch" : "Start Stopwatch"} onClick={() => onChange(startStopwatch(value))}>
            <Play className="mr-1 h-3.5 w-3.5" /> {elapsed > 0 ? "Resume" : "Start"}
          </Button>
        )}
        <Button size="sm" variant="outline" aria-label="Reset Stopwatch" onClick={() => onChange(emptyStopwatch())}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
        </Button>
        <Button size="sm" variant="outline" aria-label="Minimize Stopwatch" onClick={onMinimize}>
          <ChevronDown className="mr-1 h-3.5 w-3.5" /> Minimize
        </Button>
      </div>
    </PanelShell>
  );
}

const PRESETS = [
  { label: "30 sec", sec: 30 },
  { label: "1 min", sec: 60 },
  { label: "2 min", sec: 120 },
  { label: "3 min", sec: 180 },
  { label: "5 min", sec: 300 },
];

function TimerPanel({
  context,
  value,
  onChange,
  onMinimize,
}: {
  context: string | null;
  value: TimerState;
  onChange: (v: TimerState) => void;
  onMinimize: () => void;
}) {
  const running = timerRunning(value);
  const done = timerDone(value);
  const remaining = timerRemainingMs(value);
  const mins = Math.floor(value.durationSec / 60);
  const secs = value.durationSec % 60;

  const setDuration = (totalSec: number) => onChange(emptyTimer(Math.max(0, Math.min(3600, totalSec))));

  return (
    <PanelShell context={context}>
      <div
        aria-live="polite"
        className={cn("text-center text-4xl font-black tabular-nums", done && "text-primary")}
      >
        {done ? "Done" : formatClock(remaining)}
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {PRESETS.map((p) => (
          <Button
            key={p.sec}
            size="sm"
            variant={value.durationSec === p.sec ? "default" : "outline"}
            aria-label={`Set timer to ${p.label}`}
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={() => setDuration(p.sec)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
        <StepField label="Custom minutes" short="min" value={mins} step={1} max={60} onChange={(m) => setDuration(m * 60 + secs)} />
        <StepField label="Custom seconds" short="sec" value={secs} step={5} max={55} onChange={(s) => setDuration(mins * 60 + s)} />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {running ? (
          <Button size="sm" aria-label="Pause Timer" onClick={() => onChange(pauseTimer(value))}>
            <Pause className="mr-1 h-3.5 w-3.5" /> Pause
          </Button>
        ) : (
          <Button
            size="sm"
            aria-label={value.pausedRemainingMs != null ? "Resume Timer" : "Start Timer"}
            disabled={value.durationSec <= 0 || done}
            onClick={() => onChange(startTimer(value))}
          >
            <Play className="mr-1 h-3.5 w-3.5" /> {value.pausedRemainingMs != null ? "Resume" : "Start"}
          </Button>
        )}
        <Button size="sm" variant="outline" aria-label="Add 30 seconds to Timer" onClick={() => onChange(addTimerSeconds(value, 30))}>
          +30
        </Button>
        <Button size="sm" variant="outline" aria-label="Reset Timer" onClick={() => onChange(emptyTimer(value.durationSec))}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
        </Button>
        <Button size="sm" variant="outline" aria-label="Minimize Timer" onClick={onMinimize}>
          <ChevronDown className="mr-1 h-3.5 w-3.5" /> Minimize
        </Button>
      </div>
    </PanelShell>
  );
}

function StepField({
  label,
  short,
  value,
  step,
  max,
  onChange,
}: {
  label: string;
  short: string;
  value: number;
  step: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="outline"
        className="h-7 w-7"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(0, value - step))}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <span className="w-10 text-center text-xs font-bold tabular-nums text-foreground">
        {value} {short}
      </span>
      <Button
        size="icon"
        variant="outline"
        className="h-7 w-7"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}

/** Small secondary-row entry point rendered on each active client exercise card. */
export function WorkoutToolsButton({ context, className }: { context?: string | null; className?: string }) {
  const tools = useWorkoutTools();
  if (!tools) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      aria-label="Open Workout Tools"
      onClick={() => tools.open(context ?? null)}
      className={cn("h-7 rounded-full px-2.5 text-xs", className)}
    >
      <Wrench className="mr-1 h-3 w-3" /> Tools
      {tools.hasActive && <span aria-hidden className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />}
    </Button>
  );
}
