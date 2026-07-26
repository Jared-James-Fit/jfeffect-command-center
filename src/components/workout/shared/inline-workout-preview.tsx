import { useQuery } from "@tanstack/react-query";
import { Check, Circle, CircleDot, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { derivePurposeLabels, purposeLabelBadgeClass } from "@/lib/exercise-metadata";
import { computeWorkoutProgress } from "@/lib/workout-progress";
import { WorkoutProgressRing } from "@/components/workout/shared/workout-progress-ring";

/**
 * Read-only inline preview of a workout day. Shows exercise order,
 * classification chip, prescribed sets/reps/RPE, a small completion
 * indicator, and up to a handful of completed-set lines.
 *
 * Reused across coaching-client surfaces (WorkoutListCard,
 * WorkoutsExperience DayCard) so client and coach/admin views stay
 * synchronized. Do NOT expand this into an editor — the full
 * logging experience remains the WorkoutDayView route.
 */

type Row = {
  id: string;
  sort_order: number | null;
  exercise_name_override: string | null;
  purpose_label: string | null;
  time_profile: string | null;
  sets: number | null;
  reps_text: string | null;
  rpe: number | string | null;
  load_kg: number | null;
  load_lb: number | null;
  measurement_type: string | null;
  card_color: string | null;
  movement_family: string | null;
  exercise_id: string | null;
  exercises:
    | {
        name: string | null;
        competition_lift_type?: string | null;
        is_competition_lift?: boolean | null;
        exercise_category?: string | null;
      }
    | null;
};

type Result = {
  row_id: string;
  set_index: number | null;
  actual_load: number | null;
  actual_load_unit: "kg" | "lb" | null;
  actual_reps: number | null;
  actual_rpe: number | string | null;
  actual_rir: number | string | null;
  completed_duration_seconds: number | null;
};

function formatSetLine(set: Result, kind: string | null): string {
  const rpeSuffix =
    set.actual_rpe != null && set.actual_rpe !== ""
      ? ` @${set.actual_rpe}`
      : set.actual_rir != null && set.actual_rir !== ""
        ? ` RIR ${set.actual_rir}`
        : "";
  if (kind === "time" || (set.completed_duration_seconds != null && set.actual_reps == null && set.actual_load == null)) {
    const s = Number(set.completed_duration_seconds ?? 0);
    if (s >= 60) {
      const m = Math.floor(s / 60);
      const r = s % 60;
      return r ? `${m}m ${r}s${rpeSuffix}` : `${m}m${rpeSuffix}`;
    }
    return `${s} sec${rpeSuffix}`;
  }
  const load = set.actual_load;
  const unit = set.actual_load_unit ?? "lb";
  const reps = set.actual_reps ?? 0;
  if (load == null || Number(load) <= 0) {
    return `${reps} rep${reps === 1 ? "" : "s"}${rpeSuffix}`;
  }
  return `${load} ${unit} × ${reps}${rpeSuffix}`;
}

function prescribedLine(row: Row): string | null {
  const parts: string[] = [];
  if (row.sets && row.reps_text) parts.push(`${row.sets} × ${row.reps_text}`);
  else if (row.sets) parts.push(`${row.sets} sets`);
  else if (row.reps_text) parts.push(row.reps_text);
  const load =
    row.load_kg != null ? `${row.load_kg} kg` : row.load_lb != null ? `${row.load_lb} lb` : null;
  if (load) parts.push(load);
  if (row.rpe != null && row.rpe !== "") parts.push(`RPE ${row.rpe}`);
  return parts.length ? parts.join(" | ") : null;
}

export function InlineWorkoutPreview({
  dayId,
  clientId,
  enabled = true,
}: {
  dayId: string;
  clientId: string;
  enabled?: boolean;
}) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["inline-workout-preview", dayId, clientId],
    enabled: enabled && !!dayId && !!clientId,
    staleTime: 15_000,
    retry: 1,
    queryFn: async () => {
      // Fetch rows first, then scope results by row ids. Filtering
      // `pl_row_results` through an `!inner` embedded relation can
      // silently return 0 rows (or a 400) on some PostgREST configs,
      // which used to leave the preview stuck in a loading/empty state.
      const rowsRes = await supabase
        .from("pl_exercise_rows")
        .select(
          "id, sort_order, exercise_name_override, purpose_label, time_profile, sets, reps_text, rpe, load_kg, load_lb, measurement_type, card_color, movement_family, exercise_id, exercises(name, competition_lift_type, is_competition_lift, exercise_category)",
        )
        .eq("day_id", dayId)
        .order("sort_order", { ascending: true });
      if (rowsRes.error) throw rowsRes.error;
      const rows = ((rowsRes.data ?? []) as unknown) as Row[];
      const rowIds = rows.map((r) => r.id);
      let results: Result[] = [];
      if (rowIds.length > 0) {
        const resultsRes = await supabase
          .from("pl_row_results")
          .select(
            "row_id, set_index, actual_load, actual_load_unit, actual_reps, actual_rpe, actual_rir, completed_duration_seconds",
          )
          .eq("client_id", clientId)
          .in("row_id", rowIds)
          .order("set_index", { ascending: true });
        if (resultsRes.error) throw resultsRes.error;
        results = ((resultsRes.data ?? []) as unknown) as Result[];
      }
      const resultsByRow = new Map<string, Result[]>();
      for (const r of results) {
        const list = resultsByRow.get(r.row_id) ?? [];
        list.push(r);
        resultsByRow.set(r.row_id, list);
      }
      return { rows, resultsByRow };
    },
  });

  if (!enabled) return null;
  if (isLoading || (isFetching && !data)) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
        Loading exercises…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        <span className="truncate">
          Couldn't load exercises{error instanceof Error && error.message ? `: ${error.message}` : "."}
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 font-semibold hover:bg-destructive/10"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      </div>
    );
  }
  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
        No exercises programmed yet.
      </div>
    );
  }

  const allResults: Result[] = [];
  data?.resultsByRow.forEach((list) => list.forEach((r) => allResults.push(r)));
  const progress = computeWorkoutProgress(
    rows.map((r) => ({ id: r.id, sets: r.sets })),
    allResults.map((r) => ({
      row_id: r.row_id,
      actual_reps: r.actual_reps,
      actual_load: r.actual_load,
      completed_duration_seconds: r.completed_duration_seconds,
    })),
  );
  const purposeLabels = derivePurposeLabels(rows as any[], (r: any) => r.exercises ?? null);

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-2.5">
      <div className="flex items-center gap-3 border-b border-border/50 px-1 pb-2">
        <WorkoutProgressRing pct={progress.pct} status={progress.status} size={40} />
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Workout Progress
          </div>
          <div className="text-[12px] font-semibold tabular-nums text-foreground">
            {progress.completedSets} of {progress.prescribedSets} Sets Completed
          </div>
        </div>
      </div>
      {rows.map((row, i) => {
        const results = (data?.resultsByRow.get(row.id) ?? []).filter(
          (r) =>
            (r.actual_reps != null && Number(r.actual_reps) > 0) ||
            (r.actual_load != null && Number(r.actual_load) > 0) ||
            (r.completed_duration_seconds != null && Number(r.completed_duration_seconds) > 0),
        );
        const prescribedSets = Math.max(1, Number(row.sets) || 1);
        const loggedCount = results.length;
        const isComplete = loggedCount >= prescribedSets;
        const isPartial = loggedCount > 0 && !isComplete;
        const label = purposeLabels[i];
        const chip = label && label.trim() ? { label: label.toUpperCase(), tone: purposeLabelBadgeClass(label) } : null;
        const name = row.exercise_name_override || row.exercises?.name || "Exercise";
        const prescribed = prescribedLine(row);
        return (
          <div
            key={row.id}
            className="flex gap-2.5 rounded-md border border-transparent px-1.5 py-1.5 hover:border-border/50"
          >
            <div className="mt-0.5 shrink-0" aria-hidden>
              {isComplete ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : isPartial ? (
                <CircleDot className="h-4 w-4 text-amber-500" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/60" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {chip && (
                  <span
                    className={cn(
                      "rounded-sm border px-1 py-px text-[9px] font-bold tracking-wider",
                      chip.tone,
                    )}
                  >
                    {chip.label}
                  </span>
                )}
                <span className="truncate text-[13px] font-semibold">
                  <span className="text-muted-foreground">{i + 1}.</span> {name}
                </span>
              </div>
              {prescribed && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">{prescribed}</div>
              )}
              {loggedCount > 0 && (
                <div className="mt-1 space-y-0.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                    {loggedCount} of {prescribedSets} sets completed
                  </div>
                  {results.slice(0, 6).map((s, idx) => (
                    <div
                      key={`${s.row_id}-${s.set_index ?? idx}`}
                      className="text-[12px] tabular-nums text-foreground/90"
                    >
                      {formatSetLine(s, row.measurement_type)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}