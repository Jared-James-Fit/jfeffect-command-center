/**
 * Workout Tools — one sheet for the whole workout, not any one exercise:
 *
 *   Lifting math       Calculator · e1RM (rough 1-rep max)
 *   Timers & counting  Timer · Stopwatch · Tally
 *
 * Opened from the Tools button at the top of the workout (and an exercise's
 * calculator button, straight onto the Calculator in that card's unit).
 *
 * Deliberately isolated from the prescribed Rest timer
 * (`RestTimerButton` + `ActiveRestTimerProvider`): separate provider,
 * separate storage namespace (`jf.workout-tools.*`), no shared hooks. These
 * tools are scratchpad aids only — they never write workout data, results,
 * completion, PRs or analytics.
 *
 * State lives at the WorkoutDayView level (one provider per open workout),
 * timers/tally survive a brief refresh through sessionStorage, and all of it
 * is dropped when the workout view unmounts for a different day.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Calculator, ChevronDown, ChevronLeft, ChevronRight, Gauge, Hash, Minus, Pause, Play, Plus, RotateCcw, Timer as TimerIcon, Volume2, VolumeX, Watch, Wrench } from "lucide-react";
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
import { CALC_START, calcReducer } from "@/lib/calculator";
import { playAppSound } from "@/lib/app-sounds";
import { useAppSoundsOn } from "@/components/sound-toggle";
import type { WarmupUnit } from "@/lib/final-warmup";
import { CalculatorTool, E1rmTool, type E1rmPick } from "@/components/workout-tools/lifting-math";

export type ToolKey = "calc" | "e1rm" | "timer" | "stopwatch" | "tally";
type View = ToolKey | "picker" | null;

/** Plain-language names and one-line jobs — the picker and each tool's header use the same words. */
export const TOOLS: Record<ToolKey, { title: string; desc: string }> = {
  calc: { title: "Calculator", desc: "Plate math, % of a max, kg ⇄ lb" },
  e1rm: { title: "e1RM", desc: "Rough 1-rep max from weight × reps @ RPE" },
  timer: { title: "Timer", desc: "Count down an interval, hold or stretch" },
  stopwatch: { title: "Stopwatch", desc: "Time a carry, hold or cardio" },
  tally: { title: "Tally", desc: "Count reps, rounds or anything" },
};

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

export type OpenToolsOptions = { tool?: ToolKey; unit?: WarmupUnit };
type Actions = {
  open: (options?: OpenToolsOptions) => void;
  /** An exercise card reports today's best e1RM set (null = none) for the e1RM tool's one-tap picks. */
  reportE1rm: (rowId: string, pick: E1rmPick | null) => void;
};

// Two contexts: the actions never change (exercise cards use them without
// re-rendering every second while a timer runs); the status does.
const ActionsContext = React.createContext<Actions | null>(null);
const StatusContext = React.createContext<{ hasActive: boolean } | null>(null);

