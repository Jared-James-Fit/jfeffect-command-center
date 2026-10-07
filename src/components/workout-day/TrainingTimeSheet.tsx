import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, Minus, Plus, Zap } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setTrainingTime } from "@/lib/workout-completion.functions";
import {
  formatClockAt,
  formatMinutes,
  zonedDateInput,
  zonedTimeInput,
  zonedWallTimeToDate,
} from "@/lib/analytics/training-time";

const DURATION_CHIPS = [45, 60, 75, 90, 105, 120];

/**
 * "When did you train?" — the one place a session's real start and length
 * get set. Built to be impossible to get wrong on a phone: native date/time
 * pickers, one-tap length chips, a live "5:40 → 6:55 PM" readout, and a
 * "Just finished" shortcut for the athlete logging right after the gym.
 */
export function TrainingTimeSheet({
  open,
  onOpenChange,
  completionId,
  timezone,
  initialStart,
  initialDurationMin,
  workoutTitle,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completionId: string;
  timezone: string;
  initialStart: Date;
  initialDurationMin: number | null;
  workoutTitle?: string | null;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(setTrainingTime);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(zonedDateInput(initialStart, timezone));
    setTime(zonedTimeInput(initialStart, timezone));
    setDuration(initialDurationMin && initialDurationMin >= 5 ? Math.min(300, initialDurationMin) : 60);
  }, [open, initialStart, initialDurationMin, timezone]);

  const start = useMemo(() => zonedWallTimeToDate(date, time, timezone), [date, time, timezone]);
  const end = start ? new Date(start.getTime() + duration * 60_000) : null;
  const inFuture = !!end && end.getTime() > Date.now() + 10 * 60_000;

  const justFinished = () => {
    const s = new Date(Date.now() - duration * 60_000);
    setDate(zonedDateInput(s, timezone));
    setTime(zonedTimeInput(s, timezone));
  };

  const onSave = async () => {
    if (!start || inFuture) return;
    setSaving(true);
    try {
      await save({ data: { completionId, trainingStartedAt: start.toISOString(), durationMin: duration } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["training-time"] }),
        qc.invalidateQueries({ queryKey: ["pl-day-completion"] }),
      ]);
      toast.success("Session time saved");
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the session time");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl pb-safe">
        <SheetHeader className="pb-2 text-left">
          <SheetTitle className="text-lg font-black">When did you train?</SheetTitle>
          <SheetDescription className="text-xs">
            {workoutTitle ? `${workoutTitle} · ` : ""}Your coach uses this to find your best training time.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Day</span>
              <input
                type="date"
                value={date}
                max={zonedDateInput(new Date(), timezone)}
                onChange={(e) => setDate(e.target.value)}
                className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base font-bold text-foreground"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Started</span>
              <input
                type="time"
                value={time}
                step={300}
                onChange={(e) => setTime(e.target.value)}
                className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base font-bold text-foreground"
              />
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">How long</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="5 minutes shorter"
                  onClick={() => setDuration((d) => Math.max(5, d - 5))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-[72px] text-center text-base font-black tabular-nums text-foreground">
                  {formatMinutes(duration)}
                </span>
                <button
                  type="button"
                  aria-label="5 minutes longer"
                  onClick={() => setDuration((d) => Math.min(300, d + 5))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {DURATION_CHIPS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDuration(m)}
                  className={cn(
                    "h-10 rounded-lg border text-xs font-bold tabular-nums transition-colors",
                    duration === m
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:bg-secondary",
                  )}
                >
                  {m < 60 ? `${m}m` : formatMinutes(m).replace(" ", "")}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={justFinished}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <Zap className="h-4 w-4" /> Just finished? Fill it in from now
          </button>

          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border p-3",
              inFuture ? "border-destructive/40 bg-destructive/10" : "border-border bg-muted/30",
            )}
          >
            <Clock className={cn("h-5 w-5 shrink-0", inFuture ? "text-destructive" : "text-muted-foreground")} />
            <div className="min-w-0">
              <div className="text-base font-black tabular-nums text-foreground">
                {start && end ? `${formatClockAt(start, timezone)} → ${formatClockAt(end, timezone)}` : "Pick a day and time"}
              </div>
              <div className="text-xs text-muted-foreground">
                {inFuture ? "That ends in the future. Check the day and start time." : `${formatMinutes(duration)} session`}
              </div>
            </div>
          </div>

          <Button size="lg" className="h-12 w-full text-base font-black" disabled={!start || inFuture || saving} onClick={onSave}>
            {saving ? "Saving…" : "Save session time"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
