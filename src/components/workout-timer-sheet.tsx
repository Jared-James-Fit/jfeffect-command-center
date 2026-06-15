import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, X, Check, Plus, Timer as TimerIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, formatDurationShort } from "@/lib/duration";
import { DurationInput } from "@/components/duration-input";

type CompletionMethod = "countdown_timer" | "stopwatch" | "manual_entry";

export type TimerCompletionPayload = {
  completedSeconds: number;
  method: CompletionMethod;
  startedAt: string;
  completedAt: string;
  finishedEarly: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exerciseName: string;
  setIndex: number;
  setCount: number;
  prescribedSeconds: number;
  /** Stable key — used to resume the countdown across remounts. */
  resumeKey: string;
  onComplete: (payload: TimerCompletionPayload) => void;
};

type Mode = "countdown" | "stopwatch";

function fmtClock(totalMs: number): string {
  const total = Math.max(0, Math.ceil(totalMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function beep() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    o.start(); o.stop(ctx.currentTime + 0.75);
  } catch { /* no-op */ }
}
function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* no-op */ }
  }
}

/**
 * Full-screen mobile / desktop-centred countdown sheet.
 *
 * Timekeeping is driven by an absolute `endsAt` timestamp persisted to
 * `sessionStorage`, so the countdown stays accurate when the screen locks,
 * the app moves to background, or the sheet is closed and reopened.
 *
 * Returns a completed-set payload through `onComplete`.
 */