export function useWorkoutToolsActions(): Actions | null {
  return React.useContext(ActionsContext);
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
export function pillTool(s: ToolsState, now = Date.now()): "timer" | "stopwatch" | "tally" | null {
  if (timerRunning(s.timer, now)) return "timer";
  if (stopwatchRunning(s.stopwatch)) return "stopwatch";
  const active = isToolActive(s, now);
  if (active.timer) return "timer";
  if (active.stopwatch) return "stopwatch";
  if (active.tally) return "tally";
  return null;
}

/** What a timing tool is doing right now, for its picker row ("1:23 left"). */
export function toolStatus(tool: "timer" | "stopwatch" | "tally", s: ToolsState, now = Date.now()): string | null {
  if (tool === "tally") return s.tally > 0 ? String(s.tally) : null;
  if (tool === "stopwatch") {
    const ms = stopwatchElapsedMs(s.stopwatch, now);
    if (stopwatchRunning(s.stopwatch)) return formatClock(ms);
    return ms > 0 ? `Paused ${formatClock(ms)}` : null;
  }
  if (timerDone(s.timer, now)) return "Done";
  if (timerRunning(s.timer, now)) return `${formatClock(timerRemainingMs(s.timer, now))} left`;
  return s.timer.pausedRemainingMs != null ? `Paused ${formatClock(s.timer.pausedRemainingMs)}` : null;
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
  const [unit, setUnit] = React.useState<WarmupUnit>("lb");
  const [calc, pressCalc] = React.useReducer(calcReducer, CALC_START);
  const [picks, setPicks] = React.useState<E1rmPick[]>([]);
  // Opening e1RM again starts it fresh on today's sets.
  const [e1rmKey, setE1rmKey] = React.useState(0);
  const picksRef = React.useRef(new Map<string, E1rmPick>());
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);
  const doneFiredRef = React.useRef(false);

  // Hydrate after mount (sessionStorage is client-only; avoids SSR mismatch).
  React.useEffect(() => {
    setState(readState(scopeKey));
    setView(null);
    picksRef.current.clear();
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
      playAppSound("timer");
    }
    if (!timerIsDone) doneFiredRef.current = false;
  }, [timerIsDone]);

  const go = React.useCallback((next: View) => {
    if (next === "e1rm") {
      setPicks(Array.from(picksRef.current.values()).sort((a, b) => a.order - b.order));
      setE1rmKey((k) => k + 1);
    }
    setView(next);
  }, []);

  const actions = React.useMemo<Actions>(
    () => ({
      open: (options) => {
        if (options?.unit) setUnit(options.unit);
        go(options?.tool ?? "picker");
      },
      reportE1rm: (rowId, pick) => {
        if (pick) picksRef.current.set(rowId, pick);
        else picksRef.current.delete(rowId);
      },
    }),
    [go],
  );

  const pill = pillTool(state, now);
  const showPill = pill != null && view === null;
  const status = React.useMemo(() => ({ hasActive: pill != null }), [pill]);

  const pillLabel =
    pill === "tally"
      ? `Tally · ${state.tally}`
      : pill === "stopwatch"
        ? `⏱ ${formatClock(stopwatchElapsedMs(state.stopwatch, now))}`
        : pill === "timer"
          ? `Timer ${formatClock(timerRemainingMs(state.timer, now))}`
          : "";

  const tool = view && view !== "picker" ? view : null;
  const title = tool ? TOOLS[tool].title : "Workout Tools";
  const description = tool ? TOOLS[tool].desc : "For any part of your workout. Nothing here is saved to your log.";
  // One back control, never two: on the list it closes the sheet; inside a
  // tool it says "Tools" and returns to the list.
  const backPill = (
    <button
      type="button"
      onClick={() => (tool ? setView("picker") : setView(null))}
      aria-label={tool ? "Back to all tools" : "Back"}
      data-testid={tool ? "tools-back" : "tools-close"}
      className="absolute left-3 top-3 z-20 inline-flex h-10 min-w-[72px] items-center justify-center gap-1 rounded-full border border-border bg-background/90 px-3 text-sm font-semibold text-foreground shadow-sm backdrop-blur transition hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="h-4 w-4" />
      <span>{tool ? "Tools" : "Back"}</span>
    </button>
  );
  const back = tool && (
    <button
      type="button"
      onClick={() => setView("picker")}
      className="-ml-2 inline-flex h-8 w-fit items-center rounded-full pl-1 pr-2.5 text-sm font-semibold text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      data-testid="tools-back"
    >
      <ChevronLeft className="h-4 w-4" /> All tools
    </button>
  );

  const body = (
    <ToolsBody
      view={view}
      go={go}
      state={state}
      setState={setState}
      unit={unit}
      calc={calc}
      pressCalc={pressCalc}
      picks={picks}
      e1rmKey={e1rmKey}
      onClose={() => setView(null)}
    />
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StatusContext.Provider value={status}>
        {children}

        {isMobile ? (
          <Sheet open={view != null} onOpenChange={(o) => !o && setView(null)}>
            <SheetContent hideCloseButton side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
              {backPill}
              <SheetHeader className="space-y-0.5 text-left">
                <SheetTitle className="text-base">{title}</SheetTitle>
                <SheetDescription className="text-xs">{description}</SheetDescription>
              </SheetHeader>
              {body}
            </SheetContent>
          </Sheet>
        ) : (
          <Dialog open={view != null} onOpenChange={(o) => !o && setView(null)}>
            <DialogContent className="max-w-sm p-4">
              <DialogHeader className="space-y-0.5 text-left">
                {back}
                <DialogTitle className="text-base">{title}</DialogTitle>
                <DialogDescription className="text-xs">{description}</DialogDescription>
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
      </StatusContext.Provider>
    </ActionsContext.Provider>
  );
}

function ToolsBody({
  view,
  go,
  state,
  setState,
  unit,
  calc,
  pressCalc,
  picks,
  e1rmKey,
  onClose,
}: {
  view: View;
  go: (v: View) => void;
  state: ToolsState;
  setState: React.Dispatch<React.SetStateAction<ToolsState>>;
  unit: WarmupUnit;
  calc: React.ComponentProps<typeof CalculatorTool>["state"];
  pressCalc: React.ComponentProps<typeof CalculatorTool>["press"];
  picks: E1rmPick[];
  e1rmKey: number;
  onClose: () => void;
}) {
  if (view === "picker" || view == null) return <ToolsPicker state={state} go={go} />;
  if (view === "calc") return <div className="mt-2"><CalculatorTool unit={unit} state={calc} press={pressCalc} /></div>;
  if (view === "e1rm") return <div className="mt-2"><E1rmTool key={e1rmKey} picks={picks} defaultUnit={unit} /></div>;

  if (view === "tally") {
    return (
      <TallyPanel
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
        value={state.stopwatch}
        onChange={(v) => setState((s) => ({ ...s, stopwatch: v }))}
        onMinimize={onClose}
      />
    );
  }

  return (
    <TimerPanel
      value={state.timer}
      onChange={(v) => setState((s) => ({ ...s, timer: v }))}
      onMinimize={onClose}
    />
  );
}

/** The tool list: grouped by job, each with a plain one-line description and what it's doing now. */
export function ToolsPicker({ state, go }: { state: ToolsState; go: (v: View) => void }) {
  const now = Date.now();
  const row = (key: ToolKey, icon: React.ReactNode, status: string | null = null) => (
    <PickerRow key={key} icon={icon} title={TOOLS[key].title} desc={TOOLS[key].desc} status={status} onClick={() => go(key)} />
  );
  return (
    <div className="mt-2 space-y-3" data-testid="tools-picker">
      <ToolGroup title="Lifting math">
        {row("calc", <Calculator className="h-4 w-4" />)}
        {row("e1rm", <Gauge className="h-4 w-4" />)}
      </ToolGroup>
      <ToolGroup title="Timers & counting">
        {row("timer", <TimerIcon className="h-4 w-4" />, toolStatus("timer", state, now))}
        {row("stopwatch", <Watch className="h-4 w-4" />, toolStatus("stopwatch", state, now))}
        {row("tally", <Hash className="h-4 w-4" />, toolStatus("tally", state, now))}
      </ToolGroup>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Rest timers are separate: they start from each exercise&apos;s rest button.
      </p>
      <SoundsRow />
    </div>
  );
}

/** The app's one sounds setting, where an athlete mid-workout will look for it. */
function SoundsRow() {
  const [on, setOn] = useAppSoundsOn();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid="tools-sounds"
      onClick={() => setOn(!on)}
      className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left transition hover:bg-accent"
    >
      {on ? <Volume2 className="h-4 w-4 shrink-0 text-primary" /> : <VolumeX className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">Workout sounds</span>
        <span className="block text-xs text-muted-foreground">Set logged, PRs, rest over, the finish. Mixes with your music.</span>
      </span>
      <span aria-hidden className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/35")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-all", on ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}

function ToolGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 px-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-border divide-y divide-border">{children}</div>
    </section>
  );
}

