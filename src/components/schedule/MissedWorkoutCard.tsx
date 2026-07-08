import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO, startOfToday, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CalendarClock, MessageCircle, SkipForward, Loader2 } from "lucide-react";
import { MoveWorkoutSheet } from "./MoveWorkoutSheet";
import { applyBulkScheduleChange } from "@/lib/schedule-bulk.functions";
import { moveScheduledWorkout } from "@/lib/scheduled-workouts.functions";
import { supabase } from "@/integrations/supabase/client";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export interface MissedWorkoutCardProps {
  clientId: string;
}

export function MissedWorkoutCard({ clientId }: MissedWorkoutCardProps) {
  const qc = useQueryClient();
  const apply = useServerFn(applyBulkScheduleChange);
  const moveInstanceFn = useServerFn(moveScheduledWorkout);
  const [moveTarget, setMoveTarget] = useState<
    { dayId: string; instanceId: string | null } | null
  >(null);

  const { data: missed } = useQuery({
    queryKey: ["missed-workouts", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const today = ymd(startOfToday());
      // Slice 2c: read missed workouts from pl_scheduled_workouts so a
      // duplicate instance shows up as its own card (rather than being
      // hidden by the sibling instance's completion).
      const { data: instances } = await supabase
        .from("pl_scheduled_workouts")
        .select("id, source_day_id, scheduled_date")
        .eq("client_id", clientId)
        .lt("scheduled_date", today)
        .order("scheduled_date", { ascending: false })
        .limit(20);
      const instRows = instances ?? [];
      if (!instRows.length) return [];
      const dayIds = Array.from(new Set(instRows.map((i: any) => i.source_day_id)));
      const { data: days } = await supabase
        .from("pl_days")
        .select("id, day_index, title, archived")
        .in("id", dayIds);
      const dayById = new Map((days ?? []).map((d: any) => [d.id, d]));
      const instanceIds = instRows.map((i: any) => i.id);
      const { data: comps } = await supabase
        .from("pl_day_completions")
        .select("scheduled_workout_id, day_id, completed_at, in_progress_at")
        .or(
          `scheduled_workout_id.in.(${instanceIds.join(",")}),and(scheduled_workout_id.is.null,day_id.in.(${dayIds.join(",")}))`,
        );
      const completedInstance = new Set<string>();
      const completedLegacyDay = new Set<string>();
      for (const c of comps ?? []) {
        if (!(c.completed_at || c.in_progress_at)) continue;
        if (c.scheduled_workout_id) completedInstance.add(c.scheduled_workout_id);
        else if (c.day_id) completedLegacyDay.add(c.day_id);
      }
      const out: Array<{
        instanceId: string;
        dayId: string;
        day_index: number;
        title: string | null;
        scheduled_date: string;
      }> = [];
      for (const inst of instRows) {
        const d = dayById.get(inst.source_day_id) as any;
        if (!d || d.archived) continue;
        if (completedInstance.has(inst.id)) continue;
        if (completedLegacyDay.has(inst.source_day_id)) continue;
        out.push({
          instanceId: inst.id,
          dayId: inst.source_day_id,
          day_index: d.day_index,
          title: d.title,
          scheduled_date: inst.scheduled_date,
        });
        if (out.length >= 3) break;
      }
      return out;
    },
  });

  const doItToday = useMutation({
    mutationFn: async (row: { instanceId: string | null; dayId: string }) => {
      const newDate = ymd(new Date());
      if (row.instanceId) {
        return moveInstanceFn({
          data: { instanceId: row.instanceId, newDate, confirmCompletedMove: true },
        });
      }
      return apply({
        data: {
          moves: [{ dayId: row.dayId, newDate }],
          scope: "single",
          confirmCompletedMove: true,
        },
      });
    },
    onSuccess: () => { toast.success("Moved to today."); void qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e?.message ?? "Could not move."),
  });

  if (!missed || missed.length === 0) return null;

  return (
    <>
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-4 w-4 text-amber-500" /> Missed workouts ({missed.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {missed.map((d: any) => {
            const date = parseISO(d.scheduled_date);
            const daysAgo = differenceInCalendarDays(startOfToday(), date);
            return (
              <div key={d.instanceId ?? d.dayId} className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{d.title?.trim() || `Day ${d.day_index}`}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(date, "EEE, MMM d")} · {daysAgo} day{daysAgo === 1 ? "" : "s"} ago
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => doItToday.mutate({ instanceId: d.instanceId, dayId: d.dayId })} disabled={doItToday.isPending}>
                    {doItToday.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Do today
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setMoveTarget({ dayId: d.dayId, instanceId: d.instanceId })}>
                    <CalendarClock className="h-3 w-3 mr-1" /> Move
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/portal/messages" search={{} as any}><MessageCircle className="h-3 w-3 mr-1" /> Coach</Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <MoveWorkoutSheet
        dayId={moveTarget?.dayId ?? null}
        scheduledWorkoutId={moveTarget?.instanceId ?? null}
        open={!!moveTarget}
        onOpenChange={(o) => !o && setMoveTarget(null)}
      />
    </>
  );
}