export function WorkoutTimerSheet({
  open, onOpenChange,
  exerciseName, setIndex, setCount, prescribedSeconds, resumeKey,
  onComplete,
}: Props) {
  const storageKey = `workout-timer:${resumeKey}`;
  const totalMs = Math.max(0, Math.round(prescribedSeconds * 1000));
  const [mode, setMode] = useState<Mode>("countdown");
  // For countdown: `endsAt` (absolute) when running, `remainingMs` when paused.
  // For stopwatch: `startedAt` (absolute) when running, `elapsedMs` when paused.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(totalMs);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wakeLockRef = useRef<any>(null);
  // The first-start timestamp drives `timer_started_at` in the audit trail.
  const firstStartedAtRef = useRef<number | null>(null);
  // Extra time the coach/client added past the prescribed duration.
  const [bonusSeconds, setBonusSeconds] = useState(0);

  // Hydrate resumable countdown from sessionStorage when reopening.
  useEffect(() => {
    if (!open) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          mode: Mode; endsAt?: number; remainingMs?: number;
          startedAt?: number; elapsedMs?: number; firstStartedAt?: number;
          bonusSeconds?: number;
        };
        setMode(parsed.mode ?? "countdown");
        setEndsAt(parsed.endsAt ?? null);
        setRemainingMs(parsed.remainingMs ?? totalMs);
        setStartedAt(parsed.startedAt ?? null);
        setElapsedMs(parsed.elapsedMs ?? 0);
        firstStartedAtRef.current = parsed.firstStartedAt ?? null;
        setBonusSeconds(parsed.bonusSeconds ?? 0);
      } else {
        setRemainingMs(totalMs);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storageKey]);

  // Persist state so closing/reopening doesn't reset an active countdown.
  useEffect(() => {
    if (!open) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        mode, endsAt, remainingMs, startedAt, elapsedMs,
        firstStartedAt: firstStartedAtRef.current,
        bonusSeconds,
      }));
    } catch { /* ignore */ }
  }, [open, storageKey, mode, endsAt, remainingMs, startedAt, elapsedMs, bonusSeconds]);

  // Tick driver — `now` is what every derived value reads.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [open]);

  // Wake-lock while a timer is actively running and the sheet is open.
  const running = (mode === "countdown" && endsAt != null) || (mode === "stopwatch" && startedAt != null);
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        if (running && open && (navigator as any)?.wakeLock?.request) {
          const wl = await (navigator as any).wakeLock.request("screen");
          if (cancelled) { wl.release?.(); return; }
          wakeLockRef.current = wl;
        }
      } catch { /* ignore — best-effort only */ }
    }
    function release() {
      const wl = wakeLockRef.current;
      if (wl) { try { wl.release?.(); } catch { /* ignore */ } wakeLockRef.current = null; }
    }
    if (running && open) acquire(); else release();
    return () => { cancelled = true; release(); };
  }, [running, open]);

  // Detect natural countdown completion.
  const countdownReachedZero = mode === "countdown" && endsAt != null && now >= endsAt;
  useEffect(() => {
    if (!countdownReachedZero) return;
    setEndsAt(null);
    setRemainingMs(0);
    setDone(true);
    beep();
    vibrate([180, 80, 180]);
  }, [countdownReachedZero]);

  const startCountdown = () => {
    const from = remainingMs > 0 ? remainingMs : totalMs;
    const start = Date.now();
    if (firstStartedAtRef.current == null) firstStartedAtRef.current = start;
    setEndsAt(start + from);
    setRemainingMs(from);
    setDone(false);
  };
  const pauseCountdown = () => {
    if (endsAt == null) return;
    setRemainingMs(Math.max(0, endsAt - Date.now()));
    setEndsAt(null);
  };
  const restart = () => {
    setEndsAt(null);
    setRemainingMs(totalMs);
    setDone(false);
    setBonusSeconds(0);
  };

  const startStopwatch = () => {
    const start = Date.now() - elapsedMs;
    if (firstStartedAtRef.current == null) firstStartedAtRef.current = start;
    setStartedAt(start);
  };
  const pauseStopwatch = () => {
    if (startedAt == null) return;
    setElapsedMs(Date.now() - startedAt);
    setStartedAt(null);
  };

  const displayMs = mode === "countdown"
    ? (endsAt != null ? Math.max(0, endsAt - now) : remainingMs)
    : (startedAt != null ? Date.now() - startedAt : elapsedMs);

  const completedFromTimer = useCallback((finishedEarly: boolean): TimerCompletionPayload => {
    const startedISO = new Date(firstStartedAtRef.current ?? Date.now()).toISOString();
    const completedAtISO = new Date().toISOString();
    if (mode === "countdown") {
      // Default: prescribed + any bonus the client added.
      const fullPrescribed = Math.round(totalMs / 1000);
      const completed = finishedEarly
        ? Math.max(0, fullPrescribed - Math.ceil(displayMs / 1000))
        : fullPrescribed + bonusSeconds;
      return {
        completedSeconds: completed,
        method: "countdown_timer",
        startedAt: startedISO,
        completedAt: completedAtISO,
        finishedEarly,
      };
    }
    return {
      completedSeconds: Math.max(1, Math.round(displayMs / 1000)),
      method: "stopwatch",
      startedAt: startedISO,
      completedAt: completedAtISO,
      finishedEarly: false,
    };
  }, [mode, totalMs, bonusSeconds, displayMs]);

  const close = (clearResume: boolean) => {
    if (clearResume) {
      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
      setEndsAt(null); setStartedAt(null); setElapsedMs(0);
      setRemainingMs(totalMs); setDone(false); setBonusSeconds(0);
      firstStartedAtRef.current = null;
    }
    onOpenChange(false);
  };

  const finalize = (payload: TimerCompletionPayload) => {
    onComplete(payload);
    close(true);
  };

  const isCountdown = mode === "countdown";
  const isRunning = running;

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close(false))}>
      <SheetContent side="bottom" className="h-[100dvh] p-0 sm:h-[90vh]">
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-base font-black tracking-tight">{exerciseName}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold">Set {setIndex} of {setCount}</span>
            <span className="text-muted-foreground">·</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 font-bold text-primary">
              <Clock className="h-3 w-3" /> Work: {formatDuration(prescribedSeconds)}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="flex h-[calc(100%-72px)] flex-col items-center justify-between gap-6 px-4 pt-8 pb-6">
          {/* Mode toggle — countdown is primary; stopwatch is a small secondary control */}
          <div className="inline-flex rounded-full border border-border bg-muted/40 p-0.5 text-[11px] font-bold uppercase tracking-wider">
            <button
              type="button" onClick={() => setMode("countdown")}
              className={cn("rounded-full px-3 py-1", isCountdown ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              <TimerIcon className="mr-1 inline h-3 w-3" /> Countdown
            </button>
            <button
              type="button" onClick={() => setMode("stopwatch")}
              className={cn("rounded-full px-3 py-1", !isCountdown ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              Stopwatch
            </button>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className={cn(
              "select-none font-black tabular-nums leading-none tracking-tight",
              done ? "text-emerald-500" : "text-foreground",
              "text-[26vw] sm:text-[160px]",
            )}
            aria-live="polite">
              {fmtClock(displayMs)}
            </div>
            {done && (
              <p className="text-sm font-bold uppercase tracking-widest text-emerald-500">Time complete</p>
            )}
            {!done && !isRunning && isCountdown && remainingMs !== totalMs && (
              <p className="text-xs text-muted-foreground">Paused</p>
            )}
          </div>

          {/* Primary action row */}
          <div className="flex w-full max-w-md flex-col items-stretch gap-3">
            {done && isCountdown ? (
              <>
                <Button size="lg" className="h-14 text-base font-bold" onClick={() => finalize(completedFromTimer(false))}>
                  <Check className="mr-2 h-5 w-5" /> Complete Set
                </Button>
                <div className="flex items-center justify-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setBonusSeconds((b) => b + 10); setRemainingMs(10_000); setDone(false); startCountdown(); }}>
                    <Plus className="mr-1 h-3 w-3" /> 10 sec
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setBonusSeconds((b) => b + 30); setRemainingMs(30_000); setDone(false); startCountdown(); }}>
                    <Plus className="mr-1 h-3 w-3" /> 30 sec
                  </Button>
                  <Button size="sm" variant="ghost" onClick={restart}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Redo
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  className="h-14 text-base font-bold"
                  onClick={isCountdown
                    ? (isRunning ? pauseCountdown : startCountdown)
                    : (isRunning ? pauseStopwatch : startStopwatch)}
                >
                  {isRunning ? <><Pause className="mr-2 h-5 w-5" /> Pause</> : <><Play className="mr-2 h-5 w-5" /> Start</>}
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  <Button size="sm" variant="outline" onClick={restart} disabled={isCountdown ? remainingMs === totalMs && !done : elapsedMs === 0 && startedAt == null}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Restart
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (isCountdown) {
                        // Finish early — credit the elapsed portion.
                        pauseCountdown();
                        const elapsedSec = Math.max(1, Math.round((totalMs - (endsAt != null ? Math.max(0, endsAt - Date.now()) : remainingMs)) / 1000));
                        finalize({
                          completedSeconds: elapsedSec,
                          method: "countdown_timer",
                          startedAt: new Date(firstStartedAtRef.current ?? Date.now()).toISOString(),
                          completedAt: new Date().toISOString(),
                          finishedEarly: true,
                        });
                      } else {
                        pauseStopwatch();
                        finalize(completedFromTimer(false));
                      }
                    }}
                    disabled={!isRunning && (isCountdown ? remainingMs === totalMs : elapsedMs === 0)}
                  >
                    <Check className="mr-1 h-3 w-3" /> Finish
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => close(false)}>
                    <X className="mr-1 h-3 w-3" /> Close
                  </Button>
                </div>
                <p className="text-center text-[11px] text-muted-foreground">
                  Timer keeps running if the screen locks or the app moves to the background.
                </p>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Tiny dialog for the manual-confirm flow: "Completed 45 sec?" with
 * Yes / Edit actual time / Cancel.
 */
export function QuickConfirmDuration({
  open, onOpenChange, prescribedSeconds, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prescribedSeconds: number;
  onConfirm: (completedSeconds: number, method: "prescribed_quick_confirm" | "manual_entry") => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(prescribedSeconds);
  useEffect(() => { if (open) { setEditing(false); setDraft(prescribedSeconds); } }, [open, prescribedSeconds]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="p-0">
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-sm font-bold">Completed {formatDuration(prescribedSeconds)}?</SheetTitle>
          <SheetDescription className="text-xs">
            Confirm the prescribed duration or enter the actual time.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 py-4">
          {editing ? (
            <>
              <DurationInput valueSeconds={draft} onChange={setDraft} showCaption autoFocus />
              <div className="flex items-center gap-2">
                <Button size="sm" className="flex-1" disabled={!draft} onClick={() => draft && onConfirm(draft, "manual_entry")}>
                  <Check className="mr-1 h-4 w-4" /> Save {formatDurationShort(draft)}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Back</Button>
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              <Button size="lg" className="h-12 text-sm font-bold" onClick={() => onConfirm(prescribedSeconds, "prescribed_quick_confirm")}>
                <Check className="mr-2 h-5 w-5" /> Yes, complete set
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit actual time
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}