function PickerRow({
  icon,
  title,
  desc,
  status,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  status: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Open ${title}${status ? ` (${status})` : ""}`}
      onClick={onClick}
      className="flex min-h-[3.25rem] w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-accent active:bg-accent"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
      {status && (
        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary">{status}</span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 space-y-3">{children}</div>;
}

function TallyPanel({
  value,
  onChange,
  onMinimize,
  onClose,
}: {
  value: number;
  onChange: (v: number) => void;
  onMinimize: () => void;
  onClose: () => void;
}) {
  return (
    <PanelShell>
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
  value,
  onChange,
  onMinimize,
}: {
  value: StopwatchState;
  onChange: (v: StopwatchState) => void;
  onMinimize: () => void;
}) {
  const running = stopwatchRunning(value);
  const elapsed = stopwatchElapsedMs(value);
  return (
    <PanelShell>
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
  value,
  onChange,
  onMinimize,
}: {
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
    <PanelShell>
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

/**
 * The workout's Tools button (top of the workout, next to Warm-Up). A dot
 * shows while a timer, stopwatch or tally is going.
 */
export function WorkoutToolsButton({ unit, className }: { unit?: WarmupUnit; className?: string }) {
  const tools = useWorkoutToolsActions();
  const status = React.useContext(StatusContext);
  if (!tools) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      aria-label="Open Workout Tools: calculator, e1RM, timer, stopwatch, tally"
      onClick={() => tools.open({ unit })}
      className={cn("h-7 rounded-full px-2.5 text-xs", className)}
      data-testid="workout-tools-button"
    >
      <Wrench className="mr-1 h-3 w-3" /> Tools
      {status?.hasActive && <span aria-hidden className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />}
    </Button>
  );
}
