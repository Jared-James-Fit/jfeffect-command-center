/**
 * SetTimerInput — Timer as a normal set-row input.
 *
 * Renders exactly like the Reps / RPE / Weight cells (same height, radius and
 * colour language). Tapping it opens the standard popover with Play / Pause /
 * Reset plus a fast MM:SS target editor. The timer is a tool, never a
 * requirement: the client can type a result and commit it directly.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
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
  parseCardioDuration,
  cardioMinutesDraft,
  cardioDurationDraft,
} from "@/lib/set-timer-store";
import { feedback } from "@/lib/feedback";

export function SetTimerInput({
  timerKey,
  prescribedSeconds,
  completedSeconds,
  isConfirmed,
  disabled = false,
  focusMode = false,
  cardio = false,
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
  /** Cardio has a direct minutes-first numeric entry, separate from its timer. */
  cardio?: boolean;
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
  const [manualDraft, setManualDraft] = useState<string | null>(null);
  const manualDirty = useRef(false);
  const firstTap = useRef(false);

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
    // time's up: the timer's long buzz (the set's own tock follows as it logs)
    feedback("timer", { sound: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const elapsed = Math.max(0, target - remaining);

  const commitDraft = () => {
    const parsed = cardio ? parseCardioDuration(draft) : parseMMSS(draft);
    if (parsed == null) {
      toast.error(cardio ? "Enter minutes or a valid minutes:seconds duration" : "Enter a valid timer duration");
      return;
    }
    setEditing(false);
    setDraft("");
    persistTarget(timerKey, parsed);
    onTargetChange?.(parsed);
  };

  const label =
    isConfirmed && completedSeconds != null && !running && !paused
      ? fmtMMSS(completedSeconds)
      : fmtMMSS(remaining);

  const commitManual = (value: string) => {
    setManualDraft(null);
    if (!manualDirty.current) return;
    manualDirty.current = false;
    if (!value.trim()) return;
    const parsed = parseCardioDuration(value);
    if (parsed == null) {
      toast.error("Enter a valid time (minutes:seconds, seconds 0–59)");
      return;
    }
    onCommit(parsed, "manual_entry");
  };

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
      <div className={cardio ? "flex min-w-0 items-center gap-0.5" : "contents"}>
        {cardio && (
          <Input
            type="text"
            inputMode="numeric"
            enterKeyHint="done"
            aria-label={`${ariaLabel.replace(/timer$/, "time")} in minutes and seconds — tap either side of the colon`}
            title="Minutes : seconds. Tap either side of the colon."
            data-set-box
            data-cardio-time
            aria-invalid={manualDirty.current && manualDraft != null && parseCardioDuration(manualDraft) == null}
            disabled={disabled}
            readOnly={running || paused}
            value={manualDraft ?? (running || paused ? fmtMMSS(remaining) : completedSeconds != null ? fmtMMSS(completedSeconds) : "")}
            placeholder={fmtMMSS(target)}
            onFocus={(e) => {
              if (running || paused) return;
              manualDirty.current = false;
              firstTap.current = true;
              const input = e.currentTarget;
              const initial = cardioMinutesDraft(completedSeconds ?? 0);
              setManualDraft(initial);
              input.value = initial;
              input.setSelectionRange(0, initial.indexOf(":"));
            }}
            onClick={(e) => {
              if (running || paused) return;
              const input = e.currentTarget;
              const colon = input.value.indexOf(":");
              if (colon < 0) return;
              const pos = input.selectionStart ?? 0;
              if (firstTap.current || pos <= colon) input.setSelectionRange(0, colon);
              else input.setSelectionRange(colon + 1, input.value.length);
              firstTap.current = false;
            }}
            onChange={(e) => {
              const input = e.currentTarget;
              const raw = input.value;
              const next = cardioDurationDraft(raw, manualDraft ?? "0:00");
              firstTap.current = false;
              if (next === manualDraft) return;
              manualDirty.current = true;
              setManualDraft(next);
              if (next !== raw) {
                input.value = next;
                const pos = next.indexOf(":");
                input.setSelectionRange(pos < 0 ? next.length : pos, pos < 0 ? next.length : pos);
              }
            }}
            onPaste={(e) => {
              const raw = e.clipboardData.getData("text").trim();
              const parsed = parseCardioDuration(raw);
              if (parsed == null) { e.preventDefault(); return; }
              e.preventDefault();
              manualDirty.current = true;
              firstTap.current = false;
              setManualDraft(cardioMinutesDraft(parsed));
            }}
            onBlur={(e) => commitManual(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            }}
            className={cn("min-w-0 flex-1 px-0.5 text-center text-base tabular-nums sm:text-sm", focusMode ? "h-12 sm:h-10" : "h-11 sm:h-8", isConfirmed && completedSeconds != null ? "border-success/50 bg-success/10 text-success" : "border-dashed border-border", manualDirty.current && manualDraft != null && parseCardioDuration(manualDraft) == null && "border-destructive") }
          />
        )}
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={cardio ? `${ariaLabel} controls` : ariaLabel}
          title={cardio ? "Open cardio timer" : "Timer"}
          className={cn(
            "flex w-full items-center justify-center gap-1 rounded-md border px-2 text-sm font-medium tabular-nums transition-colors whitespace-nowrap",
            // the set's other boxes are 44px on a phone; the timer matches them
            focusMode ? "h-12 text-base sm:h-10" : "h-11 sm:h-8",
            isConfirmed && completedSeconds != null
              ? "border-success/50 bg-success/10 text-success"
              : running
                ? "border-primary bg-primary/10 text-primary"
                : paused
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-600"
                  // Not logged yet: the target, drawn like a placeholder so it
                  // never reads as a time already done.
                  : "border-dashed border-border bg-transparent text-muted-foreground",
            !disabled && "cursor-pointer",
            cardio && "w-7 shrink-0 px-0.5",
          )}
        >
          {isConfirmed && completedSeconds != null && !running && !paused && !cardio ? (
            <Check className="h-3 w-3 shrink-0" />
          ) : paused ? (
            <Pause className="h-3 w-3 shrink-0" />
          ) : (
            <Play className="h-3 w-3 shrink-0" />
          )}
          {!cardio && label}
        </button>
      </PopoverTrigger>
      </div>
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
          <div className="text-center text-2xl font-bold tabular-nums">{fmtMMSS(remaining)}</div>
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
                onFocus={(e) => {
                  const input = e.currentTarget;
                  if (cardio) input.setSelectionRange(0, Math.max(0, input.value.indexOf(":")));
                  else input.select();
                }}
                inputMode={cardio ? "numeric" : "text"}
                type="text"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                value={draft}
                onChange={(e) => setDraft(cardio ? cardioDurationDraft(e.target.value, draft) : e.target.value)}
                placeholder={cardio ? "min:sec" : "MM:SS (or seconds)"}
                aria-label={cardio ? "Timer target in minutes and seconds" : "Timer target"}
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
                setDraft(cardio ? cardioMinutesDraft(target) : fmtMMSS(target));
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
