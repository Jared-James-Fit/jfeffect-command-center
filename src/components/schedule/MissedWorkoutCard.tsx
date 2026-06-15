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
  const [moveDayId, setMoveDayId] = useState<string | null>(null);

  const { data: missed } = useQuery({
    queryKey: ["missed-workouts", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const today = ymd(startOfToday());
      const { data: blocks } = await supabase.from("pl_blocks").select("id").eq("client_id", clientId).neq("status", "Archived");
      const blockIds = (blocks ?? []).map((b: any) => b.id);
      if (!blockIds.length) return [];
      const { data: weeks } = await supabase.from("pl_weeks").select("id").in("block_id", blockIds);
      const weekIds = (weeks ?? []).map((w: any) => w.id);
      if (!weekIds.length) return [];
      const { data: days } = await supabase.from("pl_days")
        .select("id, day_index, title, scheduled_date")
        .in("week_id", weekIds)
        .eq("archived", false)
        .lt("scheduled_date", today)
        .order("scheduled_date", { ascending: false });
      const dayIds = (days ?? []).map((d: any) => d.id);
      if (!dayIds.length) return [];
      const { data: comps } = await supabase.from("pl_day_completions").select("day_id, completed_at, in_progress_at").in("day_id", dayIds);
      const compSet = new Set((comps ?? []).filter((c: any) => c.completed_at || c.in_progress_at).map((c: any) => c.day_id));
      return (days ?? []).filter((d: any) => !compSet.has(d.id)).slice(0, 3);
    },
  });

  const doItToday = useMutation({
    mutationFn: async (dayId: string) => apply({
      data: { moves: [{ dayId, newDate: ymd(new Date()) }], scope: "single", confirmCompletedMove: true },
    }),
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
              <div key={d.id} className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{d.title?.trim() || `Day ${d.day_index}`}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(date, "EEE, MMM d")} · {daysAgo} day{daysAgo === 1 ? "" : "s"} ago
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => doItToday.mutate(d.id)} disabled={doItToday.isPending}>
                    {doItToday.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Do today
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setMoveDayId(d.id)}>
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
      <MoveWorkoutSheet dayId={moveDayId} open={!!moveDayId} onOpenChange={(o) => !o && setMoveDayId(null)} />
    </>
  );
}
