/**
 * SetTimerInput — Timer as a normal set-row input.
 *
 * Renders exactly like the Reps / RPE / Weight cells (same height, radius and
 * colour language). Tapping it opens the standard popover with Play / Pause /
 * Reset plus a fast MM:SS target editor. The timer is a tool, never a
 * requirement: the client can type a result and commit it directly.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Play, Pause, RotateCcw, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  readTimer,
  remainingSeconds,
  isRunning,
  isPaused,
  isFinished,
  startTimer,
  pauseTimer,
  resetTimer,
  setTarget as persistTarget,
  subscribeTimers,
  fmtMMSS,
  parseMMSS,
} from "@/lib/set-timer-store";

export function SetTimerInput({
  timerKey,
  prescribedSeconds,
  completedSeconds,
  isConfirmed,
  disabled = false,
  focusMode = false,
  onCommit,
  onTargetChange,
  ariaLabel,
}: {
  timerKey: string;
  /** Coach prescription (top end of a range) — the initial target. */
  prescribedSeconds: number | null;
  /** Actual logged result for this set, if any. */
  completedSeconds: number | null;
  isConfirmed: boolean;
  disabled?: boolean;
  focusMode?: boolean;
  /** Persist the actual performed seconds for this set. */
  onCommit: (
    seconds: number,
    method: "countdown_timer" | "manual_entry" | "prescribed_quick_confirm",
  ) => void;
  /** Persist an adjusted target for this row (device-local). */
  onTargetChange?: (seconds: number | null) => void;
  ariaLabel: string;
}) {
  const state = useSyncExternalStore(
    subscribeTimers,
    () => readTimer(timerKey),
    () => null,
  );
  const target = state?.target ?? prescribedSeconds ?? 60;
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const running = isRunning(state);
  const paused = isPaused(state);
  const finished = isFinished(state);
  const remaining = remainingSeconds(state, target);

  // Tick only while running — the value itself is derived from timestamps, so
  // backgrounding the app never drifts.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [running]);

  // Countdown reached zero → log the full target automatically.
  useEffect(() => {
    if (!finished) return;
    onCommit(target, "countdown_timer");
    resetTimer(timerKey, target);
    try {
      if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
    } catch {
      /* no haptics */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const elapsed = Math.max(0, target - remaining);

  const commitDraft = () => {
    const parsed = parseMMSS(draft);
    setEditing(false);
    setDraft("");
    if (parsed == null) return;
    persistTarget(timerKey, parsed);
    onTargetChange?.(parsed);
  };

  const label =
    isConfirmed && completedSeconds != null && !running && !paused
      ? fmtMMSS(completedSeconds)
      : fmtMMSS(remaining);

  return (
    <Popover
      open={open}
      onOpenChange={(n) => {
        if (disabled) return;
        setOpen(n);
        if (!n) {
          setEditing(false);
          setDraft("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          title="Timer"
          className={cn(
            "flex w-full items-center justify-center gap-1 rounded-md border px-2 text-sm font-medium tabular-nums transition-colors whitespace-nowrap",
            focusMode ? "h-9 text-base" : "h-8",
            isConfirmed && completedSeconds != null
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
              : running
                ? "border-primary bg-primary/10 text-primary"
                : paused
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-600"
                  : "border-blue-500/40 bg-blue-500/10 text-foreground",
            !disabled && "cursor-pointer",
          )}
        >
          {isConfirmed && completedSeconds != null && !running && !paused ? (
            <Check className="h-3 w-3 shrink-0" />
          ) : paused ? (
            <Pause className="h-3 w-3 shrink-0" />
          ) : (
            <Play className="h-3 w-3 shrink-0" />
          )}
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="bottom"
        collisionPadding={12}
        className="w-auto max-w-[calc(100vw-2rem)] p-2.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-2">
          <div className="px-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Timer
          </div>
          <div className="text-center text-2xl font-black tabular-nums">{fmtMMSS(remaining)}</div>
          <div className="flex items-center gap-1.5">
            {running ? (
              <button
                type="button"
                onClick={() => pauseTimer(timerKey)}
                className="flex h-10 flex-1 items-center justify-center gap-1 rounded-lg border border-border/60 bg-muted/40 text-sm font-semibold"
              >
                <Pause className="h-4 w-4" /> Pause
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startTimer(timerKey, target)}
                className="flex h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
              >
                <Play className="h-4 w-4" /> {paused ? "Resume" : "Play"}
              </button>
            )}
            <button
              type="button"
              onClick={() => resetTimer(timerKey, target)}
              aria-label="Reset timer"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          {/* Target — tap to edit, fast MM:SS entry */}
          {editing ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                commitDraft();
              }}
            >
              <Input
                autoFocus
                inputMode="numeric"
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="45 or 1:30"
                aria-label="Timer target"
                className="h-10 px-2 text-base tabular-nums"
              />
              <button
                type="submit"
                aria-label="Save target"
                onMouseDown={(e) => e.preventDefault()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
              >
                <Check className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(fmtMMSS(target));
                setEditing(true);
              }}
              className="flex h-9 w-full items-center justify-between rounded-md border border-dashed border-border/70 px-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <span>Target</span>
              <span className="tabular-nums text-foreground">{fmtMMSS(target)}</span>
            </button>
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const secs = running || paused ? Math.max(1, elapsed) : target;
                onCommit(secs, running || paused ? "countdown_timer" : "prescribed_quick_confirm");
                resetTimer(timerKey, target);
                setOpen(false);
              }}
              className="h-9 flex-1 rounded-md bg-primary text-[12px] font-bold text-primary-foreground"
            >
              Log {fmtMMSS(running || paused ? Math.max(1, elapsed) : target)}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 rounded-md border border-border/60 px-3 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Done
            </button>
          </div>
          {prescribedSeconds != null && prescribedSeconds !== target && (
            <p className="text-center text-[10px] text-muted-foreground">
              Prescribed {fmtMMSS(prescribedSeconds)}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
