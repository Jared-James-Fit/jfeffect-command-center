import { useQuery } from "@tanstack/react-query";
import { Check, Circle, CircleDot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

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
  exercises: { name: string | null } | null;
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

function classificationFor(profile: string | null | undefined): { label: string; tone: string } | null {
  switch (profile) {
    case "main_lift":
      return { label: "PRIMARY", tone: "border-primary/40 bg-primary/10 text-primary" };
    case "secondary_lift":
      return { label: "SECONDARY", tone: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" };
    case "accessory_compound":
    case "accessory_isolation":
      return { label: "ACCESSORY", tone: "border-muted-foreground/30 bg-muted/40 text-muted-foreground" };
    case "warmup_mobility":
      return { label: "WARM-UP", tone: "border-muted-foreground/20 bg-muted/30 text-muted-foreground" };
    case "conditioning":
      return { label: "CONDITIONING", tone: "border-muted-foreground/30 bg-muted/40 text-muted-foreground" };
    default:
      return null;
  }
}

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
  const { data, isLoading } = useQuery({
    queryKey: ["inline-workout-preview", dayId, clientId],
    enabled: enabled && !!dayId && !!clientId,
    staleTime: 15_000,
    queryFn: async () => {
      const [rowsRes, resultsRes] = await Promise.all([
        supabase
          .from("pl_exercise_rows")
          .select(
            "id, sort_order, exercise_name_override, purpose_label, time_profile, sets, reps_text, rpe, load_kg, load_lb, measurement_type, exercises(name)",
          )
          .eq("day_id", dayId)
          .order("sort_order", { ascending: true }),
        supabase
          .from("pl_row_results")
          .select(
            "row_id, set_index, actual_load, actual_load_unit, actual_reps, actual_rpe, actual_rir, completed_duration_seconds, pl_exercise_rows!inner(day_id)",
          )
          .eq("client_id", clientId)
          .eq("pl_exercise_rows.day_id", dayId)
          .order("set_index", { ascending: true }),
      ]);
      const rows = ((rowsRes.data ?? []) as unknown) as Row[];
      const results = ((resultsRes.data ?? []) as unknown) as Result[];
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
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
        Loading exercises…
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

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-2.5">
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
        const chip = classificationFor(row.time_profile);
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