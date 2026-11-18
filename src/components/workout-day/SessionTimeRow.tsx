import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Clock, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { TrainingTimeSheet } from "@/components/workout-day/TrainingTimeSheet";
import {
  DEFAULT_TRAINING_TZ,
  formatClockAt,
  formatMinutes,
  resolveTiming,
} from "@/lib/analytics/training-time";

/** "6:40–7:55 PM" when both ends share AM / PM, else "11:40 AM – 12:55 PM". */
export function clockRange(start: string, end: string): string {
  const a = /^(.*\d)\s*([AP]M)$/i.exec(start.trim());
  const b = /^(.*\d)\s*([AP]M)$/i.exec(end.trim());
  if (a && b && a[2].toUpperCase() === b[2].toUpperCase()) return `${a[1]}–${end.trim()}`;
  return `${start.trim()} – ${end.trim()}`;
}

/**
 * Finished-workout "Session time" line: 5:40 PM → 6:55 PM · 1h 15m, tap to
 * fix. When the workout was clearly logged after the gym, it turns into a
 * one-tap prompt instead, so bad timestamps get corrected at the source.
 *
 * With `lead` (the finished card's "✓ Completed") it is the card's status
 * line: "✓ Completed" over "6:40–7:55 PM · 1h 15m", one tap to fix the time; a
 * suspect time keeps its own prompt under the status, and with no time at all
 * the status stands alone.
 */
export function SessionTimeRow({
  completion,
  clientId,
  workoutTitle,
  className,
  inCard = false,
  lead,
}: {
  completion: {
    id: string;
    started_at: string | null;
    training_started_at?: string | null;
    completed_at: string;
    actual_duration_min: number | null;
    logged_sets_count: number | null;
  };
  clientId: string;
  workoutTitle?: string | null;
  className?: string;
  /** Inside the finished-workout card: a plain line under a divider (the
   *  "When did you train?" prompt keeps its amber box). */
  inCard?: boolean;
  /** The status this line sits beside (the finished card's "Completed"). */
  lead?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data: timezone = DEFAULT_TRAINING_TZ } = useQuery({
    queryKey: ["client-timezone", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("timezone").eq("id", clientId).maybeSingle();
      return (data?.timezone || "").trim() || DEFAULT_TRAINING_TZ;
    },
  });

  const timing = resolveTiming({
    startedAt: completion.started_at,
    trainingStartedAt: completion.training_started_at ?? null,
    completedAt: completion.completed_at,
    durationMin: completion.actual_duration_min,
    loggedSets: completion.logged_sets_count,
  });
  if (!timing) return lead ? <div className="flex min-h-10 items-center">{lead}</div> : null;
  const suspect = timing.source === "suspect";
  const end = timing.durationMin != null ? new Date(timing.start.getTime() + timing.durationMin * 60_000) : null;
  const sheet = (
    <TrainingTimeSheet
      open={open}
      onOpenChange={setOpen}
      completionId={completion.id}
      timezone={timezone}
      initialStart={timing.start}
      initialDurationMin={timing.durationMin}
      workoutTitle={workoutTitle}
    />
  );

  if (lead && !suspect) {
    const startText = formatClockAt(timing.start, timezone);
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-session-time
          className={cn(
            "-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-secondary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            {lead}
            <span className="pl-6 text-[13px] leading-snug tabular-nums text-muted-foreground">
              {end ? clockRange(startText, formatClockAt(end, timezone)) : startText}
              {timing.durationMin != null ? ` · ${formatMinutes(timing.durationMin)}` : ""}
              <span className="sr-only">. Edit session time</span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        {sheet}
      </>
    );
  }

  return (
    <>
      {lead && <div className="flex min-h-10 items-center">{lead}</div>}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
          suspect
            ? "border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200"
            : inCard
              ? "min-h-10 rounded-none border-x-0 border-b-0 border-t-border px-0 pb-0 pt-2.5 text-foreground"
              : "border-border bg-card text-foreground hover:bg-secondary/60",
          className,
        )}
      >
        {suspect ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          {suspect ? (
            <>
              <b>When did you train?</b> Logged after the session. Set the real time for your training-time stats.
            </>
          ) : (
            <>
              <span className="text-muted-foreground">Session </span>
              <b className="tabular-nums">
                {formatClockAt(timing.start, timezone)}
                {end ? ` → ${formatClockAt(end, timezone)}` : ""}
              </b>
              <span className="tabular-nums text-muted-foreground"> · {formatMinutes(timing.durationMin)}</span>
            </>
          )}
        </span>
        <Pencil className="h-3.5 w-3.5 shrink-0 opacity-70" aria-label="Edit session time" />
      </button>
      {sheet}
    </>
  );
}
