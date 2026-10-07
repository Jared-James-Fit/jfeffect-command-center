import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { TrainingTimeSheet } from "@/components/workout-day/TrainingTimeSheet";
import {
  DEFAULT_TRAINING_TZ,
  formatClockAt,
  formatMinutes,
  resolveTiming,
} from "@/lib/analytics/training-time";

/**
 * Finished-workout "Session time" line: 5:40 PM → 6:55 PM · 1h 15m, tap to
 * fix. When the workout was clearly logged after the gym, it turns into a
 * one-tap prompt instead, so bad timestamps get corrected at the source.
 */
export function SessionTimeRow({
  completion,
  clientId,
  workoutTitle,
  className,
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
  if (!timing) return null;
  const suspect = timing.source === "suspect";
  const end = timing.durationMin != null ? new Date(timing.start.getTime() + timing.durationMin * 60_000) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
          suspect
            ? "border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200"
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
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Session </span>
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
      <TrainingTimeSheet
        open={open}
        onOpenChange={setOpen}
        completionId={completion.id}
        timezone={timezone}
        initialStart={timing.start}
        initialDurationMin={timing.durationMin}
        workoutTitle={workoutTitle}
      />
    </>
  );
}
